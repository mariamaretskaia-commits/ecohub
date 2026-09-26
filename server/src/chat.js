import { get, all, run } from './db.js';
import { findOrCreateUser, displayName, isProfileComplete } from './users.js';
import { pushOpenButtons } from '../../bot/src/createBot.js';
import { moderateChatMessage, notifyAdminsOfUserReport } from './trust/pipeline.js';
import { insertModMessage, insertReport, insertLog } from './trust/store.js';

const CHAT_NOTIFY =
  'У вас есть новые сообщения. Проверьте «Чат» в приложении EcoHub.';

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message || 'Ошибка' });
}

function requireCompleteProfile(user, res) {
  if (isProfileComplete(user)) return true;
  res.status(403).json({ error: 'Сначала укажите, как к Вам обращаться.' });
  return false;
}

const PEER_NAME_SQL = `
  CASE
    WHEN item_wants.buyer_id = ? THEN
      CASE
        WHEN owner.nickname IS NOT NULL AND TRIM(owner.nickname) != '' THEN owner.nickname
        WHEN owner.last_name IS NOT NULL AND owner.last_name != ''
          THEN TRIM(owner.last_name || ' ' || owner.first_name)
        ELSE owner.first_name
      END
    ELSE
      CASE
        WHEN buyer.nickname IS NOT NULL AND TRIM(buyer.nickname) != '' THEN buyer.nickname
        WHEN buyer.last_name IS NOT NULL AND buyer.last_name != ''
          THEN TRIM(buyer.last_name || ' ' || buyer.first_name)
        ELSE buyer.first_name
      END
  END AS peer_name
`;

async function getWantAccess(wantId, userId) {
  return get(`
    SELECT item_wants.*,
           items.title,
           items.status AS item_status,
           items.photo_url,
           items.photos,
           items.user_id AS owner_id,
           owner.telegram_id AS owner_tg,
           buyer.telegram_id AS buyer_tg
    FROM item_wants
    JOIN items ON items.id = item_wants.item_id
    JOIN users owner ON owner.id = items.user_id
    JOIN users buyer ON buyer.id = item_wants.buyer_id
    WHERE item_wants.id = ?
      AND (item_wants.buyer_id = ? OR items.user_id = ?)
      AND NOT (
        (item_wants.hidden_by_owner_at IS NOT NULL AND items.user_id = ?)
        OR (item_wants.hidden_by_buyer_at IS NOT NULL AND item_wants.buyer_id = ?)
      )
  `, wantId, userId, userId, userId, userId);
}

async function markWantRead(want, userId) {
  const isBuyer = Number(want.buyer_id) === Number(userId);
  if (isBuyer) {
    await run(
      "UPDATE item_wants SET buyer_last_read_at = datetime('now') WHERE id = ?",
      want.id,
    );
  } else {
    await run(
      "UPDATE item_wants SET owner_last_read_at = datetime('now') WHERE id = ?",
      want.id,
    );
  }
}

function peerLastReadAt(want, viewerId) {
  const isBuyer = Number(want.buyer_id) === Number(viewerId);
  return isBuyer ? want.owner_last_read_at : want.buyer_last_read_at;
}

function isReadByPeer(message, peerReadAt, viewerId) {
  if (Number(message.sender_id) !== Number(viewerId)) return false;
  if (message.deleted_at) return false;
  if (!peerReadAt) return false;
  return new Date(message.created_at).getTime() <= new Date(peerReadAt).getTime();
}

function enrichMessage(message, viewerId, peerReadAt) {
  const deleted = Boolean(message.deleted_at);
  return {
    ...message,
    body: deleted ? null : message.body,
    photo_url: deleted ? null : message.photo_url,
    is_deleted: deleted,
    read_by_peer: isReadByPeer(message, peerReadAt, viewerId),
  };
}

async function fetchMessageById(messageId) {
  return get(`
    SELECT chat_messages.*,
           CASE
             WHEN users.nickname IS NOT NULL AND TRIM(users.nickname) != '' THEN users.nickname
             WHEN users.last_name IS NOT NULL AND users.last_name != ''
               THEN TRIM(users.last_name || ' ' || users.first_name)
             ELSE users.first_name
           END AS sender_name
    FROM chat_messages
    JOIN users ON users.id = chat_messages.sender_id
    WHERE chat_messages.id = ?
  `, messageId);
}

