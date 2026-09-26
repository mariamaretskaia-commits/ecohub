/**
 * Пайплайн модерации (порт из app/services/pipeline.py).
 * Единая точка входа: moderateChatMessage / moderateItem.
 *
 * Порядок: 1) detect_links → 2) check_text → 3) check_message_for_fraud →
 *          4) AI (если словарь молчит + есть картинка/сигналы) →
 *          5) trust score → 6) вердикт → 7) персист + лог → 8) push.
 */
import { detectLinks, checkLinks, maskLinks } from './linkDetector.js';
import { checkText, checkMessageForFraud, censorText } from './textFilter.js';
import { moderateContent, photoToAiRef } from '../aiModeration.js';
import { compute } from './trustScore.js';
import {
  isBanned,
  buildSignals,
  updateTrust,
  insertModMessage,
  insertReport,
  insertLog,
  markFirstMsgPenalty,
  insertBan,
  countOpenReports,
  autoBanIfNeeded,
} from './store.js';
import { get, all, run } from '../db.js';

const HARD_BLOCK_TYPES = new Set(['drugs', 'weapons', 'documents']);

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
function _rank(s) { return SEVERITY_RANK[s] || 1; }

function _finalSeverity(verdict) {
  return { block: 'high', flag: 'medium', clean: 'low' }[verdict] || 'low';
}

