import { Telegraf, Markup } from 'telegraf';

const LOUD = { disable_notification: false };

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

export async function pushOpenButtons(telegram, chatId, webAppUrl, text) {
  const ui = buttonSets(webAppUrl);
  await telegram.sendMessage(chatId, text, { ...ui.keyboard, ...LOUD });
}

export function createBot(token, webAppUrl) {
  const bot = new Telegraf(token);

  const welcomeText = `♻️ EcoHub

Обмен вещами по Беларуси и карта пунктов приёма.

Профиль привязан к этому Telegram: один аккаунт – один профиль.

Переписка по объявлениям – в приложении, раздел «Чат». Бот пришлёт уведомление, если появятся новые сообщения, пока вы не в приложении.

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
      '/start – открыть EcoHub\n/app – кнопка приложения\n\nОтклики и переписка – в приложении, раздел «Чат». Бот напомнит о новых сообщениях.',
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

    if (ctx.message.text || ctx.message.photo) {
      await pushOpenButtons(
        ctx.telegram,
        ctx.chat.id,
        webAppUrl,
        'Переписка по объявлениям – в приложении EcoHub, раздел «Чат». Нажмите кнопку ниже.',
      );
    }
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
