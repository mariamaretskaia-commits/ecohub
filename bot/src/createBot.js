import { Telegraf, Markup } from 'telegraf';
import { isDeveloperUser, saveDeveloperChatId } from '../../server/src/suggestions.js';
import { get, run } from '../../server/src/db.js';
import { insertReport, insertBan, countOpenReports } from '../../server/src/trust/store.js';

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
  await telegram.sendMessage(chatId, text, { ...ui.inline, ...LOUD });
}

export function createBot(token, webAppUrl) {
  const bot = new Telegraf(token);

  const welcomeText = `♻️ EcoHub — приложение, в котором вещи получают вторую жизнь.

Бесплатно отдайте то, что не нужно, и найдите, что нужно вам. Карта подскажет, куда сдать вторсырьё.

Всё происходит в мини-приложении: профиль, объявления, чат и карта. Откройте его кнопкой «Запустить EcoHub» и укажите, как к Вам обращаться.

💡 Чтобы не пропустить отклики: ⋮ → «Уведомления» → «Включены».`;

  bot.start(async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
    await pushOpenButtons(ctx.telegram, ctx.chat.id, webAppUrl, welcomeText);
  });

  bot.command('app', async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
    await pushOpenButtons(ctx.telegram, ctx.chat.id, webAppUrl, 'Запустите мини-приложение кнопкой ниже:');
  });

  bot.command('phone', async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
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
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
    await ctx.reply(
      'Профиль уже привязан к этому Telegram. Запустите EcoHub кнопкой ниже.',
      { ...buttonSets(webAppUrl).inline, ...LOUD },
    );
  });

  bot.on('message', async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
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

  bot.on('callback_query', async (ctx) => {
    try {
      const data = String(ctx.callbackQuery?.data || '');
      const [action, idRaw] = data.split(':');
      const msgId = Number(idRaw);
      if (!msgId || !['report', 'appeal'].includes(action)) {
        return await ctx.answerCbQuery('Неизвестная команда');
      }
      const modMsg = await get('SELECT * FROM mod_messages WHERE id = ?', msgId);
      if (!modMsg) return await ctx.answerCbQuery('Сообщение уже удалено');

      const reporterTg = String(ctx.from?.id || '');

      if (action === 'report') {
        await insertReport({
          msgId,
          senderTelegramId: modMsg.sender_telegram_id,
          reporterTelegramId: reporterTg,
          category: 'user_report',
          source: 'user',
        });
        const openCount = await countOpenReports(modMsg.sender_telegram_id);
        if (openCount >= 3) {
          await insertBan({
            telegramId: modMsg.sender_telegram_id,
            reason: `3+ открытых жалоб за 30 дней (репорт от ${reporterTg})`,
            category: 'user_report',
            bannedBy: 'system',
          });
          await run(
            "INSERT INTO mod_log (event, target_telegram_id, actor, message_id, detail_json) VALUES ('auto_ban', ?, 'system', ?, ?)",
            String(modMsg.sender_telegram_id || ''),
            msgId,
            JSON.stringify({ reason: '3+ open reports/30d via callback', reports: openCount }),
          );
          await ctx.answerCbQuery('Жалоба принята. Пользователь автоматически заблокирован.');
        } else {
          await ctx.answerCbQuery('Спасибо, жалоба принята.');
        }
      } else {
        await run(
          "UPDATE mod_reports SET status = 'dismissed', resolved_at = datetime('now'), resolved_by = ? WHERE message_id = ? AND status = 'open'",
          reporterTg,
          msgId,
        );
        await run(
          "INSERT INTO mod_log (event, target_telegram_id, actor, message_id, detail_json) VALUES ('report_appeal', ?, 'system', ?, ?)",
          String(modMsg.sender_telegram_id || ''),
          msgId,
          JSON.stringify({ appealer: reporterTg }),
        );
        await ctx.answerCbQuery('Спасибо, снято с проверки.');
      }
    } catch (err) {
      console.error('Callback error:', err.message);
      try {
        await ctx.answerCbQuery('Произошла ошибка.');
      } catch { /* noop */ }
    }
  });

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  return bot;
}