function parseAdminIds() {
  const raw = String(process.env.TRUST_ADMIN_IDS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseTrustToken() {
  return String(process.env.TRUST_ADMIN_TOKEN || '').trim();
}

// ─── notifications ──────────────────────────────────────────────────
const _notifyRate = new Map(); // senderId → lastNotifiedTs

function _canNotify(senderId) {
  const now = Date.now();
  const last = _notifyRate.get(senderId) || 0;
  if (now - last < 3600_000) return false;
  _notifyRate.set(senderId, now);
  return true;
}

async function _sendNote(bot, chatId, text, extra = {}) {
  if (!bot || !chatId) return false;
  try {
    await bot.telegram.sendMessage(chatId, text, { disable_notification: false, ...extra });
    return true;
  } catch {
    /* recipient may not have started bot */
    return false;
  }
}

function _adminNote(senderName, score, level, category, msgId) {
  return [
    `🚨 **Модерация** – ${category || 'подозрительная активность'}`,
    `Пользователь: ${senderName}`,
    `Trust: ${score} (${level})`,
    '',
    `Посмотреть очередь:`,
  ].join('\n');
}

/**
 * Админ-уведомление о жалобе от пользователя: бот шлёт админам текст
 * сообщения и кнопки adban:/adskip: на mod_messages.id.
 */
export async function notifyAdminsOfUserReport({ bot, modMsgId, senderTg, senderName, body }) {
  const text = [
    '🚨 Жалоба от пользователя в чате EcoHub',
    `Написал(а): ${senderName || String(senderTg || '')}`,
    `TG id: ${String(senderTg || '')}`,
    '',
    String(body || ''),
    '',
    `Заявка #${modMsgId}`,
  ].join('\n');
  const keyboard = {
    inline_keyboard: [
      [
        { text: '⛔ Забанить навсегда', callback_data: `adban:${modMsgId}` },
        { text: '✅ Без нарушений', callback_data: `adskip:${modMsgId}` },
      ],
    ],
  };
  let deliveredTo = 0;
  for (const adminId of parseAdminIds()) {
    deliveredTo += (await _sendNote(bot, adminId, text, { reply_markup: keyboard })) ? 1 : 0;
  }
  if (!deliveredTo) {
    const devRow = await get("SELECT value FROM meta WHERE key = 'dev_telegram_chat_id'").catch(() => null);
    const devChatId = String(process.env.DEVELOPER_TELEGRAM_ID || devRow?.value || '').trim();
    if (devChatId) await _sendNote(bot, devChatId, text, { reply_markup: keyboard });
  }
  return deliveredTo;
}

function _receiverNote(senderName, category, msgId) {
  return [
    `⚠️ Сообщение от ${senderName} задержано модерацией (${category || 'проверка'}).`,
    'Если вы видите подозрительное сообщение – используйте кнопку ниже.',
  ].join('\n');
}

function _senderBlockedNote() {
  return '⛔ Ваше сообщение отклонено модерацией. Если вы считаете, что это ошибка – напишите /start боту.';
}

// ─── public API ─────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {string}        params.senderTg       – telegram_id отправителя
 * @param {string|null}   params.receiverTg     – telegram_id получателя (чат)
 * @param {number|null}   params.wantId         – item_wants.id (для чата)
 * @param {number|null}   params.itemId         – items.id (для объявлений)
 * @param {string}        params.senderName     – отображаемое имя отправителя
 * @param {string}        params.text
 * @param {string|null}   params.photoUrl
 * @param {boolean}       params.firstMessage   – первое сообщение в переписке?
 * @param {object|null}   params.bot            – Telegraf instance
 * @returns {Promise<object>} verdict
 */
export async function moderateChatMessage({ senderTg, receiverTg, wantId, text, photoUrl, firstMessage, bot, senderName }) {
  const senderIdStr = String(senderTg);

  if (await isBanned(senderIdStr)) {
    const err = new Error('Вы заблокированы в системе модерации.');
    err.status = 403;
    throw err;
  }

  const links = detectLinks(text || '');
  const { hidden: hiddenLinks } = checkLinks(links);
  const hasLink = links.length > 0;

  const txt = checkText(text || '');
  const fraud = checkMessageForFraud(text || '', {
    firstMessage: Boolean(firstMessage),
    hasLink,
    hasUntrustedLink: hiddenLinks.length > 0,
  });
  const filterRes = _rank(fraud.severity) >= _rank(txt.severity) ? fraud : txt;

  // 4. AI (Nemotron → OpenAI omni → Zhipu; словарь уже отработал первым слоем)
  const signals = await buildSignals(senderTg, { firstMessage });
  const needAi = !filterRes.flagged && (photoUrl || firstMessage || signals.acct_age_days < 7 || hasLink);

  let ai = null;
  if (needAi) {
    ai = await moderateContent({ text: text || '', imageBase64: photoUrl, contentType: 'message' });
  }
  const aiFlagExtra = ai ? ai.categories : [];

  // 5. trust
  const [score, level] = compute(signals);

  // 6. verdict
  let verdict = 'clean';
  let category = null;
  let censored = text || '';
  let source = 'filter';
  let requiresManual = false;

  if (filterRes.flagged) {
    if (HARD_BLOCK_TYPES.has(filterRes.type)) {
      verdict = 'block';
      requiresManual = true;
    } else if (filterRes.type === 'fraud' || filterRes.type === 'phishing') {
      verdict = _rank(filterRes.severity) >= _rank('high') ? 'block' : 'flag';
      const ct = censorText(text || '');
      censored = ct.censored;
    }
    category = filterRes.category;
    source = filterRes.source;
  }

  if (verdict === 'clean' && ai) {
    if (ai.action === 'block') {
      verdict = 'block';
      requiresManual = true;
      category = aiFlagExtra[0] || 'ai';
      source = 'ai';
    } else if (ai.action === 'review') {
      verdict = 'flag';
      requiresManual = true;
      category = aiFlagExtra[0] || 'review';
      source = 'ai';
      const ct = censorText(text || '');
      censored = ct.censored;
    }
  }

  if (verdict === 'clean') censored = text;
  const pendingAiReview = Boolean(ai && ai.available === false && verdict === 'clean');

  if (hiddenLinks.length > 0 && censored) {
    const masked = maskLinks(censored, hiddenLinks);
    censored = masked.censored;
  }

  const status = pendingAiReview ? 'pending' : ({ block: 'blocked', flag: 'flagged', clean: 'clean' }[verdict]);

  // 7. persist
  const msgId = await insertModMessage({
    senderTelegramId: senderIdStr,
    receiverTelegramId: receiverTg ? String(receiverTg) : null,
    wantId,
    text: text || '',
    censored,
    photoUrl,
    hasLink,
    status,
    decidedBy: source,
    flagsJson: JSON.stringify((Array.isArray(filterRes.matched) && filterRes.matched.length)
      ? filterRes.matched
      : (pendingAiReview ? ['ai_unavailable'] : aiFlagExtra)),
    score,
    level,
  });

  if (verdict === 'block') {
    await insertReport({ msgId, senderTelegramId: senderIdStr, category: category || 'other', source: source === 'ai' ? 'ai' : 'filter' });
    await insertLog({ event: 'auto_block', targetTelegramId: senderIdStr, actor: 'system', messageId: msgId, detail: { verdict, type: filterRes.type || 'ai', matched: filterRes.matched || aiFlagExtra, source, category } });
  }
  if (verdict === 'flag') {
    await insertReport({ msgId, senderTelegramId: senderIdStr, category: category || 'manual', source: source === 'ai' ? 'ai' : 'filter' });
    await insertLog({ event: 'auto_flag', targetTelegramId: senderIdStr, actor: 'system', messageId: msgId, detail: { verdict, type: category, matched: filterRes.matched || aiFlagExtra, source, severity: _finalSeverity(verdict) } });
  }
  if (pendingAiReview) {
    await insertLog({ event: 'ai_pending', targetTelegramId: senderIdStr, actor: 'system', messageId: msgId, detail: { reason: ai && (ai.reasoning || 'ai_unavailable') || 'ai_unavailable' } });
  }
  if (hiddenLinks.length > 0) {
    await insertLog({ event: 'link_hidden', targetTelegramId: senderIdStr, actor: 'system', messageId: msgId, detail: { domains: hiddenLinks.map((l) => l.domain) } });
  }

  // trust persist
  await updateTrust(senderTg, signals);
  if (signals.suspicious_first_msg && !signals.first_msg_penalty_applied) {
    await markFirstMsgPenalty(senderTg);
  }

  // auto-ban
  if (verdict !== 'clean') {
    const banned = await autoBanIfNeeded(senderIdStr, msgId, category);
    if (banned) {
      await insertLog({ event: 'auto_ban', targetTelegramId: senderIdStr, actor: 'system', messageId: msgId, detail: { reason: '3+ open reports/30d' } });
    }
  }

  // 8. push (best-effort)
  if (verdict !== 'clean' && _canNotify(senderIdStr)) {
    // Мягкий ИИ-флаг (источник 'ai') — сообщение доставлено, поэтому предупреждаем получателя.
    // Фильтр-bлок/filter-флаг не доставляются (строгая политика в chat.js) — получателю не шлём.
    if (receiverTg && verdict === 'flag' && source === 'ai') {
      const name = senderName || senderIdStr;
      await _sendNote(bot, receiverTg, _receiverNote(name, category || filterRes.type || 'проверка', msgId), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚫 Заблокировать', callback_data: `report:${msgId}` },
              { text: '✅ Это нормально', callback_data: `appeal:${msgId}` },
            ],
          ],
        },
      });
    }
    await _sendNote(bot, senderIdStr, _senderBlockedNote());
  }

  if ((verdict === 'block' || requiresManual) && _canNotify(`admin_${senderIdStr}`)) {
    const adminText = _adminNote(senderName || senderIdStr, score, level, category || filterRes.type || 'ai', msgId);
    let deliveredTo = 0;
    for (const adminId of parseAdminIds()) {
      deliveredTo += (await _sendNote(bot, adminId, adminText)) ? 1 : 0;
    }
    // fallback на dev chat (из meta, как в suggestions.js)
    if (!deliveredTo) {
      const devRow = await get("SELECT value FROM meta WHERE key = 'dev_telegram_chat_id'").catch(() => null);
      const devChatId = String(process.env.DEVELOPER_TELEGRAM_ID || devRow?.value || '').trim();
      if (devChatId) await _sendNote(bot, devChatId, adminText);
    }
  }

  return { verdict, severity: _finalSeverity(verdict), category, source, score, level, censored, msgId, requiresManual, pendingAiReview };
}

