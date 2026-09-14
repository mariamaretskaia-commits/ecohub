/**
 * Установка env-переменных на Render web-сервисе через эндпоинт /env-vars.
 * GET текущие -> merge (добавляет/обновляет переданные, остальные сохраняет) -> PUT (replace).
 * Usage: node scripts/set-env-render.mjs <SERVICE_ID> KEY=VALUE [KEY2=VALUE2 ...]
 */
import fs from 'fs';
import path from 'path';
const cliYaml = path.join(process.env.USERPROFILE || '', '.render', 'cli.yaml');
const key = fs.readFileSync(cliYaml, 'utf8').match(/key:\s*(\S+)/)?.[1];
if (!key) throw new Error('render login required');

const serviceId = process.argv[2];
const pairs = process.argv.slice(3);
if (!serviceId || !pairs.length) {
  console.error('Usage: node scripts/set-env-render.mjs <SERVICE_ID> KEY=VALUE [...]');
  process.exit(1);
}

const base = `https://api.render.com/v1/services/${serviceId}`;
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' };

const get = await fetch(`${base}/env-vars?limit=100`, { headers });
if (!get.ok) throw new Error(`GET ${get.status}: ${await get.text()}`);
const got = await get.json();
const current = (Array.isArray(got) ? got : [])
  .map((e) => e.envVar || e)
  .filter((e) => e && e.key)
  .map((e) => ({ key: e.key, value: e.value ?? '' }));

const updates = pairs.map((p) => {
  const i = p.indexOf('=');
  return { key: p.slice(0, i), value: p.slice(i + 1) };
});
const merged = [...current];
for (const u of updates) {
  const idx = merged.findIndex((e) => e.key === u.key);
  if (idx >= 0) merged.splice(idx, 1, u);
  else merged.push(u);
}

const put = await fetch(`${base}/env-vars`, { method: 'PUT', headers, body: JSON.stringify(merged) });
if (!put.ok) throw new Error(`PUT ${put.status}: ${await put.text()}`);

const pv = await fetch(`${base}/env-vars?limit=100`, { headers });
const pj = await pv.json();
const after = (Array.isArray(pj) ? pj : [])
  .map((e) => e.envVar || e)
  .filter((e) => e && e.key)
  .map((e) => e.key);
console.log('OK. env vars now:', after.join(', '));