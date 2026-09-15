import { all, run } from './db.js';
import { deleteStoredPhotos } from './storage.js';

/** Список фото объявления (строка JSON в items.photos либо legacy photo_url). */
export function parseItemPhotos(item) {
  if (!item) return [];
  try {
    const raw = item.photos;
    if (raw) {
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(list)) return list.filter(Boolean);
    }
  } catch { /* ignore */ }
  return item.photo_url ? [item.photo_url] : [];
}

/** Полное удаление объявления вместе с откликами, избранным и фото. */
export async function removeItemWithAssets(item) {
  if (!item?.id) return;
  const photos = parseItemPhotos(item);
  await run('DELETE FROM item_wants WHERE item_id = ?', item.id);
  await run('DELETE FROM item_favorites WHERE item_id = ?', item.id);
  await run('DELETE FROM items WHERE id = ?', item.id);
  if (photos.length) await deleteStoredPhotos(photos);
}

/** Читатели откликов объявления (для авто-удаления не нужны, но удобно). */
export async function itemWantsCount(itemId) {
  const row = await all('SELECT id FROM item_wants WHERE item_id = ?', itemId);
  return row.length;
}