/**
 * Модерация объявления (POST/PATCH items). 
 * imageBase64 - data-URI/база64 первого фото (опционально).
 * Возвращает {ok, verdict, msgId} или бросает err.status=400.
 */
export async function moderateItem({ senderTg, senderName, title, description, imageBase64 }) {
  const senderIdStr = String(senderTg);
  const text = `${title || ''} ${description || ''}`.trim();

  if (await isBanned(senderIdStr)) {
    const err = new Error('Вы заблокированы в системе модерации.');
    err.status = 403;
    throw err;
  }

  const links = detectLinks(text);
  const { hidden: hiddenLinks } = checkLinks(links);
  const hasLink = links.length > 0;

  const txt = checkText(text);
  const fraud = checkMessageForFraud(text, { hasLink, hasUntrustedLink: hiddenLinks.length > 0 });
  const filterRes = _rank(fraud.severity) >= _rank(txt.severity) ? fraud : txt;

  const signals = await buildSignals(senderTg);
  const [score, level] = compute(signals);

  let verdict = 'clean';
  let category = null;
  let source = 'filter';
  let requiresManual = false;
  let censored = text;

  if (filterRes.flagged) {
    if (HARD_BLOCK_TYPES.has(filterRes.type)) {
      verdict = 'block';
      requiresManual = true;
    } else if (filterRes.type === 'fraud' || filterRes.type === 'phishing') {
      verdict = _rank(filterRes.severity) >= _rank('high') ? 'block' : 'flag';
      censored = censorText(text).censored;
    }
    category = filterRes.category;
    source = filterRes.source;
  }

  if (verdict === 'clean' && hiddenLinks.length > 0) {
    censored = maskLinks(censored, hiddenLinks).censored;
  }

  // ИИ-модерация (Nemotron → OpenAI omni → Zhipu). Словарь выше — первый слой.
  // Не блокирует дольше AI_MODERATION_BUDGET_MS и при недоступности ИИ
  // публикует с меткой pending_ai_review.
  let aires = null;
  let pendingAiReview = false;
  if (verdict === 'clean' && text) {
    aires = await moderateContent({ text, imageBase64, contentType: 'listing' });
    if (aires.available === false) {
      pendingAiReview = true;
    } else if (aires.action === 'block') {
      verdict = 'block';
      requiresManual = true;
      category = aires.categories[0] || 'ai';
      source = 'ai';
    } else if (aires.action === 'review') {
      verdict = 'flag';
      requiresManual = true;
      category = aires.categories[0] || 'review';
      source = 'ai';
    }
  }

  const status = pendingAiReview ? 'pending' : ({ block: 'blocked', flag: 'flagged', clean: 'clean' }[verdict]);

  const msgId = await insertModMessage({
    senderTelegramId: senderIdStr,
    itemId: null,
    text,
    censored,
    hasLink,
    status,
    decidedBy: source,
    flagsJson: JSON.stringify((Array.isArray(filterRes.matched) && filterRes.matched.length)
      ? filterRes.matched
      : (pendingAiReview ? ['ai_unavailable'] : (aires ? aires.categories : []))),
    score,
    level,
  });

  if (verdict === 'block') {
    await insertReport({ msgId, senderTelegramId: senderIdStr, category: category || 'other', source });
    await insertLog({ event: 'auto_block', targetTelegramId: senderIdStr, actor: 'system', messageId: msgId, detail: { verdict, type: filterRes.type, matched: filterRes.matched, source, category } });
  }
  if (verdict === 'flag') {
    await insertReport({ msgId, senderTelegramId: senderIdStr, category: category || 'manual', source });
    await insertLog({ event: 'auto_flag', targetTelegramId: senderIdStr, actor: 'system', messageId: msgId, detail: { verdict, type: category, matched: filterRes.matched, source, severity: _finalSeverity(verdict) } });
  }
  if (pendingAiReview) {
    await insertLog({ event: 'ai_pending', targetTelegramId: senderIdStr, actor: 'system', messageId: msgId, detail: { reason: aires && (aires.reasoning || 'ai_unavailable') || 'ai_unavailable' } });
  }

  await updateTrust(senderTg, signals);
  if (verdict !== 'clean') await autoBanIfNeeded(senderIdStr, msgId, category);

  if (verdict === 'block') {
    const err = new Error(source === 'ai'
      ? 'Объявление не прошло автоматическую модерацию. Если вы считаете, что это ошибка – напишите /start боту.'
      : 'Объявление не прошло модерацию. Проверьте текст и попробуйте переформулировать.');
    err.status = 400;
    throw err;
  }

  return { ok: true, verdict, category, score, level, msgId, pendingAiReview };
}

