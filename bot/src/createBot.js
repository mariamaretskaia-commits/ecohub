import { Telegraf, Markup } from 'telegraf';
import { isDeveloperUser, saveDeveloperChatId, getDeveloperChatId } from '../../server/src/suggestions.js';
import { get, run } from '../../server/src/db.js';
import { insertReport, insertBan, countOpenReports, isBanned } from '../../server/src/trust/store.js';
import { adminBanUser } from '../../server/src/trust/pipeline.js';

const LOUD = { disable_notification: false };

function isTrustAdminTg(id) {
  const raw = String(process.env.TRUST_ADMIN_IDS || '').trim();
  if (!raw) return false;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(String(id));
}

function isTrustAdminFrom(ctx) {
  return Boolean(ctx?.from) && (isTrustAdminTg(ctx.from.id) || isDeveloperUser(ctx.from?.username));
}

const BANNED_NOTE =
  '⛔ Ваш аккаунт заблокирован в EcoHub. Приложение и бот недоступны.\n\nЕсли вы считаете, что это ошибка, напишите: /support';

export const BOT_COMMANDS = [
  { command: 'start', description: 'Открыть EcoHub' },
  { command: 'support', description: 'Поддержка: задать вопрос команде' },
  { command: 'app', description: 'Запустить мини-приложение' },
  { command: 'help', description: 'Список команд' },
  { command: 'developer_info', description: 'Разработчик и ваши права' },
  { command: 'privacy', description: 'Политика обработки данных' },
];

const SUPPORT_MODE_PREFIX = 'support_mode_';

const SUPPORT_INTRO = `💬 Поддержка EcoHub

Опишите проблему или вопрос одним сообщением – команда получит его в своём чате и ответит вам сюда же.

Ваши данные не публикуются: имя и username видны только команде.`;

const SUPPORT_RECEIVED = `✅ Запрос отправлен команде EcoHub.

Ответ придёт в этот чат. Спасибо за обратную связь!`;

const SUPPORT_FAILED = `⚠️ Не получилось передать запрос. Попробуйте ещё раз чуть позже командой /support.`;

async function setSupportMode(chatId) {
  try {
    await run(
      "INSERT INTO meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      `${SUPPORT_MODE_PREFIX}${chatId}`,
    );
  } catch (err) {
    console.warn('[support] setSupportMode:', err.message);
  }
}

async function clearSupportMode(chatId) {
  try {
    await run('DELETE FROM meta WHERE key = ?', `${SUPPORT_MODE_PREFIX}${chatId}`);
  } catch (err) {
    console.warn('[support] clearSupportMode:', err.message);
  }
}

async function isSupportMode(chatId) {
  try {
    const row = await get('SELECT value FROM meta WHERE key = ?', `${SUPPORT_MODE_PREFIX}${chatId}`);
    return row?.value === '1';
  } catch {
    return false;
  }
}

/** Пересылает сообщение пользователя команде (в публичный доступ не попадает). */
export async function sendSupportTicket(bot, from, chatId, message) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Аноним';
  const username = from?.username ? `@${from.username}` : '';
  const identity = name + (username ? ` (${username})` : '');
  const body = message?.text
    || (message?.caption ? `📷 ${message.caption}` : null)
    || (message?.photo ? '📷 Фото' : null)
    || '(без текста)';

  const text = [
    '🛟 Запрос в поддержку',
    `От: ${identity}`,
    `TG id: ${String(from?.id || '')} · чат: ${String(chatId)}`,
    '',
    String(body),
  ].join('\n');

  try {
    const devChatId = await getDeveloperChatId();
    if (!devChatId) return { delivered: false, reason: 'no-chat-id', text };
    const sent = await bot.telegram.sendMessage(devChatId, text, { disable_notification: false });
    await run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      `support_devmsg_${sent.message_id}`,
      JSON.stringify({ user: String(chatId), dev: String(devChatId) }),
    );
    return { delivered: true, chatId: devChatId, messageId: sent.message_id, text };
  } catch (err) {
    console.warn('[support] ticket forward failed:', err.message);
    return { delivered: false, reason: err.message, text };
  }
}

/**
 * Ответ поддержки на запрос пользователя. Отправляет текст в чат пользователя
 * от имени бота, без данных самой поддержки (анонимно).
 */
