import { get, all, run } from './db.js';
import { assertCleanListing, ITEM_CATEGORIES } from './moderation.js';
import {
  findOrCreateUser,
  publicUser,
  isProfileComplete,
  saveProfile,
  attachDevPhone,
  displayName,
} from './users.js';
import { storeItemPhotos } from './storage.js';

function sendError(res, err) {
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

export function registerItemRoutes(app, authMiddleware, upload, bot, optionalAuth = authMiddleware) {
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
        `;
        params.push(viewer.id);
        sql += ' ORDER BY item_favorites.created_at DESC';
        let rows = (await all(sql, ...params)).map((row) => ({
          ...withPhotos(row),
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
        sql += " AND items.status = 'active'";
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
        if (category === 'Детям') {
          sql += ' AND items.category IN (?, ?)';
          params.push('Детям', 'Игрушки');
        } else {
          sql += ' AND items.category = ?';
          params.push(category);
        }
      }

      sql += ' ORDER BY items.created_at DESC';
      let rows = (await all(sql, ...params)).map(withPhotos);
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
      const { title, description, district, category, oblast, settlement } = req.body;

      if (!title || !district || !category || !oblast || !settlement) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
      }
      if (!ITEM_CATEGORIES.includes(category)) {
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

      const photos = await storeItemPhotos(req.files);
      const photoUrl = photos[0] || null;

      const result = await run(`
        INSERT INTO items (user_id, title, description, photo_url, photos, oblast, settlement, district, category, type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      const item = await get('SELECT * FROM items WHERE id = ?', result.lastInsertRowid);
      res.status(201).json(withPhotos(item));
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

      const { title, description, district, category, oblast, settlement } = req.body;
      if (!title || !district || !category || !oblast || !settlement) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
      }
      if (!ITEM_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Выберите категорию из списка' });
      }

      assertCleanListing(title, description);

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

      await run(`
        UPDATE items
        SET title = ?, description = ?, photo_url = ?, photos = ?,
            oblast = ?, settlement = ?, district = ?, category = ?, type = 'free'
        WHERE id = ?
      `,
      title,
      description || '',
      photoUrl,
      photos.length ? JSON.stringify(photos) : null,
      oblast,
      settlement,
      district,
      category,
      item.id);

      const updated = await get('SELECT * FROM items WHERE id = ?', item.id);
      res.json(withPhotos(updated));
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

      await run('DELETE FROM item_wants WHERE item_id = ?', item.id);
      await run('DELETE FROM item_favorites WHERE item_id = ?', item.id);
      await run('DELETE FROM items WHERE id = ?', item.id);
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
        const closeText = `Переписка по вещи «${item.title}» закрыта: автор отметил её как отданную. Сообщения больше не передаются.`;
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

      const buyerName = displayName(buyer);
      let notified = false;

      if (bot) {
        const loud = { disable_notification: false };
        try {
          await bot.telegram.sendMessage(
            item.owner_tg,
            `${buyerName} откликнулся на Ваше объявление «${item.title}».\n\nОтветьте прямо в этом чате с ботом – сообщение уйдёт собеседнику. Личные профили Telegram не открываем.`,
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
              ? `Отклик по вещи «${item.title}» отправлен автору.\n\nПишите сюда, в бота – он передаст сообщения. Не нужно искать личный профиль в Telegram.`
              : `Отклик по вещи «${item.title}» сохранён.\n\nАвтор ещё не открывал бота. Попросите нажать /start в @EcoHubBY_bot – тогда можно переписываться здесь.`,
            loud,
          );
        } catch { /* */ }
      }

      res.json({ ok: true, notified });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/items/:id/favorite', authMiddleware, async (req, res) => {
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
