/**
 * Саморастущий словарь. Периодически читает новые записи categorization_log,
 * просит ИИ вывести короткие стемы из РЕАЛЬНЫХ названий (ничего не выдумывает)
 * и сохраняет их через catrules.addStems. Работает прямо в веб-сервисе —
 * отдельный cron на free-тарифе не нужен. Все ошибки некритичны.
 */
import { all, get, run } from './db.js';
import { zhipuChat, zhipuKey, parseJsonEnvelope } from './zai.js';
import { RECYCLING_CATEGORIES } from './moderation.js';
import { addStems } from './catrules.js';

const MARKER = 'stems_last_log_id';
const MAX_LOG_ROWS = 80;
const MAX_NAMES_PER_CAT = 30;

/** Стемы для заданных названий одной категории (ИИ). */
export async function deriveStems(category, names, opts = {}) {
  const apiKey = opts.apiKey || zhipuKey();
  if (!apiKey || !names?.length) return [];
  const list = names.map((n) => `«${n}»`).join(', ');
  const prompt = `Реальные названия вещей, отнесённые к категории «${category}»: ${list}.
Для каждого названия дай его стем — короткую начальную часть слова (без окончания), чтобы находить эту вещь и её склонения. Не добавляй никаких других слов и категорий, только стемы этих названий.
Формат ответа: ТОЛЬКО JSON-массив строчных строк, например ["коляск","подгузник","бутылочк"].`;
  const base = {
    apiKey,
    model: opts.model,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs ?? 45000,
    retries: opts.retries ?? 1,
    maxTokens: 1500,
  };
  let res = await zhipuChat(
    [{ role: 'system', content: 'Ты кратко отвечаешь только JSON-массивом, без пояснений.' },
     { role: 'user', content: prompt }],
    base,
  );
  let parsed = res.ok ? parseJsonEnvelope(res.content) : null;
  if (!Array.isArray(parsed)) {
    const rescue = await zhipuChat(
      [{ role: 'system', content: 'Верни JSON-массив стемов, без пояснений и markdown.' },
       { role: 'user', content: prompt }],
      { ...base, retries: 0 },
    );
    parsed = rescue.ok ? parseJsonEnvelope(rescue.content) : null;
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((s) => String(s ?? ''))
    .filter(Boolean)
    .slice(0, 60);
}

/**
 * Обрабатывает порцию новых логов и пополняет словарь.
 * @returns {Promise<{skipped?:string, processed?:number, categories?:number, added?:number}>}
 */
export async function growStems(opts = {}) {
  const apiKey = opts.apiKey || zhipuKey();
  if (!apiKey) return { skipped: 'no_key' };

  let lastId = 0;
  try {
    const row = await get('SELECT value FROM meta WHERE key = ?', MARKER);
    lastId = Number(row?.value) || 0;
  } catch {
    /* нет meta — начнём с нуля */
  }

  let rows;
  try {
    rows = await all(
      `SELECT id, name, category FROM categorization_log
       WHERE id > ? AND category != 'Другое' AND name != ''
       ORDER BY id ASC LIMIT ?`,
      lastId,
      MAX_LOG_ROWS,
    );
  } catch {
    return { skipped: 'no_logs_table' };
  }
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return { processed: 0 };

  const byCat = new Map();
  let maxId = lastId;
  for (const r of rows) {
    maxId = Math.max(maxId, Number(r.id) || 0);
    const cat = String(r.category || '').trim();
    const name = String(r.name || '').trim();
    if (!name || cat === 'Другое' || !RECYCLING_CATEGORIES.includes(cat)) continue;
    if (!byCat.has(cat)) byCat.set(cat, []);
    const list = byCat.get(cat);
    if (list.length < MAX_NAMES_PER_CAT && !list.includes(name)) list.push(name);
  }

  let added = 0;
  for (const [cat, names] of byCat) {
    try {
      const stems = await deriveStems(cat, names, opts);
      added += await addStems(cat, stems);
    } catch {
      /* одна категория не удалась — остальные продолжаем */
    }
  }

  try {
    await run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', MARKER, String(maxId));
  } catch {
    /* маркер не сохранился — просто обработаем те же строки ещё раз (идемпотентно) */
  }
  return { processed: rows.length, categories: byCat.size, added };
}

let started = false;

/** Запускает фоновый цикл роста (не блокирует выход процесса). */
export function startGrowthLoop({ initialDelayMs = 90000, intervalMs = 6 * 3600 * 1000 } = {}) {
  if (started) return;
  started = true;
  const kick = () => {
    growStems()
      .then((r) => {
        if (r && (r.added || r.processed)) console.log('[grow-stems]', JSON.stringify(r));
      })
      .catch(() => {});
  };
  const first = setTimeout(kick, initialDelayMs);
  if (typeof first.unref === 'function') first.unref();
  const timer = setInterval(kick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}