const ITEM_AUDIT_MAX_PHOTOS = 4;

async function _notifyAdmins(bot, text) {
  let deliveredTo = 0;
  for (const adminId of parseAdminIds()) {
    deliveredTo += (await _sendNote(bot, adminId, text)) ? 1 : 0;
  }
  if (!deliveredTo) {
    const devRow = await get("SELECT value FROM meta WHERE key = 'dev_telegram_chat_id'").catch(() => null);
    const devChatId = String(process.env.DEVELOPER_TELEGRAM_ID || devRow?.value || '').trim();
    if (devChatId) await _sendNote(bot, devChatId, text);
  }
}

/**
 * Фоновая ИИ-проверка объявления после публикации. Не блокирует создание:
 * при нарушениях ставит items.mod_status='flagged' (скрывает из чужой ленты)
 * и заводит тикет в очередь модерации. Вызывается fire-and-forget.
 */
export async function auditItemAsync({ senderTg, itemId, title, description, photoUrls = [], bot } = {}) {
  try {
    const senderIdStr = String(senderTg || '');
    const text = `${title || ''} ${description || ''}`.trim();

    const flags = [];
    const photos = (Array.isArray(photoUrls) ? photoUrls : []).filter(Boolean).slice(0, ITEM_AUDIT_MAX_PHOTOS);

    if (photos.length === 0) {
      const r = await moderateContent({ text, contentType: 'listing' });
      if (r.available && r.flagged && r.action !== 'pass') {
        flags.push(...(r.categories.length ? r.categories : ['ai_flag']));
      }
    } else {
      for (const url of photos) {
        const ref = photoToAiRef(url);
        const r = await moderateContent({ text, imageBase64: ref, contentType: 'listing' });
        if (!r.available) continue;
        if (r.flagged && r.action !== 'pass') {
          flags.push(...(r.categories.length ? r.categories : ['image_unsafe']));
        }
      }
    }
    if (!flags.length) return { ok: true, flagged: false };

    const category = String(flags[0] || 'other');
    await run("UPDATE items SET mod_status = 'flagged' WHERE id = ?", itemId);
    const msgId = await insertModMessage({
      senderTelegramId: senderIdStr,
      itemId,
      text,
      censored: text,
      photoUrl: photos[0] || null,
      hasLink: detectLinks(text).length > 0,
      status: 'flagged',
      decidedBy: 'ai',
      flagsJson: JSON.stringify(flags),
      score: 0,
      level: 'medium',
    });
    await insertReport({ msgId, senderTelegramId: senderIdStr, category, source: 'ai' });
    await insertLog({
      event: 'item_ai_flag',
      targetTelegramId: senderIdStr,
      actor: 'system',
      messageId: msgId,
      detail: { itemId, flags, source: 'ai' },
    });
    await _notifyAdmins(bot, `🚨 Объявление #${itemId} помечено ИИ-модератором (${category}).\n${text.slice(0, 160)}`);
    return { ok: true, flagged: true, category, flags };
  } catch (err) {
    console.warn('[trust] auditItemAsync failed:', err.message);
    return { ok: true, flagged: false, error: err.message };
  }
}

