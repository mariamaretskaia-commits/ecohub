/**
 * Деплой EcoHub на Railway (постоянный HTTPS без вашего ПК).
 *
 * Перед запуском: railway login
 * Затем: npm run deploy:railway
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import fs from 'fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

function railway(args, opts = {}) {
  const r = spawnSync('npx', ['--yes', '@railway/cli', ...args], {
    cwd: root,
    stdio: opts.inherit === false ? 'pipe' : 'inherit',
    shell: true,
    encoding: 'utf8',
  });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`❌ railway ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
  return r;
}

function requireEnv(name) {
  const val = process.env[name];
  if (!val || val.includes('your_') || val === 'change-me-to-random-secret') {
    console.error(`❌ Задайте ${name} в .env перед деплоем`);
    process.exit(1);
  }
  return val;
}

console.log('♻️ EcoHub → Railway\n');

const whoami = railway(['whoami'], { inherit: false, allowFail: true });
if (whoami.status !== 0) {
  console.log('Вход в Railway (откроется браузер)…');
  railway(['up', '-y', '--detach']);
  process.exit(0);
}

requireEnv('BOT_TOKEN');
requireEnv('JWT_SECRET');

if (!fs.existsSync(path.join(root, 'railway.toml'))) {
  console.error('❌ railway.toml не найден');
  process.exit(1);
}

console.log('1/4 Создание проекта (если ещё нет)…');
railway(['init', '--name', 'ecohub'], { allowFail: true });

console.log('\n2/4 Переменные окружения…');
railway([
  'variables', '--set',
  `BOT_TOKEN=${process.env.BOT_TOKEN}`,
  '--set', `JWT_SECRET=${process.env.JWT_SECRET}`,
  '--set', 'NODE_ENV=production',
]);

console.log('\n3/4 Деплой (сборка на серверах Railway)…');
railway(['up', '--detach']);

console.log('\n4/4 Публичный домен…');
railway(['domain'], { allowFail: true });

console.log(`
✅ Деплой запущен.

Дальше в панели Railway (https://railway.com/dashboard):
1. Откройте сервис → Settings → Networking → сгенерируйте домен *.up.railway.app
2. Volumes → Add Volume → mount path: /app/server/data (база и фото)
3. После первого запуска: npm run bot:setup

WEBAPP_URL подставится автоматически из RAILWAY_PUBLIC_DOMAIN.
Остановите cloudflared и локальный сервер – бот будет работать 24/7 на Railway.
`);
