import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from '../server/node_modules/pg/lib/index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const cliYaml = path.join(process.env.USERPROFILE || '', '.render', 'cli.yaml');

function readRenderKey() {
  const text = fs.readFileSync(cliYaml, 'utf8');
  const m = text.match(/key:\s*(\S+)/);
  if (!m) throw new Error('Render API key not found – run render login');
  return m[1];
}

function upsertEnv(key, value) {
  let t = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  t = re.test(t) ? t.replace(re, line) : `${t.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, t);
}

const key = readRenderKey();
const res = await fetch('https://api.render.com/v1/postgres/dpg-da7irjqjnfac738ibmp0-a/connection-info', {
  headers: { Authorization: `Bearer ${key}` },
});
const info = await res.json();
if (!info.externalConnectionString) {
  console.error('No connection string', info);
  process.exit(1);
}

upsertEnv('DATABASE_URL', info.externalConnectionString);
upsertEnv('NODE_ENV', 'production');
console.log('DATABASE_URL saved');

const sql = fs.readFileSync(path.join(root, 'server', 'sql', 'supabase-schema.sql'), 'utf8');
const pool = new pg.Pool({
  connectionString: info.externalConnectionString,
  ssl: { rejectUnauthorized: false },
});
await pool.query(sql);
console.log('Schema applied');
await pool.end();
