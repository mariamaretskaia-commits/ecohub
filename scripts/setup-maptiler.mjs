/**
 * Save MapTiler API key for permanent Russian map labels.
 * Usage: node scripts/setup-maptiler.mjs YOUR_KEY
 *
 * Important: in MapTiler Cloud → key → Allowed HTTP Origins leave EMPTY
 * (or list localhost + production). Empty = works everywhere, forever.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-da7jceqfngtc73fn39g0';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const cliYaml = path.join(process.env.USERPROFILE || '', '.render', 'cli.yaml');

function upsertEnv(name, value) {
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, text.startsWith('\n') ? text.trimStart() : text);
}

function renderKey() {
  if (!fs.existsSync(cliYaml)) return null;
  return fs.readFileSync(cliYaml, 'utf8').match(/key:\s*(\S+)/)?.[1] || null;
}

async function askKey() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const key = await new Promise((resolve) => {
    rl.question('Вставьте ключ MapTiler: ', resolve);
  });
  rl.close();
  return key.trim();
}

async function setRenderEnv(apiKey, name, value) {
  const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${name}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Render env ${name}: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function redeploy(apiKey) {
  const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clearCache: 'clear' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Render deploy: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.deploy?.id || data.id || 'started';
}

async function probeKey(maptilerKey) {
  const url = `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(maptilerKey)}`;
  const res = await fetch(url, {
    headers: { Origin: 'http://localhost:5173' },
  });
  if (!res.ok) {
    throw new Error(`MapTiler ответил ${res.status}. Проверьте ключ и лимиты на cloud.maptiler.com`);
  }
}

const fromArg = String(process.argv[2] || '').trim();
const maptilerKey = fromArg || (await askKey());

if (!maptilerKey) {
  console.error('Ключ не указан.');
  console.error('1. https://cloud.maptiler.com/account/keys/new');
  console.error('2. Name: EcoHub');
  console.error('3. Allowed HTTP Origins: ОСТАВЬТЕ ПУСТЫМ (так ключ не «отвалится» на новых доменах)');
  console.error('4. npm run map:setup ВАШ_КЛЮЧ');
  process.exit(1);
}

try {
  await probeKey(maptilerKey);
  console.log('✓ Ключ MapTiler рабочий');
} catch (err) {
  console.error('✗', err.message);
  process.exit(1);
}

// Runtime key (preferred – /api/map-config, no frontend rebuild) + Vite bootstrap
upsertEnv('MAPTILER_KEY', maptilerKey);
upsertEnv('VITE_MAPTILER_KEY', maptilerKey);
console.log('✓ MAPTILER_KEY и VITE_MAPTILER_KEY сохранены в .env');

const apiKey = renderKey();
if (apiKey) {
  try {
    await setRenderEnv(apiKey, 'MAPTILER_KEY', maptilerKey);
    await setRenderEnv(apiKey, 'VITE_MAPTILER_KEY', maptilerKey);
    console.log('✓ Ключи добавлены на Render (MAPTILER_KEY + VITE_MAPTILER_KEY)');
    const deployId = await redeploy(apiKey);
    console.log('✓ Деплой запущен:', deployId);
    console.log('  Через несколько минут в Telegram будут русские подписи улиц.');
  } catch (err) {
    console.warn('Render:', err.message);
    console.warn('Добавьте вручную в Render → Environment:');
    console.warn('  MAPTILER_KEY=...');
    console.warn('  VITE_MAPTILER_KEY=...');
    console.warn('затем Redeploy');
  }
} else {
  console.log('Render CLI не найден – добавьте MAPTILER_KEY в Dashboard → Environment → Redeploy');
}

console.log('');
console.log('Локально: перезапустите npm run dev → вкладка «Карта».');
console.log('Подписи улиц обновляет MapTiler автоматически; пункты приёма – сервер каждые 6 ч.');
