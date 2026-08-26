import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBot, configureBot } from './createBot.js';

console.error('Не запускайте polling: сервер уже принимает Telegram через webhook.');
console.error('Оставьте работать server/src/index.js и откройте Mini App кнопкой в боте.');
process.exit(1);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

if (!BOT_TOKEN || BOT_TOKEN === 'your_bot_token_here') {
  console.warn('⚠️  BOT_TOKEN not set');
  process.exit(1);
}

if (!WEBAPP_URL || WEBAPP_URL.startsWith('http://localhost') || WEBAPP_URL.includes('your-domain')) {
  console.warn('⚠️  WEBAPP_URL must be a public HTTPS address');
  process.exit(1);
}

const bot = createBot(BOT_TOKEN, WEBAPP_URL);

console.log('Starting EcoHub bot...');
console.log('Mini App URL:', WEBAPP_URL);

bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then(() => bot.launch({ dropPendingUpdates: true }))
  .then(() => configureBot(bot, WEBAPP_URL))
  .then(() => {
    console.log('🤖 Telegram bot started (polling)');
  })
  .catch((err) => {
    console.error('Polling failed, webhook is preferred:', err.message);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
