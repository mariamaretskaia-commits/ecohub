import { get, all, run } from './db.js';
import { assertCleanListing, ITEM_CATEGORIES, normalizeCategory, RECYCLING_CATEGORIES } from './moderation.js';
import {
  findOrCreateUser,
  publicUser,
  isProfileComplete,
  saveProfile,
  acceptLegal,
  attachDevPhone,
  displayName,
  exportUserData,
  deleteUserData,
  setNudgesDisabled,
} from './users.js';
import { storeItemPhotos, deleteStoredPhotos, makeItemThumbs } from './storage.js';
import { ensureWantOpeningMessage } from './chat.js';
import { moderateItem, auditItemAsync } from './trust/pipeline.js';
import { createDownloadToken, consumeDownloadToken } from './export-download.js';
import { removeItemWithAssets } from './items.js';
import { planRecyclingRoute, hasPointForItem } from './vision.js';
import { categorizeItems, categorizeByRules } from './categorize.js';
import { cacheStore } from './catcache.js';
import { logCategorization, logFix } from './catlog.js';

function sendError(res, err) {
  const req = res.req;
  console.error(
    `[error] ${req?.method || '?'} ${req?.originalUrl || req?.url || '?'} ->`,
    err?.message || err,
  );
  if (req && err?.stack) console.error(err.stack);
  if (/^(22P02|22P01|22007|22008)$/.test(String(err?.code || ''))) {
    return res.status(400).json({ error: 'Не удалось сохранить данные. Мы уже знаем об ошибке – попробуйте чуть позже.' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Ошибка' });
}

function requireCompleteProfile(user, res) {
  if (isProfileComplete(user)) return true;
  res.status(403).json({ error: 'Сначала укажите, как к Вам обращаться.' });
  return false;
}

function isLocalHost(req) {
  const host = String(req.headers.host || '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1';
}

const ITEM_NAME_SQL = `
  CASE
    WHEN users.nickname IS NOT NULL AND TRIM(users.nickname) != ''
      THEN users.nickname
    WHEN users.last_name IS NOT NULL AND users.last_name != ''
      THEN TRIM(users.last_name || ' ' || users.first_name)
    ELSE users.first_name
  END AS first_name
`;

export function registerUserRoutes(app, authMiddleware) {
  app.get('/api/me', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      res.json(publicUser(user));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch('/api/me', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      const saved = await saveProfile(user.id, req.body, Boolean(req.body.consent));
      res.json(saved);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch('/api/me/nudges', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      res.json(await setNudgesDisabled(user.id, Boolean(req.body?.enabled === false)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/me/consent', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      res.json(await acceptLegal(user.id, req.body, req.telegramUser));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/me/export', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      res.json(await exportUserData(user.id));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/me/export/token', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      const token = createDownloadToken(user.telegram_id);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ token });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/me/export/download', async (req, res) => {
    const result = consumeDownloadToken(req.query.token);
    if (!result.telegramId) {
      return res.status(403).json({ error: 'Ссылка для скачивания недействительна или истекла' });
    }
    try {
      const user = await findOrCreateUser({ id: Number(result.telegramId) });
      const data = await exportUserData(user.id);
      const filename = `ecohub-data-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(JSON.stringify(data, null, 2));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/me/phone-dev', authMiddleware, async (req, res) => {
    if (!isLocalHost(req)) {
      return res.status(403).json({ error: 'Телефон в Telegram подтверждается через бота' });
    }
    try {
      const user = await findOrCreateUser(req.telegramUser);
      res.json(await attachDevPhone(user.id, req.body.phone));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/me', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      res.json(await deleteUserData(user.id));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/leaderboard', async (_req, res) => {
    try {
      const leaders = await all(`
        SELECT id, nickname, first_name, last_name, patronymic, username, items_shared
        FROM users
        WHERE nickname IS NOT NULL AND TRIM(nickname) != ''
          AND items_shared > 0
          AND telegram_id NOT LIKE 'demo_%'
        ORDER BY items_shared DESC, id ASC
        LIMIT 5
      `);
      res.json(leaders.map((u) => ({ ...u, display_name: displayName(u) })));
    } catch (err) {
      sendError(res, err);
    }
  });
}

function parsePhotos(item) {
  if (!item) return [];
  try {
    const raw = item.photos;
    if (raw) {
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(list)) return list.filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return item.photo_url ? [item.photo_url] : [];
}

function withPhotos(row) {
  if (!row) return row;
  const photos = parsePhotos(row);
  return { ...row, photos, photo_url: photos[0] || row.photo_url || null };
}

function parseThumbs(row) {
  if (!row) return [];
  try {
    const raw = row.photo_thumbs;
    if (raw) {
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(list)) return list;
    }
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Лёгкое представление объявления для ленты: photo_thumbs предпочитаем полным
 * фото, чтобы список не весил мегабайты base64. Полные фото – только в детале.
 */
function forFeedList(row) {
  if (!row) return row;
  const full = withPhotos(row);
  const thumbs = parseThumbs(row);
  const photos = full.photos.map((url, i) => (thumbs[i] || url)).filter(Boolean);
  return {
    ...full,
    photos,
    photo_url: photos[0] || full.photo_url || null,
    photo_thumbs: thumbs,
    mod_status: row.mod_status || 'ok',
  };
}

export function registerItemRoutes(app, authMiddleware, upload, bot, optionalAuth = authMiddleware, webAppUrl = '') {
  app.get('/api/items', optionalAuth, async (req, res) => {
    try {
      const { type, district, category, oblast, settlement, q, mine, favorites } = req.query;
      let sql = `
        SELECT items.*, users.username, users.telegram_id, ${ITEM_NAME_SQL}
        FROM items JOIN users ON items.user_id = users.id
        WHERE users.telegram_id NOT LIKE 'demo_%'
      `;
      const params = [];

      const viewer = req.telegramUser ? await findOrCreateUser(req.telegramUser) : null;

      if (favorites === '1') {
        if (!viewer) return res.status(401).json({ error: 'Unauthorized' });
        sql = `
          SELECT items.*, users.username, users.telegram_id, ${ITEM_NAME_SQL},
                 item_favorites.created_at AS favorited_at
          FROM item_favorites
          JOIN items ON items.id = item_favorites.item_id
          JOIN users ON items.user_id = users.id
          WHERE item_favorites.user_id = ?
            AND users.telegram_id NOT LIKE 'demo_%'
            AND items.status IN ('active', 'given')
            AND items.mod_status = 'ok'
        `;
        params.push(viewer.id);
        sql += ' ORDER BY item_favorites.created_at DESC';
        let rows = (await all(sql, ...params)).map((row) => ({
          ...forFeedList(row),
          is_favorited: true,
        }));
        const needle = String(q || '').trim().toLocaleLowerCase('ru');
        if (needle) {
          rows = rows.filter((item) => (
            `${item.title || ''} ${item.description || ''}`.toLocaleLowerCase('ru').includes(needle)
          ));
        }
        return res.json(rows);
      }

      if (mine === '1') {
        if (!viewer) return res.status(401).json({ error: 'Unauthorized' });
        sql += " AND items.status = 'active' AND items.user_id = ?";
        params.push(viewer.id);
      } else {
        sql += " AND items.status = 'active' AND items.mod_status = 'ok'";
        if (viewer) {
          sql += ' AND items.user_id != ?';
          params.push(viewer.id);
        }
      }

      if (type) { sql += ' AND items.type = ?'; params.push(type); }
      if (oblast) { sql += ' AND items.oblast = ?'; params.push(oblast); }
      if (settlement) { sql += ' AND items.settlement = ?'; params.push(settlement); }
      if (district) { sql += ' AND items.district = ?'; params.push(district); }
      if (category) {
        if (category === 'Всё для детей и мам') {
          sql += ' AND items.category IN (?, ?)';
          params.push('Всё для детей и мам', 'Игрушки');
        } else {
          sql += ' AND items.category = ?';
          params.push(category);
        }
      }

      sql += ' ORDER BY items.created_at DESC';
      let rows = (await all(sql, ...params)).map(forFeedList);
      const needle = String(q || '').trim().toLocaleLowerCase('ru');
      if (needle) {
        rows = rows.filter((item) => (
          `${item.title || ''} ${item.description || ''}`.toLocaleLowerCase('ru').includes(needle)
        ));
      }

      if (viewer && rows.length) {
        const favRows = await all(
          'SELECT item_id FROM item_favorites WHERE user_id = ?',
          viewer.id,
        );
        const favSet = new Set(favRows.map((r) => Number(r.item_id)));
        rows = rows.map((row) => ({
          ...row,
          is_favorited: favSet.has(Number(row.id)),
        }));
      }

      res.json(rows);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/items/:id', async (req, res) => {
    try {
      const item = await get(`
        SELECT items.*, users.username, users.telegram_id, ${ITEM_NAME_SQL}
        FROM items JOIN users ON items.user_id = users.id WHERE items.id = ?
      `, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json(withPhotos(item));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/items', authMiddleware, upload.array('photos', 5), async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;
      const { title, description, district, category: rawCategory, oblast, settlement } = req.body;

      if (!title || !district || !rawCategory || !oblast || !settlement) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
      }
      const category = normalizeCategory(rawCategory);
      if (!category || !ITEM_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Выберите категорию из списка' });
      }

      assertCleanListing(title, description);

      const today = await get(`
        SELECT COUNT(*) AS c FROM items
        WHERE user_id = ? AND created_at >= datetime('now', '-1 day')
      `, user.id);
      if (Number(today?.c || 0) >= 5) {
        return res.status(429).json({ error: 'Не больше 5 объявлений в сутки' });
      }

      await moderateItem({
        senderTg: String(user.telegram_id || user.id),
        senderName: user.nickname || user.first_name || '',
        title,
        description,
      });

      const photos = await storeItemPhotos(req.files);
      const photoUrl = photos[0] || null;
      const thumbs = await makeItemThumbs(req.files);

      const result = await run(`
        INSERT INTO items (user_id, title, description, photo_url, photos, oblast, settlement, district, category, type, unclaimed_delete_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+21 days'))
      `,
      user.id,
      title,
      description || '',
      photoUrl,
      photos.length ? JSON.stringify(photos) : null,
      oblast,
      settlement,
      district,
      category,
      'free');

      if (thumbs.length) {
        await run('UPDATE items SET photo_thumbs = ? WHERE id = ?', JSON.stringify(thumbs), result.lastInsertRowid);
      }

      const item = await get('SELECT * FROM items WHERE id = ?', result.lastInsertRowid);
      res.status(201).json(forFeedList(item));

      auditItemAsync({
        senderTg: String(user.telegram_id || user.id),
        itemId: item.id,
        title,
        description,
        photoUrls: photos,
        bot,
      }).catch(() => {});
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch('/api/items/:id', authMiddleware, upload.array('photos', 5), async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;

      const item = await get('SELECT * FROM items WHERE id = ?', req.params.id);
      if (!item) return res.status(404).json({ error: 'Объявление не найдено' });
      if (Number(item.user_id) !== Number(user.id)) return res.status(403).json({ error: 'Можно менять только своё объявление' });
      if (item.status !== 'active') return res.status(400).json({ error: 'Объявление уже закрыто' });

      const { title, description, district, category: rawCategory, oblast, settlement } = req.body;
      if (!title || !district || !rawCategory || !oblast || !settlement) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
      }
      const category = normalizeCategory(rawCategory);
      if (!category || !ITEM_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Выберите категорию из списка' });
      }

      assertCleanListing(title, description);

      await moderateItem({
        senderTg: String(user.telegram_id || user.id),
        senderName: user.nickname || user.first_name || '',
        title,
        description,
      });

      const currentPhotos = parsePhotos(item);
      let keep = [];
      try {
        const raw = req.body.keep_photos;
        keep = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
      } catch {
        keep = [];
      }
      keep = keep.filter((p) => typeof p === 'string' && currentPhotos.includes(p));

      const added = await storeItemPhotos(req.files);
      const photos = [...keep, ...added].slice(0, 5);
      const photoUrl = photos[0] || null;

      const currentThumbs = parseThumbs(item);
      const currentPhotosList = parsePhotos(item);
      const thumbForUrl = new Map(currentPhotosList.map((url, i) => [url, currentThumbs[i]]));
      const addedThumbs = await makeItemThumbs(req.files);
      const thumbs = [...keep.map((url) => thumbForUrl.get(url) || null), ...addedThumbs].slice(0, 5);

      await run(`
        UPDATE items
        SET title = ?, description = ?, photo_url = ?, photos = ?,
            photo_thumbs = ?, mod_status = 'ok',
            oblast = ?, settlement = ?, district = ?, category = ?, type = 'free'
        WHERE id = ?
      `,
      title,
      description || '',
      photoUrl,
      photos.length ? JSON.stringify(photos) : null,
      thumbs.length ? JSON.stringify(thumbs) : null,
      oblast,
      settlement,
      district,
      category,
      item.id);

      const updated = await get('SELECT * FROM items WHERE id = ?', item.id);
      const dropped = currentPhotos.filter((p) => !keep.includes(p));
      if (dropped.length) await deleteStoredPhotos(dropped);
      res.json(forFeedList(updated));

      auditItemAsync({
        senderTg: String(user.telegram_id || user.id),
        itemId: item.id,
        title,
        description,
        photoUrls: photos,
        bot,
      }).catch(() => {});
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/items/:id', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      const item = await get('SELECT * FROM items WHERE id = ?', req.params.id);

      if (!item) return res.status(404).json({ error: 'Объявление не найдено' });
      if (Number(item.user_id) !== Number(user.id)) return res.status(403).json({ error: 'Можно удалить только своё объявление' });
      if (item.status !== 'active') return res.status(400).json({ error: 'Объявление уже закрыто' });

      await removeItemWithAssets(item);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch('/api/items/:id/give', authMiddleware, async (req, res) => {
    try {
      const user = await findOrCreateUser(req.telegramUser);
      const item = await get('SELECT * FROM items WHERE id = ?', req.params.id);

      if (!item) return res.status(404).json({ error: 'Not found' });
      if (Number(item.user_id) !== Number(user.id)) return res.status(403).json({ error: 'Forbidden' });
      if (item.status !== 'active') return res.status(400).json({ error: 'Объявление уже закрыто' });

      await run("UPDATE items SET status = 'given' WHERE id = ?", item.id);
      await run('UPDATE users SET items_shared = items_shared + 1 WHERE id = ?', user.id);

      const wants = await all(`
        SELECT item_wants.buyer_id, users.telegram_id AS buyer_tg
        FROM item_wants
        JOIN users ON users.id = item_wants.buyer_id
        WHERE item_wants.item_id = ?
        ORDER BY item_wants.created_at DESC
      `, item.id);

      if (wants[0]) {
        await run('UPDATE users SET items_taken = items_taken + 1 WHERE id = ?', wants[0].buyer_id);
      }

      if (bot) {
        const loud = { disable_notification: false };
        const closeText = `Переписка по вещи «${item.title}» закрыта: автор отметил её как отданную. Новые сообщения в «Чате» недоступны.`;
        try {
          await bot.telegram.sendMessage(user.telegram_id, closeText, loud);
        } catch { /* */ }
        const seen = new Set();
        for (const w of wants) {
          if (!w.buyer_tg || seen.has(w.buyer_tg)) continue;
          seen.add(w.buyer_tg);
          try {
            await bot.telegram.sendMessage(w.buyer_tg, closeText, loud);
          } catch { /* */ }
        }
      }

      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/items/:id/want', authMiddleware, async (req, res) => {
    try {
      const buyer = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(buyer, res)) return;

      const item = await get(`
        SELECT items.*,
               users.telegram_id AS owner_tg,
               users.nickname AS owner_nickname,
               users.first_name AS owner_name,
               users.last_name AS owner_last
        FROM items JOIN users ON items.user_id = users.id
        WHERE items.id = ?
      `, req.params.id);

      if (!item) return res.status(404).json({ error: 'Объявление не найдено' });
      if (item.status !== 'active') return res.status(400).json({ error: 'Объявление уже закрыто' });
      if (Number(item.user_id) === Number(buyer.id)) return res.status(400).json({ error: 'Это ваша вещь' });
      if (String(item.owner_tg || '').startsWith('demo_')) {
        return res.status(400).json({ error: 'Это демо-объявление' });
      }

      await run(`
        INSERT OR IGNORE INTO item_wants (item_id, buyer_id) VALUES (?, ?)
      `, item.id, buyer.id);

      const want = await get(
        'SELECT id FROM item_wants WHERE item_id = ? AND buyer_id = ?',
        item.id,
        buyer.id,
      );

      if (want?.id) {
        await ensureWantOpeningMessage({
          wantId: want.id,
          buyerId: buyer.id,
        });
      }

      const buyerName = displayName(buyer);
      let notified = false;

      if (bot) {
        const loud = { disable_notification: false };
        try {
          await bot.telegram.sendMessage(
            item.owner_tg,
            `${buyerName} откликнулся на Ваше объявление «${item.title}».\n\nОткройте раздел «Чат» в приложении EcoHub – там можно переписываться.`,
            loud,
          );
          notified = true;
        } catch {
          notified = false;
        }

        try {
          await bot.telegram.sendMessage(
            buyer.telegram_id,
            notified
              ? `Отклик по вещи «${item.title}» отправлен автору.\n\nПереписка – в разделе «Чат» в приложении EcoHub.`
              : `Отклик по вещи «${item.title}» сохранён.\n\nАвтор ещё не открывал бота – попросите нажать /start в @EcoHubBY_bot. Переписка – в разделе «Чат».`,
            loud,
          );
        } catch { /* */ }
      }

      res.json({ ok: true, notified, want_id: want?.id || null });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/items/:id/favorite', authMiddleware, async (req, res) => {
    // Избранное – приватно для пользователя. Владельцу объявления уведомления не отправляем.
    try {
      const user = await findOrCreateUser(req.telegramUser);
      if (!requireCompleteProfile(user, res)) return;

      const item = await get('SELECT * FROM items WHERE id = ?', req.params.id);
      if (!item) return res.status(404).json({ error: 'Объявление не найдено' });
      if (Number(item.user_id) === Number(user.id)) {
        return res.status(400).json({ error: 'Своё объявление нельзя добавить в избранное' });
      }
      if (item.status !== 'active' && item.status !== 'given') {
        return res.status(400).json({ error: 'Объявление недоступно' });
      }

      const existing = await get(
        'SELECT id FROM item_favorites WHERE item_id = ? AND user_id = ?',
        item.id,
        user.id,
      );

      if (existing) {
        await run('DELETE FROM item_favorites WHERE item_id = ? AND user_id = ?', item.id, user.id);
        return res.json({ favorited: false });
      }

      if (item.status !== 'active') {
        return res.status(400).json({ error: 'Нельзя добавить отданную вещь в избранное' });
      }

      await run(
        'INSERT OR IGNORE INTO item_favorites (item_id, user_id) VALUES (?, ?)',
        item.id,
        user.id,
      );
      res.json({ favorited: true });
    } catch (err) {
      sendError(res, err);
    }
  });
}

export function registerPointRoutes(app) {
  app.get('/api/points', async (req, res) => {
    try {
      const { type, district, districts } = req.query;
      let sql = 'SELECT * FROM recycling_points WHERE 1=1';
      const params = [];
      if (type) {
        sql += ' AND (type = ? OR accepts LIKE ?)';
        params.push(type, `%${type}%`);
      }
      const districtList = [district, ...(districts ? String(districts).split(',') : [])].filter(Boolean);
      if (districtList.length === 1) {
        sql += ' AND district = ?';
        params.push(districtList[0]);
      } else if (districtList.length > 1) {
        sql += ` AND district IN (${districtList.map(() => '?').join(',')})`;
        params.push(...districtList);
      }
      sql += ' ORDER BY district, organization, name';
      res.json(await all(sql, ...params));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/points/:id', async (req, res) => {
    try {
      const point = await get('SELECT * FROM recycling_points WHERE id = ?', req.params.id);
      if (!point) return res.status(404).json({ error: 'Not found' });
      res.json(point);
    } catch (err) {
      sendError(res, err);
    }
  });
}

const VISION_MAX_BYTES = 5 * 1024 * 1024;

const MAX_CATEGORIZE_NAMES = 30;

export function registerVisionRoutes(app, authMiddleware, upload) {
  app.post('/api/vision/categorize', authMiddleware, async (req, res) => {
    try {
      const { names } = req.body || {};
      const list = (Array.isArray(names) ? names : [])
        .map((n) => String(n ?? '').trim())
        .filter(Boolean);
      if (!list.length) {
        return res.status(400).json({ error: 'Список вещей пуст' });
      }
      if (list.length > MAX_CATEGORIZE_NAMES) {
        return res.status(400).json({ error: `Не больше ${MAX_CATEGORIZE_NAMES} вещей за раз` });
      }
      const { items, provider } = await categorizeItems(list, { categories: RECYCLING_CATEGORIES });
      logCategorization({
        user: req.telegramUser,
        entries: items.map((it) => ({
          name: it.name,
          category: it.category,
          provider: it.source === 'cache' ? 'cache' : provider,
          category_rules: categorizeByRules(it.name),
        })),
      });
      const withPoints = await Promise.all(items.map(async (it) => ({
        ...it,
        pointFound: await hasPointForItem(it.name, it.category),
      })));
      res.json({ items: withPoints, provider });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/vision/categorize-fix', authMiddleware, async (req, res) => {
    try {
      const { name, category } = req.body || {};
      const cleanName = String(name ?? '').trim().slice(0, 200);
      const cleanCat = String(category ?? '').trim();
      if (!cleanName) return res.status(400).json({ error: 'Название вещи обязательно' });
      if (!RECYCLING_CATEGORIES.includes(cleanCat)) {
        return res.status(400).json({ error: 'Некорректная категория' });
      }
      cacheStore(cleanName, cleanCat);
      logFix(req.telegramUser, cleanName, cleanCat);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/vision/route', authMiddleware, async (req, res) => {
    try {
      const { items, categories, lat, lng } = req.body || {};
      const list = Array.isArray(items) && items.length
        ? items
        : (Array.isArray(categories) ? categories : []);
      if (!list.length) {
        return res.status(400).json({ error: 'Вещи или категории обязательны' });
      }
      res.json(await planRecyclingRoute(list, lat, lng));
    } catch (err) {
      sendError(res, err);
    }
  });
}