async function getOwnMessage(messageId, userId) {
  return get(`
    SELECT chat_messages.*,
           item_wants.buyer_id,
           items.user_id AS owner_id,
           items.status AS item_status
    FROM chat_messages
    JOIN item_wants ON item_wants.id = chat_messages.want_id
    JOIN items ON items.id = item_wants.item_id
    WHERE chat_messages.id = ? AND chat_messages.sender_id = ?
  `, messageId, userId);
}

async function notifyRecipient(bot, webAppUrl, want, senderId) {
  if (!bot) return;
  const isBuyer = Number(want.buyer_id) === Number(senderId);
  const recipientTg = isBuyer ? want.owner_tg : want.buyer_tg;
  if (!recipientTg) return;
  try {
    await pushOpenButtons(
      bot.telegram,
      recipientTg,
      webAppUrl,
      `${CHAT_NOTIFY}\n\nВещь: «${want.title}»`,
    );
  } catch {
    /* recipient may not have started bot */
  }
}

export const WANT_OPENING_MESSAGE = 'Хочу взять';

export async function ensureWantOpeningMessage({ wantId, buyerId }) {
  const want = await get(`
    SELECT item_wants.*,
           items.title,
           items.status AS item_status,
           items.user_id AS owner_id,
           owner.telegram_id AS owner_tg,
           buyer.telegram_id AS buyer_tg
    FROM item_wants
    JOIN items ON items.id = item_wants.item_id
    JOIN users owner ON owner.id = items.user_id
    JOIN users buyer ON buyer.id = item_wants.buyer_id
    WHERE item_wants.id = ? AND item_wants.buyer_id = ?
  `, wantId, buyerId);

  if (!want || want.item_status !== 'active') return false;

  const existing = await get(
    'SELECT id FROM chat_messages WHERE want_id = ? LIMIT 1',
    want.id,
  );
  if (existing) return false;

  await run(
    'INSERT INTO chat_messages (want_id, sender_id, body) VALUES (?, ?, ?)',
    want.id,
    buyerId,
    WANT_OPENING_MESSAGE,
  );

  await markWantRead(want, buyerId);
  return true;
}

function _chatRejectionMessage(category) {
  if (category === 'payment_solicit' || category === 'payment_triggers') {
    return 'В чате EcoHub запрещены упоминания денег и оплаты.';
  }
  if (category === 'drugs') return 'В чате EcoHub запрещены упоминания наркотиков.';
  if (category === 'weapons') return 'В чате EcoHub запрещены упоминания оружия.';
  if (category === 'documents') return 'В чате EcoHub запрещены покупка/продажа документов.';
  if (category === 'phishing_patterns') return 'Сообщение отклонено: обнаружена попытка фишинга.';
  return 'Сообщение отклонено модерацией. Проверьте текст и попробуйте переформулировать.';
}

