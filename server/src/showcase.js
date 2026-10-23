/**
 * Витрина для демонстрации: 5 объявлений от showcase-профилей.
 * Профили не попадают в рейтинг дарителей (items_shared = 0) и не мешают
 * реальным пользователям. Функция идемпотентна: повторный вызов обновляет
 * фото/тексты, но не создаёт дубли.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { get, all, run, isPostgres } from './db.js';
import { thumbDataUrl } from './storage.js';
import { removeItemWithAssets } from './items.js';

const OBLAST = 'Гродненская область';
const SETTLEMENT = 'Гродно';

export const SHOWCASE_ITEMS = [
  {
    telegramId: 'showcase_anna',
    nickname: 'Анна',
    title: 'Детский велосипед, 12″',
    description: 'Лёгкий, с боковыми колёсиками. Ребёнок вырос, велосипед в хорошем состоянии. Забирать у дома, помогу спустить.',
    category: 'Всё для детей и мам',
    district: 'Девятовка',
    photo: '01-bike.jpg',
  },
  {
    telegramId: 'showcase_dmitry',
    nickname: 'Дмитрий',
    title: 'Кресло для гостиной',
    description: 'Мягкое кресло бежевого цвета, без потёртостей. Самовывоз, аккуратно вынесем вместе.',
    category: 'Мебель',
    district: 'Центр',
    photo: '02-chair.jpg',
  },
  {
    telegramId: 'showcase_elena',
    nickname: 'Елена',
    title: 'Зимняя куртка, 46 размер',
    description: 'Тёплая, водоотталкивающая, носилась один сезон. Чистая, без дефектов. Отдам с вешалкой.',
    category: 'Одежда',
    district: 'Ольшанка',
    photo: '03-jacket.jpg',
  },
  {
    telegramId: 'showcase_igor',
    nickname: 'Игорь',
    title: 'Микроволновка Samsung',
    description: 'Работает исправно, греет равномерно. Освобождаем кухню после ремонта, нужна до пятницы.',
    category: 'Бытовая техника',
    district: 'Форты',
    photo: '04-microwave.jpg',
  },
  {
    telegramId: 'showcase_maria',
    nickname: 'Мария',
    title: 'Книги для подростков',
    description: 'Пять книг: приключения и фантастика, 12+. Отдам все вместе, можно забрать у метро.',
    category: 'Другое',
    district: 'Вишневец',
    photo: '05-books.jpg',
  },
];

async function photoBundle(fileName) {
  const file = fileURLToPath(new URL(`./data/showcase/${fileName}`, import.meta.url));
  const buffer = await readFile(file);
  const photo = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  const thumb = await thumbDataUrl(buffer);
  return { photo, thumb };
}

async function ensureUser(item) {
  let user = await get('SELECT * FROM users WHERE telegram_id = ?', item.telegramId);
  if (!user) {
    const res = await run(
      'INSERT INTO users (telegram_id, nickname, first_name, items_shared, eco_coins) VALUES (?, ?, ?, 0, 0)',
      item.telegramId,
      item.nickname,
      item.nickname,
    );
    user = await get('SELECT * FROM users WHERE id = ?', res.lastInsertRowid);
    return user;
  }
  await run(
    'UPDATE users SET nickname = ?, first_name = ?, items_shared = 0 WHERE id = ?',
    item.nickname,
    item.nickname,
    user.id,
  );
  return user;
}

export async function ensureShowcaseItems({ reset = false } = {}) {
  const created = [];
  const updated = [];
  let removed = 0;

  const users = [];
  for (const item of SHOWCASE_ITEMS) {
    users.push(await ensureUser(item));
  }

  if (reset) {
    for (const user of users) {
      const items = await all('SELECT * FROM items WHERE user_id = ?', user.id);
      for (const item of items) {
        await removeItemWithAssets(item);
        removed += 1;
      }
      await run('DELETE FROM users WHERE id = ?', user.id);
    }
    return { created, updated, removed };
  }

  for (let i = 0; i < SHOWCASE_ITEMS.length; i += 1) {
    const item = SHOWCASE_ITEMS[i];
    const user = users[i];
    const { photo, thumb } = await photoBundle(item.photo);
    const photos = JSON.stringify([photo]);
    const thumbs = JSON.stringify([thumb]);

    const existing = await get(
      'SELECT id FROM items WHERE user_id = ? AND title = ?',
      user.id,
      item.title,
    );

    if (existing?.id) {
      await run(
        `UPDATE items SET
           description = ?, category = ?, district = ?, oblast = ?, settlement = ?,
           photos = ?, photo_url = ?, photo_thumbs = ?, status = 'active', mod_status = 'ok',
           unclaimed_delete_at = datetime('now', '+21 days')
         WHERE id = ?`,
        item.description,
        item.category,
        item.district,
        OBLAST,
        SETTLEMENT,
        photos,
        photo,
        thumbs,
        existing.id,
      );
      updated.push(existing.id);
      continue;
    }

    const offset = i + 1;
    const createdAt = isPostgres()
      ? `NOW() - INTERVAL '${offset} minutes'`
      : `datetime('now', '-${offset} minutes')`;

    const res = await run(
      `INSERT INTO items
         (user_id, title, description, photo_url, photos, oblast, settlement, district,
          category, type, unclaimed_delete_at, photo_thumbs, mod_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'free', datetime('now', '+21 days'), ?, 'ok', ${createdAt})`,
      user.id,
      item.title,
      item.description,
      photo,
      photos,
      OBLAST,
      SETTLEMENT,
      item.district,
      item.category,
      thumbs,
    );
    created.push(res.lastInsertRowid);
  }

  return { created, updated, removed };
}
