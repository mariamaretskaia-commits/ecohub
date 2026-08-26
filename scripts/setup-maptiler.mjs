/**
 * Save MapTiler API key and deploy Russian street labels.
 * Usage: node scripts/setup-maptiler.mjs YOUR_KEY
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
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Render deploy: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.deploy?.id || data.id || 'started';
}

const fromArg = String(process.argv[2] || '').trim();
const maptilerKey = fromArg || (await askKey());

if (!maptilerKey) {
  console.error('Ключ не указан.');
  console.error('1. https://cloud.maptiler.com/account/keys/new');
  console.error('2. Name: EcoHub, Allowed HTTP Origins: оставьте пустым');
  console.error('3. npm run map:setup ВАШ_КЛЮЧ');
  process.exit(1);
}

upsertEnv('VITE_MAPTILER_KEY', maptilerKey);
console.log('✓ VITE_MAPTILER_KEY сохранён в .env');

const apiKey = renderKey();
if (apiKey) {
  try {
    await setRenderEnv(apiKey, 'VITE_MAPTILER_KEY', maptilerKey);
    console.log('✓ VITE_MAPTILER_KEY добавлен на Render');
    const deployId = await redeploy(apiKey);
    console.log('✓ Деплой запущен:', deployId);
    console.log('  Через 3–5 минут карта в Telegram будет с русскими улицами.');
  } catch (err) {
    console.warn('Render:', err.message);
    console.warn('Добавьте VITE_MAPTILER_KEY вручную в Render → Environment → Redeploy');
  }
} else {
  console.log('Render CLI не найден – добавьте ключ в Dashboard → Environment → Redeploy');
}

console.log('Локально: npm run dev → вкладка «Переработка»');
