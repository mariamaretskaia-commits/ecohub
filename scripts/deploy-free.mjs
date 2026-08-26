/**
 * Интерактивный деплой EcoHub на Render + Supabase.
 * Нужен один вход в браузере в оба сервиса (бесплатно).
 *
 * Запуск: node scripts/deploy-free.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import crypto from 'crypto';
import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (a) => {
      rl.close();
      resolve(String(a || '').trim());
    });
  });
}

function openUrl(url) {
  spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
}

function setEnv(key, value) {
  const envPath = path.join(root, '.env');
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, 'm').test(text)) {
    text = text.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  } else {
    text = `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(envPath, text, 'utf8');
  process.env[key] = value;
}

console.log(`
♻️ EcoHub – бесплатный облачный деплой

Я не могу создать аккаунты за вас (нужна ваша почта/Google).
Сейчас открою сайты – зарегистрируйтесь бесплатно и вернитесь сюда вставить ключи.
`);

openUrl('https://supabase.com/dashboard');
openUrl('https://render.com/register');

console.log(`
=== SUPABASE ===
1. New project → ecohub
2. SQL Editor → вставьте файл server/sql/supabase-schema.sql → Run
3. Storage → New bucket → item-photos → Public
4. Settings → API → скопируйте URL и service_role
5. Settings → Database → Connect → Connection string (URI, Transaction pooler)
`);

const supabaseUrl = await ask('SUPABASE_URL (https://….supabase.co): ');
const serviceKey = await ask('SUPABASE_SERVICE_ROLE_KEY: ');
const dbUrl = await ask('DATABASE_URL (postgresql://…): ');

if (!supabaseUrl || !serviceKey || !dbUrl) {
  console.error('Нужны все три значения Supabase.');
  process.exit(1);
}

setEnv('SUPABASE_URL', supabaseUrl);
setEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey);
setEnv('SUPABASE_STORAGE_BUCKET', 'item-photos');
setEnv('DATABASE_URL', dbUrl);
setEnv('NODE_ENV', 'production');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('change-me')) {
  const secret = crypto.randomBytes(32).toString('hex');
  setEnv('JWT_SECRET', secret);
}

console.log(`
✅ Supabase сохранён в .env

=== RENDER ===
Без GitHub: создайте Web Service вручную (Docker).
С GitHub: New → Web Service → этот репозиторий.

Переменные окружения на Render (скопируйте из .env):
  BOT_TOKEN
  DATABASE_URL
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_STORAGE_BUCKET=item-photos
  JWT_SECRET
  NODE_ENV=production

После первого деплоя получите URL https://….onrender.com
`);

const webapp = await ask('WEBAPP_URL (https://….onrender.com): ');
if (webapp) {
  setEnv('WEBAPP_URL', webapp.replace(/\/$/, ''));
  console.log('\nНастраиваю бота…');
  const r = spawnSync('npm', ['run', 'bot:setup'], { cwd: root, shell: true, stdio: 'inherit' });
  if (r.status !== 0) {
    console.warn('bot:setup не прошёл – добавьте WEBAPP_URL в Render и сделайте Redeploy (сервер сам поставит webhook).');
  }
}

console.log(`
✅ Готово, если Render уже задеплоен.
Проверка: ${webapp || 'https://ВАШ.onrender.com'}/health
Бот: @EcoHubBY_bot → /start
Ноутбук можно выключать.
`);
