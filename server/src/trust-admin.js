/**
 * Trust & Safety admin router (API для очереди модерации, бана, предупреждений).
 * Авторизация: заголовок X-Trust-Token (равен TRUST_ADMIN_TOKEN env).
 */
import { get, all, run } from './db.js';
import { thumbDataUrl } from './storage.js';
import { parseItemPhotos } from './items.js';
import { LEGACY_CATEGORY_MAP, ITEM_CATEGORIES } from './moderation.js';
import {
  getAdminQueue,
  getModLog,
  adminConfirmReport,
  adminDismissReport,
  adminBanUser,
  adminUnbanUser,
} from './trust/pipeline.js';

const BACKFILL_BATCH = 100;

async function photoBuffer(ref) {
  const s = String(ref || '');
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',');
    if (comma === -1) return null;
    return Buffer.from(s.slice(comma + 1), 'base64');
  }
  if (s.startsWith('http://') || s.startsWith('https://')) {
    const res = await fetch(s, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

function verifyToken(req, res, next) {
  const token = String(process.env.TRUST_ADMIN_TOKEN || '').trim();
  if (!token) return res.status(503).json({ error: 'TRUST_ADMIN_TOKEN не настроен' });
  const incoming = req.headers['x-trust-token'] || '';
  if (incoming !== token) return res.status(403).json({ error: 'Неверный токен' });
  return next();
}

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message || 'Ошибка' });
}

export function registerTrustAdminRoutes(app) {
  // Очередь жалоб
  app.get('/api/trust/admin/alerts', verifyToken, async (req, res) => {
    try {
      const queue = await getAdminQueue({
        status: req.query.status || 'open',
        limit: Math.min(Number(req.query.limit) || 50, 200),
      });
      res.json({ items: queue, count: queue.length });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Подтвердить жалобу
  app.post('/api/trust/admin/confirm', verifyToken, async (req, res) => {
    try {
      const { report_id } = req.body || {};
      if (!report_id) return res.status(400).json({ error: 'report_id обязателен' });
      await adminConfirmReport(report_id, req.headers['x-trust-token'] || 'admin');
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Отклонить жалобу
  app.post('/api/trust/admin/reject', verifyToken, async (req, res) => {
    try {
      const { report_id, reason } = req.body || {};
      if (!report_id) return res.status(400).json({ error: 'report_id обязателен' });
      await adminDismissReport(report_id, req.headers['x-trust-token'] || 'admin');
      res.json({ ok: true, reason });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Забанить
  app.post('/api/trust/admin/ban', verifyToken, async (req, res) => {
    try {
      const { telegram_id, reason, category, duration_days } = req.body || {};
      if (!telegram_id) return res.status(400).json({ error: 'telegram_id обязателен' });
      await adminBanUser(String(telegram_id), reason, category, 'admin', duration_days);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Разбанить
  app.post('/api/trust/admin/unban', verifyToken, async (req, res) => {
    try {
      const { telegram_id } = req.body || {};
      if (!telegram_id) return res.status(400).json({ error: 'telegram_id обязателен' });
      await adminUnbanUser(telegram_id);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Детали пользователя (репорты + trust score + лог)
  app.get('/api/trust/admin/user/:telegramId', verifyToken, async (req, res) => {
    try {
      const tid = String(req.params.telegramId);
      const trust = await get('SELECT * FROM mod_trust WHERE telegram_id = ?', tid);
      const reports = await all(
        "SELECT * FROM mod_reports WHERE sender_telegram_id = ? ORDER BY created_at DESC LIMIT 100",
        tid,
      );
      const modMessages = await all(
        "SELECT * FROM mod_messages WHERE sender_telegram_id = ? ORDER BY created_at DESC LIMIT 50",
        tid,
      );
      const banned = await get("SELECT * FROM mod_banned WHERE telegram_id = ?", tid);
      const logs = await getModLog({ targetTelegramId: tid, limit: 50 });
      res.json({
        trust: trust || null,
        reports_count: reports.length,
        reports,
        mod_messages: modMessages,
        banned: banned || null,
        logs,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Разовый backfill миниатюр для старых объявлений (?rewrite=1 перезаписывает готовые)
  app.post('/api/trust/admin/backfill-thumbs', verifyToken, async (req, res) => {
    const rewrite = req.body?.rewrite === true || req.body?.rewrite === 1;
    const where = rewrite ? 'photos IS NOT NULL' : 'photo_thumbs IS NULL';
    const rows = await all(
      `SELECT id, photos, photo_url FROM items
       WHERE ${where}
       ORDER BY id
       LIMIT ?`,
      BACKFILL_BATCH,
    );
    let done = 0;
    let failed = 0;
    for (const row of rows) {
      const urls = parseItemPhotos(row);
      const thumbs = [];
      for (const url of urls) {
        if (!url) { thumbs.push(null); continue; }
        const buf = await photoBuffer(url);
        const thumb = await thumbDataUrl(buf);
        if (thumb) thumbs.push(thumb); else failed += 1;
      }
      await run('UPDATE items SET photo_thumbs = ? WHERE id = ?', JSON.stringify(thumbs), row.id);
      done += 1;
    }
    res.json({ processed: done, failed, remaining_hint: 'запустите повторно, пока не вернётся 0' });
  });

  // Одноразовая миграция старых категорий → новая таксономия
  app.post('/api/trust/admin/backfill-categories', verifyToken, async (req, res) => {
    const rows = await all(
      `SELECT id, category FROM items
       WHERE category IS NOT NULL AND category != ''
       ORDER BY id
       LIMIT ?`,
      BACKFILL_BATCH,
    );
    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      const mapped = LEGACY_CATEGORY_MAP[row.category];
      if (mapped && ITEM_CATEGORIES.includes(mapped) && mapped !== row.category) {
        await run('UPDATE items SET category = ? WHERE id = ?', mapped, row.id);
        updated += 1;
      } else if (!ITEM_CATEGORIES.includes(row.category)) {
        await run("UPDATE items SET category = 'Другое' WHERE id = ?", row.id);
        updated += 1;
      } else {
        skipped += 1;
      }
    }
    res.json({ processed: rows.length, updated, skipped, remaining_hint: 'запустите повторно, пока не вернётся 0' });
  });
}