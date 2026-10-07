/**
 * Самовосстановление миниатюр ленты: если у объявления нет валидных
 * photo_thumbs (NULL, '', '[]', '[null]' или битые), генерируем их из
 * полных фото на лету, держим в памяти и один раз пишем в БД.
 */
import { run } from './db.js';
import { thumbDataUrl } from './storage.js';
import { parseItemPhotos } from './items.js';

const cache = new Map();

function hasThumb(thumbs) {
  return Array.isArray(thumbs) && thumbs.some((t) => String(t || '').startsWith('data:'));
}

function validThumbs(photoThumbs) {
  try {
    const list = typeof photoThumbs === 'string' ? JSON.parse(photoThumbs) : photoThumbs;
    return Array.isArray(list) && hasThumb(list) ? list : [];
  } catch {
    return [];
  }
}

function photoBufferFromUrl(src) {
  const s = String(src || '');
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',');
    if (comma === -1) return null;
    return Buffer.from(s.slice(comma + 1), 'base64');
  }
  return null;
}

/**
 * Возвращает миниатюры для строки объявления. Если их нет — генерирует,
 * кэширует в Map и асинхронно сохраняет в БД (самовосстановление).
 * Полные данные-URL на выход не отдаёт: битые фото заменяет null.
 */
export async function ensureFeedThumbs(row) {
  if (!row?.id) return validThumbs(row?.photo_thumbs);
  if (cache.has(String(row.id))) return cache.get(String(row.id));

  const existing = validThumbs(row.photo_thumbs);
  if (hasThumb(existing)) {
    cache.set(String(row.id), existing);
    return existing;
  }

  const urls = parseItemPhotos(row);
  const thumbs = [];
  for (const url of urls.slice(0, 5)) {
    const buf = photoBufferFromUrl(url);
    const thumb = buf ? await thumbDataUrl(buf) : null;
    thumbs.push(thumb);
  }

  cache.set(String(row.id), thumbs);
  run('UPDATE items SET photo_thumbs = ? WHERE id = ?', JSON.stringify(thumbs), row.id)
    .then(() => console.log(`[thumbs] самовосстановление item ${row.id}: ${thumbs.filter(Boolean).length} min`))
    .catch((err) => console.warn(`[thumbs] save item ${row.id}:`, err.message));

  return thumbs;
}

export function invalidateFeedThumbsCache(itemId) {
  if (itemId != null) cache.delete(String(itemId));
}