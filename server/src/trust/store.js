/**
 * Store-хелперы для Trust & Safety (внутренние функции, используются pipeline.js).
 * Работают через единый db.js (?-плейсхолдеры, адаптер sqlite/pg).
 */
import { get, all, run, bindSafe } from '../db.js';
import { trustSignalsSnapshot, compute } from './trustScore.js';
import { loadVocab } from './textFilter.js';

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
function _rank(s) { return SEVERITY_RANK[s] || 1; }

export async function isBanned(telegramId) {
  if (!telegramId) return false;
  const row = await get(
    "SELECT telegram_id FROM mod_banned WHERE telegram_id = ? AND (expires_at IS NULL OR expires_at = '' OR expires_at > datetime('now'))",
    String(telegramId),
  );
  return Boolean(row);
}

export async function buildSignals(senderId, { firstMessage = false, suspiciousFirstMsg = false } = {}) {
  const user = await get('SELECT * FROM users WHERE id = ? OR telegram_id = ?', String(senderId), String(senderId));
  const createdDays = user?.created_at ? Math.max(0, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000)) : 365;
  const username = String(user?.username || '').trim();
  const photoUrl = String(user?.photo_url || '').trim();
  const hasAvatar = Boolean(photoUrl && photoUrl !== 'null' && photoUrl !== 'undefined');
  const hasUsername = Boolean(username);

  const reportsRow = await get(
    "SELECT COUNT(*) AS total FROM mod_reports WHERE sender_telegram_id = ? AND created_at > datetime('now', '-30 day')",
    String(senderId),
  );
  const confirmedRow = await get(
    "SELECT COUNT(*) AS total FROM mod_reports WHERE sender_telegram_id = ? AND status = 'confirmed' AND created_at > datetime('now', '-30 day')",
    String(senderId),
  );

  const trustRow = await get('SELECT signals_json FROM mod_trust WHERE telegram_id = ?', String(senderId));
  let prevSignals = {};
  try { prevSignals = JSON.parse(trustRow?.signals_json || '{}'); } catch { /* noop */ }

  return {
    acct_age_days: createdDays,
    has_avatar: hasAvatar,
    has_username: hasUsername,
    reports_30d: Number(reportsRow?.total || 0),
    confirmed_reports_30d: Number(confirmedRow?.total || 0),
    completed_deals: (user?.items_shared || 0) + (user?.items_taken || 0),
    cancelled_items: 0,
    suspicious_first_msg: firstMessage ? suspiciousFirstMsg : Boolean(prevSignals.suspicious_first_msg),
    first_msg_penalty_applied: Boolean(prevSignals.first_msg_penalty_applied),
  };
}

export async function updateTrust(senderId, signals) {
  const [score, level] = compute(signals);
  const sigJson = JSON.stringify(trustSignalsSnapshot(signals));
  await run(
    "INSERT INTO mod_trust (telegram_id, score, level, signals_json, updated_at) VALUES (?, ?, ?, ?, datetime('now')) " +
    "ON CONFLICT (telegram_id) DO UPDATE SET score = ?, level = ?, signals_json = ?, updated_at = datetime('now')",
    String(senderId), score, level, sigJson, score, level, sigJson,
  );
  return { score, level };
}

export async function insertModMessage({ senderTelegramId, receiverTelegramId, wantId, itemId, text, censored, photoUrl, hasLink, status, decidedBy, flagsJson, score, level }) {
  const res = await run(
    `INSERT INTO mod_messages
      (entry_type, sender_telegram_id, receiver_telegram_id, want_id, item_id, content, censored, photo_url, has_link, status, decided_by, flags_json, score, level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    receiverTelegramId ? 'chat' : 'item',
    String(senderTelegramId || ''),
    String(receiverTelegramId || ''),
    wantId || null,
    itemId || null,
    text || '',
    censored || text || '',
    photoUrl || null,
    hasLink ? 1 : 0,
    status || 'clean',
    decidedBy || 'filter',
    flagsJson || null,
    score ?? null,
    level || 'low',
  );
  return res.lastInsertRowid;
}

export async function insertReport({ msgId, senderTelegramId, reporterTelegramId, category, source }) {
  const res = await run(
    `INSERT INTO mod_reports (message_id, sender_telegram_id, reporter_telegram_id, category, source, status)
     VALUES (?, ?, ?, ?, ?, 'open')`,
    msgId, String(senderTelegramId || ''), String(reporterTelegramId || ''), category || 'other', source || 'filter',
  );
  return res.lastInsertRowid;
}

export async function insertLog({ event, targetTelegramId, actor, messageId, detail }) {
  await run(
    `INSERT INTO mod_log (event, target_telegram_id, actor, message_id, detail_json) VALUES (?, ?, ?, ?, ?)`,
    event, String(targetTelegramId || ''), actor || 'system', messageId || null, JSON.stringify(detail || {}),
  );
}

export async function markFirstMsgPenalty(senderId) {
  const trustRow = await get('SELECT signals_json FROM mod_trust WHERE telegram_id = ?', String(senderId));
  let prev = {};
  try { prev = JSON.parse(trustRow?.signals_json || '{}'); } catch { /* noop */ }
  if (prev.first_msg_penalty_applied) return;
  prev.suspicious_first_msg = true;
  prev.first_msg_penalty_applied = true;
  const sigJson = JSON.stringify(prev);
  const current = await get('SELECT score, level FROM mod_trust WHERE telegram_id = ?', String(senderId));
  if (current) {
    await run(
      "UPDATE mod_trust SET signals_json = ?, updated_at = datetime('now') WHERE telegram_id = ?",
      sigJson, String(senderId),
    );
  } else {
    await run(
      "INSERT INTO mod_trust (telegram_id, score, level, signals_json, updated_at) VALUES (?, 50, 'low', ?, datetime('now'))",
      String(senderId), sigJson,
    );
  }
}

export async function countOpenReports(senderId) {
  const row = await get(
    "SELECT COUNT(*) AS total FROM mod_reports WHERE sender_telegram_id = ? AND status = 'open' AND created_at > datetime('now', '-30 day')",
    String(senderId),
  );
  return Number(row?.total || 0);
}

export async function insertBan({ telegramId, reason, category, bannedBy }) {
  await run(
    "INSERT INTO mod_banned (telegram_id, reason, category, banned_by, created_at) VALUES (?, ?, ?, ?, datetime('now')) " +
    "ON CONFLICT (telegram_id) DO UPDATE SET reason = ?, category = ?, banned_by = ?, created_at = datetime('now')",
    String(telegramId), reason || 'auto', category || 'other', bannedBy || 'system',
    reason || 'auto', category || 'other', bannedBy || 'system',
  );
}

export async function autoBanIfNeeded(senderId, msgId, category) {
  const count = await countOpenReports(senderId);
  if (count >= 3) {
    const reason = `авто-бан: ${count} открытых жалоб за 30 дней`;
    await insertBan({ telegramId: senderId, reason, category, bannedBy: 'system' });
    await insertLog({ event: 'auto_ban', targetTelegramId: senderId, actor: 'system', messageId: msgId, detail: { reports: count, reason } });
    return true;
  }
  return false;
}