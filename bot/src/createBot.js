import { Telegraf, Markup } from 'telegraf';
import { get } from '../../server/src/db.js';
import { displayName } from '../../server/src/users.js';

async function findActiveWant(telegramId) {
  const user = await get('SELECT * FROM users WHERE telegram_id = ?', String(telegramId));
  if (!user) return null;
  return get(`
    SELECT items.title,
           buyer.telegram_id AS buyer_tg,
           owner.telegram_id AS owner_tg,
           buyer.id AS buyer_id,
           owner.id AS owner_id
    FROM item_wants
    JOIN items ON items.id = item_wants.item_id
    JOIN users buyer ON buyer.id = item_wants.buyer_id
    JOIN users owner ON owner.id = items.user_id
    WHERE items.status = 'active'
      AND (item_wants.buyer_id = ? OR items.user_id = ?)
    ORDER BY item_wants.created_at DESC
    LIMIT 1
  `, user.id, user.id);
}

async function findClosedWant(telegramId) {
  const user = await get('SELECT * FROM users WHERE telegram_id = ?', String(telegramId));
  if (!user) return null;
  return get(`
    SELECT items.title
    FROM item_wants
    JOIN items ON items.id = item_wants.item_id
    WHERE items.status = 'given'
      AND (item_wants.buyer_id = ? OR items.user_id = ?)
    ORDER BY item_wants.created_at DESC
    LIMIT 1
  `, user.id, user.id);
}

async function nickOf(userId, telegramUser) {
  const row = await get('SELECT * FROM users WHERE id = ?', userId);
  return displayName(row) || telegramUser?.first_name || 'Собеседник';
}

function buttonSets(webAppUrl) {
  return {
    keyboard: Markup.keyboard([
      [Markup.button.webApp('♻️ EcoHub сейчас', webAppUrl)],
    ]).resize(),
    inline: Markup.inlineKeyboard([
      [Markup.button.webApp('♻️ EcoHub сейчас', webAppUrl)],
      [Markup.button.url('Открыть в браузере', webAppUrl)],
    ]),
  };
}

const LOUD = { disable_notification: false };

export async function pushOpenButtons(telegram, chatId, webAppUrl, text) {
  const ui = buttonSets(webAppUrl);
  await telegram.sendMessage(chatId, text, { ...ui.keyboard, ...LOUD });
}

export function createBot(token, webAppUrl) {
  const bot = new Telegraf(token);

  const welcomeText = `♻️ EcoHub

Обмен вещами по Беларуси и карта пунктов приёма.

Профиль привязан к этому Telegram: один аккаунт – один профиль.

Чтобы отклики не терялись: откройте чат с ботом → ⋮ → «Уведомления» → «Включены» (не без звука).

Нажмите «♻️ EcoHub сейчас» и укажите, как к Вам обращаться.`;

  bot.start(async (ctx) => {
    await pushOpenButtons(ctx.telegram, ctx.chat.id, webAppUrl, welcomeText);
  });

  bot.command('app', async (ctx) => {
    await pushOpenButtons(ctx.telegram, ctx.chat.id, webAppUrl, 'Открыть приложение:');
  });

  bot.command('phone', async (ctx) => {
    await pushOpenButtons(
      ctx.telegram,
      ctx.chat.id,
      webAppUrl,
      'Профиль EcoHub привязан к этому Telegram, не к номеру. Один аккаунт – один профиль.',
    );
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      '/start – открыть EcoHub\n/app – кнопка приложения\n\nОтклики и переписка – только здесь, в боте. Включите уведомления с звуком для этого чата.',
      LOUD,
    );
  });

  bot.on('contact', async (ctx) => {
    await ctx.reply(
      'Профиль уже привязан к этому Telegram. Откройте EcoHub кнопкой ниже.',
      { ...buttonSets(webAppUrl).keyboard, ...LOUD },
    );
  });

  bot.on('message', async (ctx) => {
    if (ctx.message.contact) return;
    if (ctx.message.text?.startsWith('/')) return;

    const want = await findActiveWant(ctx.from.id);
    const hasRelay = want && (ctx.message.text || ctx.message.photo);
    if (hasRelay) {
      const isBuyer = String(ctx.from.id) === String(want.buyer_tg);
      const peer = isBuyer ? want.owner_tg : want.buyer_tg;
      const fromName = await nickOf(isBuyer ? want.buyer_id : want.owner_id, ctx.from);
      try {
        if (ctx.message.photo) {
          const fileId = ctx.message.photo.at(-1).file_id;
          const caption = ctx.message.caption
            ? `${fromName} по вещи «${want.title}»:\n\n${ctx.message.caption}`
            : `${fromName} прислал фото по вещи «${want.title}».`;
          await ctx.telegram.sendPhoto(peer, fileId, { caption, ...LOUD });
        } else {
          await ctx.telegram.sendMessage(
            peer,
            `${fromName} по вещи «${want.title}»:\n\n${ctx.message.text}`,
            LOUD,
          );
        }
        await ctx.reply('Отправлено собеседнику через бота.', LOUD);
      } catch {
        await ctx.reply('Собеседник ещё не открывал бота. Попросите нажать /start в @EcoHubBY_bot.', LOUD);
      }
      return;
    }

    const closed = await findClosedWant(ctx.from.id);
    if (closed && (ctx.message.text || ctx.message.photo)) {
      await ctx.reply(
        `Переписка по вещи «${closed.title}» закрыта: автор отметил её как отданную. Новые сообщения не передаются.`,
        LOUD,
      );
      return;
    }

    await pushOpenButtons(
      ctx.telegram,
      ctx.chat.id,
      webAppUrl,
      'Откройте приложение кнопкой ниже – там лента объявлений и карта.',
    );
  });

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  return bot;
}

export async function configureBot(bot, webAppUrl) {
  await bot.telegram.setMyName('EcoHub');
  await bot.telegram.setMyDescription(
    'EcoHub – даром вещи и карта переработки по Беларуси. Найдите бота по имени EcoHub или @EcoHubBY_bot. Откройте Mini App и укажите, как к Вам обращаться.',
  );
  await bot.telegram.setMyShortDescription('EcoHub – даром вещи и карта переработки по Беларуси');
  await bot.telegram.setChatMenuButton({
    menuButton: {
      type: 'web_app',
      text: 'EcoHub',
      web_app: { url: webAppUrl },
    },
  });
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Открыть EcoHub' },
    { command: 'app', description: 'Открыть приложение' },
    { command: 'help', description: 'Справка' },
  ]);
}