export async function sendChatMessage({ wantId, sender, body, bot, webAppUrl }) {
  const trimmed = String(body || '').trim();
  if (!trimmed) {
    const err = new Error('Введите сообщение');
    err.status = 400;
    throw err;
  }
  if (trimmed.length > 2000) {
    const err = new Error('Слишком длинное сообщение');
    err.status = 400;
    throw err;
  }

  const want = await getWantAccess(wantId, sender.id);
  if (!want) {
    const err = new Error('Переписка не найдена');
    err.status = 404;
    throw err;
  }
  if (want.item_status !== 'active') {
    const err = new Error('Переписка закрыта: вещь уже отдана');
    err.status = 400;
    throw err;
  }

  const existingMessages = await get(
    'SELECT id FROM chat_messages WHERE want_id = ? LIMIT 1',
    want.id,
  );
  const isFirstMessage = !existingMessages && trimmed === WANT_OPENING_MESSAGE;

  const modResult = await moderateChatMessage({
    senderTg: String(sender.telegram_id || sender.id),
    receiverTg: Number(want.buyer_id) === Number(sender.id) ? want.owner_tg : want.buyer_tg,
    senderName: sender.nickname || sender.first_name || '',
    wantId: want.id,
    text: trimmed,
    photoUrl: null,
    firstMessage: Boolean(isFirstMessage),
    bot,
  });

  // Строгая доставка: любое совпадение словаря (включая medium-категории) → не доставляем.
  // ИИ-флаг (source='ai') оставляем мягким: сообщение доставляется и уходит в очередь.
  if (modResult.verdict === 'block' || (modResult.verdict === 'flag' && modResult.source === 'filter')) {
    const err = new Error(_chatRejectionMessage(modResult.category));
    err.status = 400;
    throw err;
  }

  const result = await run(
    'INSERT INTO chat_messages (want_id, sender_id, body) VALUES (?, ?, ?)',
    want.id,
    sender.id,
    trimmed,
  );

  const message = await get(`
    SELECT chat_messages.*,
           CASE
             WHEN users.nickname IS NOT NULL AND TRIM(users.nickname) != '' THEN users.nickname
             WHEN users.last_name IS NOT NULL AND users.last_name != ''
               THEN TRIM(users.last_name || ' ' || users.first_name)
             ELSE users.first_name
           END AS sender_name
    FROM chat_messages
    JOIN users ON users.id = chat_messages.sender_id
    WHERE chat_messages.id = ?
  `, result.lastInsertRowid);

  await markWantRead(want, sender.id);
  await notifyRecipient(bot, webAppUrl, want, sender.id);

  return enrichMessage(message, sender.id, peerLastReadAt(want, sender.id));
}

