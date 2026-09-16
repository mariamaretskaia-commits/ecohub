/**
 * Кэш категоризации: имя вещи → категория.
 * - in-memory LRU (до 1000 записей) для мгновенного повтора в рамках процесса;
 * - персистентность в таблицу categorization_cache (SQLite локально, Postgres в проде).
 * Категория верифицируется на вызывающей стороне (validCategory), т.к. набор
 * категорий может отличаться (ITEM_CATEGORIES против RECYCLING_CATEGORIES).
 */
import { get, run } from './db.js';
import { normalize } from './categorize.js';

const LRU_MAX = 1000;
const LRU = new Map();
let loaded = false;

function remember(key, category) {
  if (LRU.has(key)) LRU.delete(key);
  LRU.set(key, category);
  if (LRU.size > LRU_MAX) LRU.delete(LRU.keys().next().value);
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const rows = await get('SELECT name, category FROM categorization_cache ORDER BY cnt DESC, updated_at DESC LIMIT 1000');
    const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    for (const row of list) {
      if (row?.name && row?.category) remember(String(row.name), String(row.category));
    }
  } catch {
    /* кэш не критичен: при проблеме просто работаем без него */
  }
}

/**
 * Возвращает категорию из кэша (null, если ещё не знаем).
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export async function cacheLookup(name) {
  await ensureLoaded();
  const key = normalize(name);
  if (!key) return null;
  if (LRU.has(key)) return LRU.get(key);
  try {
    const row = await get('SELECT category FROM categorization_cache WHERE name = ?', key);
    if (row?.category) {
      remember(key, String(row.category));
      return String(row.category);
    }
  } catch {
    /* нет кэша — продолжаем обычный путь */
  }
  return null;
}

/** Запоминает категорию (in-memory сразу, в БД — фоном). */
export function cacheStore(name, category) {
  const key = normalize(name);
  if (!key) return;
  remember(key, category);
  void run(
    `INSERT INTO categorization_cache (name, category, cnt, updated_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET
       category = excluded.category,
       cnt = cnt + 1,
       updated_at = datetime('now')`,
    key,
    category,
  ).catch(() => {});
}