/**
 * Словарь стемов для офлайн-категоризации.
 * Источники:
 *  - сид-файл server/data/generated-rules.json (ручной/офлайн-экспорт);
 *  - таблица categorization_stems (саморастущий словарь: ИИ выводит стемы из
 *    реальных подтверждённых названий — см. catgrow.js).
 * Держим объединённый Map<категория, Set<стем>> в памяти; чтение БД — один раз
 * (или после refreshGeneratedRules), запись новых стемов — сразу в память + фоном в БД.
 */
import fs from 'fs';
import { all, run } from './db.js';

const FILE_URL = new URL('../data/generated-rules.json', import.meta.url);

function cleanStem(raw) {
  return String(raw ?? '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[\s,.;:!?"'«»()\-–—/\\+]/g, ' ')
    .trim();
}

function loadFileStems() {
  const out = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE_URL, 'utf8'));
    for (const [cat, stems] of Object.entries(parsed || {})) {
      const set = new Set();
      for (const s of Array.isArray(stems) ? stems : []) {
        const stem = cleanStem(s);
        if (stem && stem.length >= 3) set.add(stem);
      }
      if (set.size) out.set(cat, set);
    }
  } catch {
    /* файла нет или он битый — словарь соберётся из БД */
  }
  return out;
}

const fileStems = loadFileStems();
let merged = null;
let loadPromise = null;

async function load() {
  const map = new Map();
  for (const [cat, set] of fileStems) map.set(cat, new Set(set));
  try {
    const rows = await all('SELECT category, stem FROM categorization_stems');
    for (const row of Array.isArray(rows) ? rows : []) {
      const cat = String(row.category);
      const stem = cleanStem(row.stem);
      if (!cat || !stem || stem.length < 3) continue;
      if (!map.has(cat)) map.set(cat, new Set());
      map.get(cat).add(stem);
    }
  } catch {
    /* таблицы ещё нет или БД недоступна — работаем на сид-файле */
  }
  merged = map;
  return merged;
}

/** Гарантирует, что словарь загружен (один раз, лениво). */
export async function ensureGeneratedRules() {
  if (merged) return merged;
  if (!loadPromise) loadPromise = load();
  return loadPromise;
}

/** Текущий словарь (без ожидания; до загрузки — только сид-файл). */
export function generatedRules() {
  return merged || fileStems;
}

/** Перечитать словарь из БД (например, после внешнего пополнения). */
export async function refreshGeneratedRules() {
  merged = null;
  loadPromise = null;
  return ensureGeneratedRules();
}

/**
 * Добавляет стемы категории: сразу в память, фоном в БД.
 * @returns {Promise<number>} сколько новых стемов добавлено
 */
export async function addStems(category, stems) {
  if (!category) return 0;
  const map = await ensureGeneratedRules();
  const set = map.get(category) || new Set();
  map.set(category, set);
  let added = 0;
  for (const raw of Array.isArray(stems) ? stems : []) {
    const stem = cleanStem(raw);
    if (!stem || stem.length < 3 || stem.length > 40) continue;
    if (set.has(stem)) continue;
    set.add(stem);
    added += 1;
    void run(
      'INSERT INTO categorization_stems (category, stem) VALUES (?, ?) ON CONFLICT (category, stem) DO NOTHING',
      category,
      stem,
    ).catch(() => {});
  }
  return added;
}