export function registerChatRoutes(app, authMiddleware, bot, webAppUrl) {
  app.get('/api/chat/unread', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!isProfileComplete(user)) return res.json({ count: 0 });

      const row = await get(`
        SELECT COUNT(*) AS count
        FROM chat_messages cm
        JOIN item_wants iw ON iw.id = cm.want_id
        JOIN items ON items.id = iw.item_id
        WHERE (iw.buyer_id = ? OR items.user_id = ?)
          AND cm.sender_id != ?
          AND cm.deleted_at IS NULL
          AND NOT (
            (iw.hidden_by_owner_at IS NOT NULL AND items.user_id = ?)
            OR (iw.hidden_by_buyer_at IS NOT NULL AND iw.buyer_id = ?)
          )
          AND cm.created_at > COALESCE(
            CASE
              WHEN iw.buyer_id = ? THEN iw.buyer_last_read_at
              ELSE iw.owner_last_read_at
            END,
            '1970-01-01'
          )
      `, user.id, user.id, user.id, user.id, user.id, user.id);

      res.json({ count: Number(row?.count || 0) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/chat/threads', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;

      const threads = await all(`
        SELECT
          item_wants.id AS want_id,
          item_wants.item_id,
          item_wants.created_at AS started_at,
          item_wants.buyer_last_read_at,
          item_wants.owner_last_read_at,
          items.title,
          items.status AS item_status,
          items.photo_url,
          items.photos,
          items.user_id AS owner_id,
          item_wants.buyer_id,
          ${PEER_NAME_SQL},
          (
            SELECT CASE
              WHEN body IS NOT NULL AND TRIM(body) != '' THEN body
              WHEN photo_url IS NOT NULL AND photo_url != '' THEN 'Фото'
              ELSE ''
            END
            FROM chat_messages
            WHERE want_id = item_wants.id AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 1
          ) AS last_body,
          (
            SELECT created_at FROM chat_messages
            WHERE want_id = item_wants.id AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 1
          ) AS last_at,
          (
            SELECT COUNT(*) FROM chat_messages cm
            WHERE cm.want_id = item_wants.id
              AND cm.sender_id != ?
              AND cm.deleted_at IS NULL
              AND cm.created_at > COALESCE(
                CASE
                  WHEN item_wants.buyer_id = ? THEN item_wants.buyer_last_read_at
                  ELSE item_wants.owner_last_read_at
                END,
                '1970-01-01'
              )
          ) AS unread_count
        FROM item_wants
        JOIN items ON items.id = item_wants.item_id
        JOIN users owner ON owner.id = items.user_id
        JOIN users buyer ON buyer.id = item_wants.buyer_id
        WHERE item_wants.buyer_id = ? OR items.user_id = ?
        AND NOT (
          (item_wants.hidden_by_owner_at IS NOT NULL AND items.user_id = ?)
          OR (item_wants.hidden_by_buyer_at IS NOT NULL AND item_wants.buyer_id = ?)
        )
        ORDER BY COALESCE(
          (SELECT created_at FROM chat_messages
           WHERE want_id = item_wants.id AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 1),
          item_wants.created_at
        ) DESC
      `,
      user.id,
      user.id,
      user.id,
      user.id,
      user.id,
      user.id,
      user.id);

      res.json(threads.map((t) => ({
        ...t,
        unread_count: Number(t.unread_count || 0),
        closed: t.item_status !== 'active',
        role: Number(t.owner_id) === Number(user.id) ? 'owner' : 'buyer',
      })));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/chat/threads/:wantId/messages', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;

      const want = await getWantAccess(req.params.wantId, user.id);
      if (!want) return res.status(404).json({ error: 'Переписка не найдена' });

      const messages = await all(`
        SELECT chat_messages.*,
               CASE
                 WHEN users.nickname IS NOT NULL AND TRIM(users.nickname) != '' THEN users.nickname
                 WHEN users.last_name IS NOT NULL AND users.last_name != ''
                   THEN TRIM(users.last_name || ' ' || users.first_name)
                 ELSE users.first_name
               END AS sender_name
        FROM chat_messages
        JOIN users ON users.id = chat_messages.sender_id
        WHERE chat_messages.want_id = ?
        ORDER BY chat_messages.created_at ASC
      `, want.id);

      await markWantRead(want, user.id);

      const freshWant = await getWantAccess(req.params.wantId, user.id);
      const peerRead = peerLastReadAt(freshWant, user.id);

      const isBuyer = Number(want.buyer_id) === Number(user.id);
      const peer = await get('SELECT * FROM users WHERE id = ?', isBuyer ? want.owner_id : want.buyer_id);

      res.json({
        want_id: want.id,
        item_id: want.item_id,
        title: want.title,
        closed: want.item_status !== 'active',
        role: isBuyer ? 'buyer' : 'owner',
        peer_name: displayName(peer),
        peer_last_read_at: peerRead,
        messages: messages.map((m) => enrichMessage(m, user.id, peerRead)),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post(
    '/api/chat/threads/:wantId/messages',
    authMiddleware,
    async (req, res) => {
      try {
        const user = await findOrCreateUser(req.telegramUser);
        if (!requireCompleteProfile(user, res)) return;

        const message = await sendChatMessage({
          wantId: req.params.wantId,
          sender: user,
          body: req.body?.body,
          bot,
          webAppUrl,
        });

        res.status(201).json(message);
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  app.post('/api/chat/messages/:messageId/report', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;

      const msg = await get(`
        SELECT chat_messages.id,
               chat_messages.body,
               chat_messages.photo_url,
               chat_messages.sender_id,
               item_wants.id AS want_id,
               item_wants.buyer_id,
               items.user_id AS owner_id,
               owner.telegram_id AS owner_tg,
               buyer.telegram_id AS buyer_tg,
               sender.telegram_id AS sender_tg,
               CASE
                 WHEN sender.nickname IS NOT NULL AND TRIM(sender.nickname) != '' THEN sender.nickname
                 WHEN sender.last_name IS NOT NULL AND sender.last_name != ''
                   THEN TRIM(sender.last_name || ' ' || sender.first_name)
                 ELSE sender.first_name
               END AS sender_name
        FROM chat_messages
        JOIN item_wants ON item_wants.id = chat_messages.want_id
        JOIN items ON items.id = item_wants.item_id
        JOIN users sender ON sender.id = chat_messages.sender_id
        JOIN users owner ON owner.id = items.user_id
        JOIN users buyer ON buyer.id = item_wants.buyer_id
        WHERE chat_messages.id = ? AND chat_messages.deleted_at IS NULL
      `, req.params.messageId);

      if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

      const isParticipant = Number(msg.buyer_id) === Number(user.id)
        || Number(msg.owner_id) === Number(user.id);
      if (!isParticipant) {
        return res.status(403).json({ error: 'Нет доступа к этой переписке' });
      }
      if (Number(msg.sender_id) === Number(user.id)) {
        return res.status(400).json({ error: 'Нельзя пожаловаться на своё сообщение' });
      }

      const modMsgId = await insertModMessage({
        senderTelegramId: msg.sender_tg,
        receiverTelegramId: Number(msg.buyer_id) === Number(user.id) ? msg.owner_tg : msg.buyer_tg,
        wantId: msg.want_id,
        text: msg.body || '',
        censored: msg.body || '',
        photoUrl: msg.photo_url || null,
        hasLink: false,
        status: 'reported',
        decidedBy: 'user',
        flagsJson: JSON.stringify(['user_report']),
        score: 0,
        level: 'low',
      });

      const reportId = await insertReport({
        msgId: modMsgId,
        senderTelegramId: msg.sender_tg,
        reporterTelegramId: String(user.telegram_id || user.id),
        category: 'user_report',
        source: 'user',
      });

      await insertLog({
        event: 'user_report',
        targetTelegramId: msg.sender_tg,
        actor: String(user.telegram_id || user.id),
        messageId: modMsgId,
        detail: { reportId, wantId: msg.want_id, chatMessageId: msg.id },
      });

      await notifyAdminsOfUserReport({
        bot,
        modMsgId,
        senderTg: msg.sender_tg,
        senderName: msg.sender_name || String(msg.sender_tg || ''),
        body: msg.body ? `«${msg.body}»` : '(фото)',
      });

      res.status(201).json({ ok: true, report_id: reportId });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/chat/threads/:wantId/read', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      const want = await getWantAccess(req.params.wantId, user.id);
      if (!want) return res.status(404).json({ error: 'Переписка не найдена' });
      await markWantRead(want, user.id);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch('/api/chat/messages/:messageId', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;

      const row = await getOwnMessage(req.params.messageId, user.id);
      if (!row) return res.status(404).json({ error: 'Сообщение не найдено' });
      if (row.deleted_at) return res.status(400).json({ error: 'Сообщение уже удалено' });
      if (row.item_status !== 'active') {
        return res.status(400).json({ error: 'Переписка закрыта: вещь уже отдана' });
      }

      const trimmed = String(req.body?.body || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Введите сообщение' });
      if (trimmed.length > 2000) return res.status(400).json({ error: 'Слишком длинное сообщение' });

      const editWant = await getWantAccess(row.want_id, user.id);
      const modResult = await moderateChatMessage({
        senderTg: String(user.telegram_id || user.id),
        receiverTg: Number(editWant?.buyer_id) === Number(user.id) ? editWant?.owner_tg : editWant?.buyer_tg,
        senderName: user.nickname || user.first_name || '',
        wantId: row.want_id,
        text: trimmed,
        photoUrl: row.photo_url,
        firstMessage: false,
        bot,
      });
      if (modResult.verdict === 'block' || (modResult.verdict === 'flag' && modResult.source === 'filter')) {
        return res.status(400).json({ error: _chatRejectionMessage(modResult.category) });
      }

      await run(`
        UPDATE chat_messages
        SET body = ?, edited_at = datetime('now')
        WHERE id = ?
      `, trimmed, row.id);

      const want = await getWantAccess(row.want_id, user.id);
      const message = await fetchMessageById(row.id);
      res.json(enrichMessage(message, user.id, peerLastReadAt(want, user.id)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/chat/messages/:messageId', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;

      const row = await getOwnMessage(req.params.messageId, user.id);
      if (!row) return res.status(404).json({ error: 'Сообщение не найдено' });
      if (row.deleted_at) return res.json({ ok: true });

      await run(`
        UPDATE chat_messages
        SET deleted_at = datetime('now'), body = '', photo_url = NULL
        WHERE id = ?
      `, row.id);

      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/chat/threads/:wantId', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;

      const want = await getWantAccess(req.params.wantId, user.id);
      if (!want) return res.status(404).json({ error: 'Переписка не найдена' });

      const isBuyer = Number(want.buyer_id) === Number(user.id);
      const col = isBuyer ? 'hidden_by_buyer_at' : 'hidden_by_owner_at';
      await run(`UPDATE item_wants SET ${col} = datetime('now') WHERE id = ?`, want.id);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
}