// ─── admin actions ──────────────────────────────────────────────────
export async function adminConfirmReport(reportId, actor) {
  await run("UPDATE mod_reports SET status = 'confirmed', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?", String(actor || ''), reportId);
}

export async function adminDismissReport(reportId, actor) {
  await run("UPDATE mod_reports SET status = 'dismissed', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?", String(actor || ''), reportId);
}

export async function adminBanUser(telegramId, reason, category, actor, durationDays) {
  let expires = '';
  if (durationDays && durationDays > 0) {
    const d = new Date(Date.now() + durationDays * 86400_000);
    expires = d.toISOString().replace('T', ' ').replace('Z', '');
  }
  await run(
    expires
      ? "INSERT INTO mod_banned (telegram_id, reason, category, banned_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT (telegram_id) DO UPDATE SET reason=?, category=?, banned_by=?, expires_at=?, created_at=datetime('now')"
      : "INSERT INTO mod_banned (telegram_id, reason, category, banned_by, created_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT (telegram_id) DO UPDATE SET reason=?, category=?, banned_by=?, created_at=datetime('now')",
    ...(expires
      ? [String(telegramId), reason || 'manual ban', category || 'other', actor || 'admin', expires, reason || 'manual ban', category || 'other', actor || 'admin', expires]
      : [String(telegramId), reason || 'manual ban', category || 'other', actor || 'admin', reason || 'manual ban', category || 'other', actor || 'admin']),
  );
}

