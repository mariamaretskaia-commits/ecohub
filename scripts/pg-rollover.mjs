/**
 * Automatic rollover of the Render free Postgres (30-day trial).
 *
 * Workspace policy: only ONE free Postgres per workspace, and a new one can be
 * created only AFTER the current one expires. Plan:
 *   - While the current DB is not expired: runs backup-weekly.ps1 (fresh dump +
 *     IP allow-list self-heal + retention) and exits.
 *   - When the current DB is expired: creates a new free Postgres, restores the
 *     newest local dump into it, updates .pg-url.txt / .pg-id.txt, sets the new
 *     DATABASE_URL on the Render web service, redeploys and deletes the old DB.
 *
 * Idempotent: safe to run daily via Task Scheduler.
 * Requires: render CLI login ( ~/.render/cli.yaml ), server/node_modules (pg).
 */
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, appendFileSync } from 'fs';
import path from 'path';

const REPO = 'C:/Users/Admin/eco-grodno';
const BACKUP_DIR = 'C:/Users/Admin/eco-db-backups';
const PG_URL_FILE = path.join(BACKUP_DIR, '.pg-url.txt');
const PG_ID_FILE = path.join(BACKUP_DIR, '.pg-id.txt');
const PG_PREV_FILE = path.join(BACKUP_DIR, '.pg-url.prev.txt');
const LOG_FILE = path.join(BACKUP_DIR, 'backup.log');
const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-da7jceqfngtc73fn39g0';
const OWNER_ID = 'tea-da7in1h42hec73bvrgfg';
const API = 'https://api.render.com/v1';

const key = (readFileSync(path.join(process.env.USERPROFILE || '', '.render', 'cli.yaml'), 'utf8').match(/key:\s*(\S+)/) || [])[1];
if (!key) throw new Error('render login required (~/.render/cli.yaml)');

const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' };

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch { /* keep going */ }
}

async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function resolvePublicIp() {
  for (const u of ['https://api.ipify.org', 'https://icanhazip.com', 'https://ifconfig.me/ip']) {
    try {
      const r = await fetch(u);
      const t = (await r.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return t;
    } catch { /* try next */ }
  }
  throw new Error('could not resolve public IP');
}

function runNode(args, env) {
  const r = spawnSync(process.execPath, args, { cwd: REPO, env: { ...process.env, ...env }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`node ${args[0]} exited ${r.status}`);
}

function latestDump() {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => /^ecohub-.*\.sql$/.test(f))
    .map((f) => path.join(BACKUP_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files.length) throw new Error('no local dump found in ' + BACKUP_DIR);
  return files[0];
}

function readPgId() {
  if (existsSync(PG_ID_FILE)) return readFileSync(PG_ID_FILE, 'utf8').trim();
  return null;
}

async function currentFreePg() {
  const ownId = readPgId();
  if (ownId) {
    const r = await api('GET', `/postgres/${ownId}`);
    const pg = r.data || r;
    if (pg && pg.id) return pg;
  }
  const list = await api('GET', '/postgres');
  const arr = Array.isArray(list) ? list : list.data || [];
  const free = arr
    .map((item) => (item && item.postgres ? item.postgres : item))
    .filter((p) => p && p.plan === 'free');
  if (!free.length) throw new Error('no free postgres found in workspace');
  return free[0];
}

async function waitAvailable(pgId, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await api('GET', `/postgres/${pgId}`);
    const pg = r.data || r;
    if (pg.status === 'available') return pg;
    await new Promise((res) => setTimeout(res, 10000));
  }
  throw new Error(`postgres ${pgId} did not become available in time`);
}

const isExpired = (pg) => new Date(pg.expiresAt).getTime() < Date.now();

// ---- main ------------------------------------------------------------------
const pg = await currentFreePg();
writeFileSync(PG_ID_FILE, pg.id, 'utf8');
console.log(`current free PG ${pg.id} (${pg.name}), plan=${pg.plan}, expiresAt=${pg.expiresAt}, status=${pg.status}`);
log(`pg-rollover check: ${pg.id} expires ${pg.expiresAt}`);

if (!isExpired(pg)) {
  console.log('not expired yet; refreshing dump + allow-list via backup-weekly.ps1');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'scripts', 'backup-weekly.ps1')], { cwd: REPO, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('backup-weekly.ps1 failed');
  process.exit(0);
}

// ----- migrate --------------------------------------------------------------
log(`DB expired -> starting rollover for ${pg.id}`);
const oldId = pg.id;
const oldExtUrl = readFileSync(PG_URL_FILE, 'utf8').trim();
const dump = latestDump();
console.log('using dump:', dump);
log(`restore source: ${dump}`);

const ip = await resolvePublicIp();
console.log('public IP:', ip);

const createBody = {
  name: `ecohub-db-${new Date().toISOString().slice(0, 10)}`,
  plan: 'free',
  ownerId: OWNER_ID,
  version: pg.version || '16',
  region: pg.region || 'frankfurt',
  databaseName: pg.databaseName || 'ecohub_db',
  databaseUser: pg.databaseUser || 'ecohub_db_user',
  ipAllowList: [{ cidrBlock: `${ip}/32`, description: 'PC backup current' }],
};
const createdRes = await api('POST', '/postgres', createBody);
const created = createdRes.data || createdRes;
log(`created new PG ${created.id} (plan free, region ${created.region})`);
const newPg = await waitAvailable(created.id);
console.log('new PG available:', newPg.id);

const conn = await api('GET', `/postgres/${newPg.id}/connection-info`);
const external = conn.externalConnectionString;
const internal = conn.internalConnectionString;
if (!external || !internal) throw new Error('connection-info missing connection strings');

log('restoring dump ...');
runNode(['server/restore.mjs', dump], { PG_URL: external });
log('restore OK');

writeFileSync(PG_PREV_FILE, oldExtUrl, 'utf8');
writeFileSync(PG_URL_FILE, external, 'utf8');
writeFileSync(PG_ID_FILE, newPg.id, 'utf8');
log(`wrote .pg-url.txt / .pg-id.txt -> ${newPg.id}`);

log('setting DATABASE_URL on service ...');
runNode(['scripts/set-env-render.mjs', SERVICE_ID, `DATABASE_URL=${internal}`]);
log('DATABASE_URL updated');

log('redeploying service ...');
runNode(['scripts/redeploy-render.mjs'], { RENDER_SERVICE_ID: SERVICE_ID });
log('redeploy triggered');

log(`deleting old expired PG ${oldId} ...`);
await api('DELETE', `/postgres/${oldId}`);
log(`deleted old PG ${oldId}`);
log('ROLLOVER COMPLETE');
console.log('ROLLOVER COMPLETE');