export async function sendSupportReply(bot, devChatId, mappingJson, message) {
  let mapping;
  try {
    mapping = JSON.parse(mappingJson);
  } catch {
    mapping = null;
  }
  if (!mapping || String(devChatId) !== String(mapping.dev)) {
    return { ok: false, reason: 'not-a-support-chat' };
  }
  const text = String(message?.text || message?.caption || '').trim();
  if (!text) return { ok: false, reason: 'empty-reply' };

  try {
    await bot.telegram.sendMessage(mapping.user, `💬 Ответ команды EcoHub:\n\n${text}`, {
      disable_notification: false,
    });
    return { ok: true, to: mapping.user };
  } catch (err) {
    console.warn('[support] answer delivery failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

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

  // Забаненные пользователи: разрешены только /start и /support.
  bot.use(async (ctx, next) => {
    try {
      if (ctx.from?.id) {
        const banned = await isBanned(String(ctx.from.id));
        if (banned) {
          const cmd = String(ctx.message?.text || '').split(/\s/)[0].toLowerCase();
          if (cmd === '/start' || cmd === '/support') return next();
          if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Ваш аккаунт заблокирован в EcoHub.').catch(() => {});
            return undefined;
          }
          if (ctx.message?.text || ctx.message?.photo) {
            await ctx.reply(BANNED_NOTE, LOUD);
            return undefined;
          }
        }
      }
    } catch (err) {
      console.warn('[bot] ban check failed:', err.message);
    }
    return next();
  });

  const welcomeText = `♻️ EcoHub – приложение, в котором вещи получают вторую жизнь.

Бесплатно отдайте то, что не нужно, и найдите, что нужно вам. Карта подскажет, куда сдать вторсырьё.

Всё происходит в мини-приложении: профиль, объявления, чат и карта. Откройте его кнопкой «Запустить EcoHub» и укажите, как к Вам обращаться.

💡 Чтобы не пропустить отклики: ⋮ → «Уведомления» → «Включены».`;

  bot.start(async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
    await clearSupportMode(ctx.chat.id);
    if (ctx.startPayload === 'support') {
      await setSupportMode(ctx.chat.id);
      await ctx.reply(SUPPORT_INTRO, LOUD);
      return;
    }
    await pushOpenButtons(ctx.telegram, ctx.chat.id, webAppUrl, welcomeText);
  });

  bot.command('app', async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
    await clearSupportMode(ctx.chat.id);
    await pushOpenButtons(ctx.telegram, ctx.chat.id, webAppUrl, 'Запустите мини-приложение кнопкой ниже:');
  });

  bot.command('phone', async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
    await clearSupportMode(ctx.chat.id);
    await pushOpenButtons(
      ctx.telegram,
      ctx.chat.id,
      webAppUrl,
      'Профиль EcoHub привязан к этому Telegram, не к номеру. Один аккаунт – один профиль.',
    );
  });

  bot.command('support', async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
    await setSupportMode(ctx.chat.id);
    await ctx.reply(SUPPORT_INTRO, LOUD);
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      '/start – открыть EcoHub\n/support – поддержка и связь с командой\n/app – кнопка запуска приложения\n/developer_info – разработчик и ваши права\n/privacy – политика обработки данных\n\nОбъявления, переписка и карта пунктов приёма – внутри мини-приложения.',
      LOUD,
    );
  });

  bot.command('developer_info', async (ctx) => {
    if (isDeveloperUser(ctx.from?.username)) await saveDeveloperChatId(ctx.chat.id);
    await clearSupportMode(ctx.chat.id);
    const base = String(webAppUrl || '').replace(/\/$/, '');
    await ctx.reply(
      [
        'ℹ️ Разработчик EcoHub',
        'Проект EcoHub, Республика Беларусь, г. Гродно.',
        '',
        'Связь с командой: /support',
        '',
        `📄 Политика обработки данных:\n${base}/privacy.html`,
        `📜 Правила сообщества:\n${base}/rules.html`,
        '',
        'Ваши права: скачать копию своих данных («Профиль» → «Скачать мои данные») или удалить их в любой момент («Профиль» → «Удалить профиль»). Ответ на запросы – в срок до 15 дней.',
      ].join('\n'),
      LOUD,
    );
  });

  bot.command('privacy', async (ctx) => {
    await clearSupportMode(ctx.chat.id);
    const base = String(webAppUrl || '').replace(/\/$/, '');
    await ctx.reply(
      `📄 Политика обработки данных EcoHub:\n${base}/privacy.html\n\nКакие данные храним, зачем, как удалить или получить свою копию. Правила сообщества: /developer_info`,
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

    // Ответ поддержки (реплай на «🛟 Запрос в поддержку» в чате поддержки).
    const replyToId = ctx.message.reply_to_message?.message_id;
    if (replyToId) {
      const mapped = await get('SELECT value FROM meta WHERE key = ?', `support_devmsg_${replyToId}`);
      if (mapped?.value) {
        const res = await sendSupportReply(bot, String(ctx.chat.id), mapped.value, ctx.message);
        if (res.ok) {
          await ctx.reply('✅ Ответ отправлен пользователю.', LOUD);
          return;
        }
        if (res.reason === 'empty-reply') {
          await ctx.reply('Пока поддержка отвечает текстом – напишите текст сообщения.', LOUD);
          return;
        }
        if (res.reason !== 'not-a-support-chat') {
          await ctx.reply(`⚠️ Не удалось отправить ответ: ${res.reason}`, LOUD);
          return;
        }
      }
    }

    if (await isSupportMode(ctx.chat.id)) {
      const result = await sendSupportTicket(bot, ctx.from, ctx.chat.id, ctx.message);
      await clearSupportMode(ctx.chat.id);
      await ctx.reply(result.delivered ? SUPPORT_RECEIVED : SUPPORT_FAILED, LOUD);
      return;
    }

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
      if (!msgId || !['report', 'appeal', 'adban', 'adskip'].includes(action)) {
        return await ctx.answerCbQuery('Неизвестная команда');
      }

      // Предупреждение от админа по жалобе пользователя.
      if (action === 'adban' || action === 'adskip') {
        if (!isTrustAdminFrom(ctx)) return await ctx.answerCbQuery('Только для команды EcoHub');
        const modMsg = await get('SELECT * FROM mod_messages WHERE id = ?', msgId);
        if (!modMsg) return await ctx.answerCbQuery('Заявка уже обработана');
        const actor = String(ctx.from?.id || '');

        if (action === 'adban') {
          await adminBanUser(
            modMsg.sender_telegram_id,
            'Пожизненная блокировка: подтверждённая жалоба в чате',
            'user_report',
            actor,
            null,
          );
          await run(
            "UPDATE mod_reports SET status = 'confirmed', resolved_at = datetime('now'), resolved_by = ? WHERE sender_telegram_id = ? AND status = 'open'",
            actor,
            String(modMsg.sender_telegram_id || ''),
          );
          await run(
            "INSERT INTO mod_log (event, target_telegram_id, actor, message_id, detail_json) VALUES ('admin_ban_user', ?, 'admin', ?, ?)",
            String(modMsg.sender_telegram_id || ''),
            msgId,
            JSON.stringify({ reason: 'жалоба в чате', by: actor }),
          );
          try {
            await ctx.telegram.sendMessage(
              modMsg.sender_telegram_id,
              BANNED_NOTE,
              LOUD,
            ).catch(() => {});
          } catch { /* noop */ }
          return await ctx.answerCbQuery('Пользователь забанен навсегда (приложение и бот).');
        }

        await run(
          "UPDATE mod_reports SET status = 'dismissed', resolved_at = datetime('now'), resolved_by = ? WHERE message_id = ? AND status = 'open'",
          actor,
          msgId,
        );
        await run(
          "INSERT INTO mod_log (event, target_telegram_id, actor, message_id, detail_json) VALUES ('admin_dismiss', ?, 'admin', ?, ?)",
          String(modMsg.sender_telegram_id || ''),
          msgId,
          JSON.stringify({ by: actor }),
        );
        return await ctx.answerCbQuery('Заявка закрыта без нарушений.');
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

/** Регистрирует список команд бота (меню в Telegram). Идемпотентно. */
export async function registerBotCommands(telegram) {
  try {
    await telegram.setMyCommands(BOT_COMMANDS);
    console.log('🤖 Команды бота: /start /support /app /help /developer_info /privacy');
  } catch (err) {
    console.warn('[support] setMyCommands failed:', err.message);
  }
}