export async function adminUnbanUser(telegramId) {
  await run("DELETE FROM mod_banned WHERE telegram_id = ?", String(telegramId));
}

export async function getAdminQueue({ status = 'open', limit = 50 } = {}) {
  return all(
    `SELECT r.*, m.content, m.censored, m.entry_type, m.score, m.level, m.flags_json, m.has_link
     FROM mod_reports r
     LEFT JOIN mod_messages m ON m.id = r.message_id
     WHERE r.status = ?
     ORDER BY r.created_at DESC
     LIMIT ?`,
    status, limit,
  );
}

export async function getReportsQueue({ status = 'open', limit = 50 } = {}) {
  return all(
    `SELECT
       r.id AS id, r.status AS status, r.category AS category, r.source AS source,
       r.created_at AS created_at, r.resolved_at AS resolved_at,
       r.sender_telegram_id AS sender_telegram_id,
       r.reporter_telegram_id AS reporter_telegram_id,
       m.content AS content, m.censored AS censored, m.has_link AS has_link,
       m.entry_type AS entry_type, m.want_id AS want_id,
       sender.nickname AS sender_nickname, sender.first_name AS sender_first_name,
       sender.last_name AS sender_last_name, sender.username AS sender_username,
       reporter.nickname AS reporter_nickname, reporter.first_name AS reporter_first_name,
       reporter.last_name AS reporter_last_name,
       items.title AS item_title
     FROM mod_reports r
     LEFT JOIN mod_messages m ON m.id = r.message_id
     LEFT JOIN users sender ON sender.telegram_id = r.sender_telegram_id
     LEFT JOIN users reporter ON reporter.telegram_id = r.reporter_telegram_id
     LEFT JOIN item_wants iw ON iw.id = m.want_id
     LEFT JOIN items ON items.id = COALESCE(m.item_id, iw.item_id)
     WHERE r.status = ?
     ORDER BY r.created_at DESC
     LIMIT ?`,
    status, limit,
  );
}

export async function moderatorConfirmSenderReports(senderTelegramId, reportId, actor) {
  await run(
    "UPDATE mod_reports SET status = 'confirmed', resolved_at = datetime('now'), resolved_by = ? WHERE sender_telegram_id = ? AND status = 'open'",
    String(actor || ''),
    String(senderTelegramId || ''),
  );
  await run(
    "INSERT INTO mod_log (event, target_telegram_id, actor, message_id, detail_json) VALUES ('moderator_confirm', ?, 'moderator', ?, ?)",
    String(senderTelegramId || ''),
    Number(reportId) || null,
    JSON.stringify({ by: actor || '' }),
  );
}

export async function moderatorBanFromReport(reportId, actor, reason, durationDays) {
  const report = await get('SELECT * FROM mod_reports WHERE id = ?', reportId);
  if (!report) {
    const err = new Error('Жалоба не найдена');
    err.status = 404;
    throw err;
  }
  const senderTg = String(report.sender_telegram_id || '').trim();
  if (!senderTg) {
    const err = new Error('У жалобы нет отправителя');
    err.status = 400;
    throw err;
  }
  await adminBanUser(
    senderTg,
    String(reason || '').slice(0, 200) || 'Блокировка по жалобе: подтверждённое нарушение',
    report.category || 'user_report',
    actor,
    durationDays,
  );
  await moderatorConfirmSenderReports(senderTg, reportId, actor);
  return { ok: true, telegram_id: senderTg };
}

export async function getModLog({ targetTelegramId, limit = 100 } = {}) {
  if (targetTelegramId) {
    return all('SELECT * FROM mod_log WHERE target_telegram_id = ? ORDER BY created_at DESC LIMIT ?', String(targetTelegramId), limit);
  }
  return all('SELECT * FROM mod_log ORDER BY created_at DESC LIMIT ?', limit);
}