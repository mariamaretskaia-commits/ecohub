import { Telegraf, Markup } from 'telegraf';

const LOUD = { disable_notification: false };

function buttonSets(webAppUrl) {
  return {
    keyboard: Markup.keyboard([
      [Markup.button.webApp('Запустить EcoHub', webAppUrl)],
    ]).resize(),
    inline: Markup.inlineKeyboard([
      [Markup.button.webApp('Запустить EcoHub', webAppUrl)],
    ]),
  };
}

export async function pushOpenButtons(telegram, chatId, webAppUrl, text) {
  const ui = buttonSets(webAppUrl);
  await telegram.sendMessage(chatId, text, { ...ui.keyboard, ...LOUD });
}

export function createBot(token, webAppUrl) {
  const bot = new Telegraf(token);

  const welcomeText = `♻️ EcoHub — приложение, в котором вещи получают вторую жизнь.

Бесплатно отдайте то, что не нужно, и найдите, что нужно вам. Карта подскажет, куда сдать вторсырьё.

Всё происходит в мини-приложении: профиль, объявления, чат и карта. Откройте его кнопкой «Запустить EcoHub» и укажите, как к Вам обращаться.

💡 Чтобы не пропустить отклики: ⋮ → «Уведомления» → «Включены».`;

  bot.start(async (ctx) => {
    await pushOpenButtons(ctx.telegram, ctx.chat.id, webAppUrl, welcomeText);
  });

  bot.command('app', async (ctx) => {
    await pushOpenButtons(ctx.telegram, ctx.chat.id, webAppUrl, 'Запустите мини-приложение кнопкой ниже:');
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
      '/start – открыть EcoHub\n/app – кнопка запуска приложения\n\nОбъявления, переписка и карта пунктов приёма – внутри мини-приложения.',
      LOUD,
    );
  });

  bot.on('contact', async (ctx) => {
    await ctx.reply(
      'Профиль уже привязан к этому Telegram. Запустите EcoHub кнопкой ниже.',
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
        'Объявления и переписка – в мини-приложении EcoHub. Запустите его кнопкой ниже.',
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
    'EcoHub – даром вещи и карта переработки по Беларуси. Найдите бота по имени EcoHub или @EcoHubBY_bot. Запустите мини-приложение и укажите, как к Вам обращаться.',
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
    { command: 'app', description: 'Запустить приложение' },
    { command: 'help', description: 'Справка' },
  ]);
}