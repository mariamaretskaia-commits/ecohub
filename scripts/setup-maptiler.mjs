/**
 * Save MapTiler API key for Russian street labels on the map.
 * Usage: node scripts/setup-maptiler.mjs YOUR_KEY
 * Or run without args – prompts for the key.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

function upsertEnv(key, value) {
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, text.startsWith('\n') ? text.trimStart() : text);
}

async function askKey() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const key = await new Promise((resolve) => {
    rl.question('Вставьте ключ MapTiler (cloud.maptiler.com/account/keys): ', resolve);
  });
  rl.close();
  return key.trim();
}

const fromArg = String(process.argv[2] || '').trim();
const key = fromArg || (await askKey());

if (!key) {
  console.error('Ключ не указан. Получите бесплатный ключ: https://cloud.maptiler.com/account/keys/');
  process.exit(1);
}

upsertEnv('VITE_MAPTILER_KEY', key);
console.log('✓ VITE_MAPTILER_KEY сохранён в .env');
console.log('  Локально: npm run dev');
console.log('  Render: добавьте VITE_MAPTILER_KEY в Environment и сделайте Redeploy (ключ вшивается при сборке).');
