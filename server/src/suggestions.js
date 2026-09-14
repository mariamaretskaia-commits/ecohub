import { get, run } from './db.js';
import { findOrCreateUser } from './users.js';

const DEVELOPER_USERNAMES = ['maryssiu'];

export const ACCESS_LABELS = {
  counter: 'Пункт переработки',
  desk: 'Центр помощи',
  box: 'Контейнер',
};

export function isDeveloperUser(username) {
  return DEVELOPER_USERNAMES.includes(String(username || '').trim().toLowerCase());
}

export async function saveDeveloperChatId(chatId) {
  if (!chatId) return;
  try {
    await run(
      "INSERT INTO meta (key, value) VALUES ('dev_telegram_chat_id', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      String(chatId),
    );
  } catch (err) {
    console.warn('[suggestions] saveDeveloperChatId:', err.message);
  }
}

async function developerChatId() {
  const env = String(process.env.DEVELOPER_TELEGRAM_ID || '').trim();
  if (env) return env;
  try {
    const row = await get("SELECT value FROM meta WHERE key = 'dev_telegram_chat_id'");
    return row?.value || '';
  } catch {
    return '';
  }
}

export async function getDeveloperChatId() {
  return developerChatId();
}

/** Отправляет личное сообщение разработчику. Предложения не видят другие пользователи. */
export async function notifyDeveloper(bot, text) {
  const chatId = await developerChatId();
  if (!chatId) return { delivered: false, reason: 'no-chat-id' };
  if (!bot) return { delivered: false, reason: 'no-bot' };
  try {
    await bot.telegram.sendMessage(chatId, text, { disable_notification: false });
    return { delivered: true, chatId };
  } catch (err) {
    console.warn('[suggestions] sendMessage failed:', err.message);
    return { delivered: false, reason: err.message };
  }
}

export function registerSuggestionRoutes(app, bot, auth = (_req, _res, next) => next()) {
  app.post('/api/suggest-point', auth, async (req, res) => {
    try {
      const { type, address, contact } = req.body || {};
      const access = typeof type === 'string' ? type.trim() : '';
      const addr = typeof address === 'string' ? address.trim() : '';
      const contactText = typeof contact === 'string' ? contact.trim() : '';

      if (!ACCESS_LABELS[access]) return res.status(400).json({ error: 'Не выбран тип пункта' });
      if (!addr) return res.status(400).json({ error: 'Укажите адрес' });
      if (addr.length > 500) return res.status(400).json({ error: 'Адрес слишком длинный' });
      if (contactText.length > 200) return res.status(400).json({ error: 'Контакт слишком длинный' });

      const userId = req.telegramUser ? (await findOrCreateUser(req.telegramUser).catch(() => null))?.id ?? null : null;
      const r = await run(
        "INSERT INTO point_suggestions (type, address, contact, status, user_id) VALUES (?, ?, ?, 'new', ?)",
        access,
        addr,
        contactText || null,
        userId,
      );

      const text = [
        '🙋 Новое предложение пункта',
        `Тип: ${ACCESS_LABELS[access]}`,
        `Адрес: ${addr}`,
        contactText ? `Контакт: ${contactText}` : 'Контакт не указан',
        '',
        `#${r.lastInsertRowid} · ${new Date().toISOString()}`,
      ].join('\n');

      const result = await notifyDeveloper(bot, text);
      await run(
        'UPDATE point_suggestions SET status = ?, notified = ? WHERE id = ?',
        result.delivered ? 'notified' : 'saved',
        result.delivered ? 1 : 0,
        r.lastInsertRowid,
      );

      res.json({ ok: true, id: r.lastInsertRowid, delivered: result.delivered });
    } catch (err) {
      console.error('[suggestions] error:', err.message);
      res.status(500).json({ error: 'Не удалось сохранить предложение' });
    }
  });
}