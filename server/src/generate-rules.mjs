/**
 * Локальный инструмент: расширяет офлайн-словарь (server/data/generated-rules.json)
 * на основе РЕАЛЬНЫХ названий из categorization_log, которые пользователи
 * подтвердили или исправили. Для каждого имени ИИ выводит короткий стем
 * (начальную часть слова), чтобы ловить склонения. Ничего не выдумывает.
 * Запуск (из папки server): node src/generate-rules.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '..', '.env');
try {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^[A-Z0-9_]+=/);
    if (m) process.env[m[0].slice(0, -1)] = line.slice(m[0].length).trim();
  }
} catch { /* no .env */ }

const { zhipuChat, parseJsonEnvelope } = await import('./zai.js');
const { RECYCLING_CATEGORIES } = await import('./moderation.js');

delete process.env.DATABASE_URL; // локальный SQLite-файл, не прод Postgres
const { all } = await import('./db.js');

const OUT = path.join(__dirname, '..', 'data', 'generated-rules.json');
const apiKey = process.env.ZHIPU_API_KEY?.trim();
const model = process.env.ZHIPU_TEXT_MODEL?.trim() || 'glm-4.7-flash';
console.log('ключ:', apiKey ? apiKey.slice(0, 8) + '… (len ' + apiKey.length + ')' : 'НЕТ', '| модель:', model);

async function namesByCategory() {
  const out = new Map();
  try {
    const rows = await all(
      `SELECT name, category, SUM(CASE WHEN corrected = 1 THEN 2 ELSE 1 END) AS weight
       FROM categorization_log
       WHERE category != 'Другое' AND name != ''
       GROUP BY name, category
       ORDER BY weight DESC
       LIMIT 800`,
    );
    for (const r of rows) {
      const cat = String(r.category || '').trim();
      const name = String(r.name || '').trim();
      if (!cat || !name || cat === 'Другое' || !RECYCLING_CATEGORIES.includes(cat)) continue;
      if (!out.has(cat)) out.set(cat, []);
      const list = out.get(cat);
      if (list.length < 60 && !list.includes(name)) list.push(name);
    }
  } catch { /* таблицы/логов нет */ }
  return out;
}

async function stemsFor(cat, names) {
  const prompt = `Реальные названия вещей, отнесённые пользователями к категории «${cat}»: ${names.map((n) => `«${n}»`).join(', ')}.
Для каждого названия дай его стем — короткую начальную часть слова (без окончания), чтобы находить эту вещь и её склонения. Не добавляй никаких других слов и категорий, только стемы этих названий.
Формат ответа: ТОЛЬКО JSON-массив строчных строк, например ["коляск","подгузник","бутылочк"].`;
  const opts = { apiKey, model, timeoutMs: 120000, retries: 2, maxTokens: 3000 };
  let res = await zhipuChat(
    [{ role: 'system', content: 'Ты кратко отвечаешь только JSON-массивом, без пояснений.' },
     { role: 'user', content: prompt }],
    opts,
  );
  let parsed = res.ok ? parseJsonEnvelope(res.content) : null;
  if (!Array.isArray(parsed)) {
    const rescue = await zhipuChat(
      [{ role: 'system', content: 'Верни JSON-массив стемов без пояснений и markdown.' },
       { role: 'user', content: prompt }],
      { ...opts, retries: 1 },
    );
    parsed = rescue.ok ? parseJsonEnvelope(rescue.content) : null;
    if (!Array.isArray(parsed)) {
      console.error(`  ${cat}: не получилось (${res.status || res.error || 'no json'})`);
      return [];
    }
  }
  return parsed
    .map((s) => String(s ?? '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim())
    .filter((s) => s && s.length >= 3 && !s.includes(' '))
    .slice(0, 60);
}

const found = await namesByCategory();
console.log('категорий с реальными правками:', found.size);
if (!found.size) {
  console.log('Логов пока нет — офлайн-словарь расти нечем. Ничего не меняю.');
  process.exit(0);
}

let merged = {};
try {
  merged = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch { /* первый запуск */ }

for (const [cat, names] of found) {
  const stems = await stemsFor(cat, names);
  console.log(`  ${cat}: ${stems.length} стемов (из ${names.length} названий)`);
  if (stems.length) {
    const union = [...new Set([...(merged[cat] || []), ...stems])];
    union.sort((a, b) => a.localeCompare(b, 'ru'));
    merged[cat] = union.slice(0, 80);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n', 'utf8');
const total = Object.values(merged).reduce((s, a) => s + a.length, 0);
console.log('Готово:', OUT, '| стемов всего:', total);