/**
 * Настраивает бота через Bot API и проверяет @username.
 * @username нельзя переименовать — только новый бот через /newbot в BotFather.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const TARGET_USERNAME = 'EcoHubBY_bot';
const token = process.env.BOT_TOKEN;

if (!token || token === 'your_bot_token_here') {
  console.error('❌ BOT_TOKEN не задан в .env');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `${method} failed`);
  return data.result;
}

async function main() {
  const me = await call('getMe', {});
  console.log(`Текущий бот: @${me.username} (${me.first_name}, id ${me.id})`);

  await call('setMyName', { name: 'EcoHub' });
  await call('setMyDescription', {
    description:
      'EcoHub – даром вещи и карта переработки по Беларуси. Найдите бота по имени EcoHub или @EcoHubBY_bot. Откройте Mini App и укажите, как к Вам обращаться.',
  });
  await call('setMyShortDescription', {
    short_description: 'EcoHub – даром вещи и карта переработки по Беларуси',
  });

  const webAppUrl = process.env.WEBAPP_URL?.replace(/\/$/, '')
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
    || process.env.RAILWAY_STATIC_URL?.replace(/\/$/, '')
    || process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, '');
  if (webAppUrl?.startsWith('https://')) {
    await call('setWebhook', {
      url: `${webAppUrl}/telegram/webhook`,
      drop_pending_updates: false,
    });
    await call('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'EcoHub',
        web_app: { url: webAppUrl },
      },
    });
    await call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Открыть EcoHub' },
        { command: 'app', description: 'Открыть приложение' },
        { command: 'help', description: 'Справка' },
      ],
    });
    console.log(`✅ Webhook и кнопка меню: ${webAppUrl}`);
  } else {
    console.log('⚠️  WEBAPP_URL не задан – webhook и кнопка меню не обновлены');
  }

  console.log('✅ Имя и описание бота обновлены на EcoHub');

  if (me.username === TARGET_USERNAME) {
    console.log(`✅ Username уже @${TARGET_USERNAME}`);
    return;
  }

  let targetTaken = false;
  try {
    const other = await call('getChat', { chat_id: `@${TARGET_USERNAME}` });
    if (other?.id && other.id !== me.id) {
      targetTaken = true;
      console.log('');
      console.log(`⚠️  @${TARGET_USERNAME} уже занят другим ботом (id ${other.id}, «${other.first_name || other.title}»).`);
      console.log('   Свободные варианты: EcoHubBelarus_bot, EcoHub_app_bot');
      console.log('   Если @EcoHubBY_bot – ваш старый бот: удалите конфликт в BotFather или возьмите его токен в .env');
    }
  } catch {
    /* username свободен или недоступен */
  }

  if (!targetTaken) {
    console.log('');
    console.log(`⚠️  Username сейчас @${me.username}, нужен @${TARGET_USERNAME}`);
  }
  console.log('   @username нельзя переименовать (команды /setusername нет). Создайте нового бота:');
  console.log('');
  console.log('   1. Откройте https://t.me/BotFather');
  console.log('   2. Отправьте: /newbot');
  console.log('   3. Имя: EcoHub');
  console.log(`   4. Username: ${TARGET_USERNAME}`);
  console.log('   5. Скопируйте токен в .env → BOT_TOKEN=...');
  console.log('   6. Перезапустите сервер (webhook подтянется сам)');
  console.log('');
  console.log('   Старый @Krugavort_bot можно оставить или удалить через /deletebot.');
  process.exitCode = 2;
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
