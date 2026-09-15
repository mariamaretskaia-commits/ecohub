/**
 * Vision: классификация вещей по фото (Zhipu GLM-4.6V-Flash) и планирование
 * маршрута сдачи на переработку.
 *
 * Уровни распознавания: 1) сервер (Zhipu) → 2) CLIP в браузере → 3) ручной выбор.
 * Здесь уровень 1 + планировщик маршрута по категориям.
 */
import { all } from './db.js';
import { ITEM_CATEGORIES } from './moderation.js';

const VISION_MODEL = 'glm-4.6v-flash';
export const VISION_TIMEOUT_MS = 25000;
export const VISION_MAX_RETRIES = 2;

const ACCEPTED = new Set(ITEM_CATEGORIES);

/** Категория вещи → типы пунктов приёма (paper, glass, plastic, electronics, clothing, hazardous, metal, other). */
const CATEGORY_TO_POINT_TYPES = {
  Одежда: ['clothing'],
  Обувь: ['clothing'],
  Детям: ['clothing'],
  Мебель: ['other'],
  Техника: ['electronics'],
  Электроника: ['electronics'],
  Посуда: ['glass', 'other'],
  Книги: ['paper'],
  Спорт: ['other'],
  Инструменты: ['metal', 'other'],
  Красота: ['hazardous', 'other'],
  Растения: ['other'],
  Животным: ['other'],
  Другое: ['other'],
};

export function mapCategoryToPointTypes(category) {
  return CATEGORY_TO_POINT_TYPES[category] || ['other'];
}

export function visionAvailable() {
  return Boolean(process.env.ZHIPU_API_KEY);
}

function visionUrl() {
  return process.env.ZHIPU_VISION_URL || 'https://api.z.ai/api/paas/v4/chat/completions';
}

const SYSTEM_PROMPT = [
  'Ты — классификатор вещей для сервиса безвозмездного обмена «EcoHub» (ЭкоХаб).',
  'По фото определи предмет, который человек хочет отдать, и его категорию.',
  `Категории — только из этого списка: ${ITEM_CATEGORIES.join(', ')}.`,
  'Если нет подходящей категории — выбери «Другое». Если предметов несколько — опиши главный.',
  'Ответь строго валидным JSON без markdown и пояснений:',
  '{"name":"название предмета по-русски (1–3 слова)","category":"одна из категорий","confidence":0.0}',
].join('\n');

let failures = 0;
let cooldownUntil = 0;

export function _resetVisionForTests() {
  failures = 0;
  cooldownUntil = 0;
}

/** Адаптивная пауза: 1с → 2с → 4с → … (кап ZHIPU_COOLDOWN_MAX_MS). */
function backoffMs() {
  const base = Math.max(250, Number(process.env.ZHIPU_COOLDOWN_MS || 1000));
  const cap = Math.max(base, Number(process.env.ZHIPU_COOLDOWN_MAX_MS || 15000));
  return Math.min(cap, base * 2 ** Math.min(failures, 6));
}

/** transient — сбой/перегрузка (растёт геометрически), иначе — авторизация (фикс. пауза). */
function recordFailure(transient = true) {
  if (transient) {
    failures += 1;
    cooldownUntil = Date.now() + backoffMs();
  } else {
    cooldownUntil = Date.now() + Number(process.env.ZHIPU_AUTH_COOLDOWN_MS || 60000);
  }
}

function recordSuccess() {
  failures = 0;
  cooldownUntil = 0;
}

function coolingDown() {
  return Date.now() < cooldownUntil;
}

function retryAfterSeconds(res) {
  const raw = res?.headers?.get?.('retry-after');
  const s = Number(raw);
  if (Number.isFinite(s) && s >= 0) return Math.min(s, 10);
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Zhipu timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Достаёт JSON из ответа модели (устойчив к markdown-обёрткам и лишнему тексту). */
export function parseVisionJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  t = t.slice(start, end + 1);
  try {
    const obj = JSON.parse(t);
    if (!obj || typeof obj !== 'object') return null;
    const category = String(obj.category || '').trim();
    if (!ACCEPTED.has(category)) return null;
    const name = String(obj.name || '').trim().slice(0, 60);
    if (!name) return null;
    let confidence = Number(obj.confidence);
    if (!Number.isFinite(confidence)) return null;
    confidence = Math.min(Math.max(confidence, 0), 1);
    return { name, category, confidence };
  } catch {
    return null;
  }
}

/**
 * Классификация изображения через Zhipu.
 * imageRef — data URL (base64) или https-ссылка.
 * Успех → { name, category, confidence }; иначе { fallback: true, ... }.
 */
export async function classifyWithZhipu(imageRef, opts = {}) {
  if (!visionAvailable()) return { fallback: true, reason: 'config' };
  const ref = String(imageRef || '');
  if (!ref) return { fallback: true, reason: 'empty' };
  if (ref.startsWith('data:') && ref.length > 8_000_000) {
    return { fallback: true, reason: 'size' };
  }
  if (coolingDown()) return { fallback: true, reason: 'cooldown' };

  const timeoutMs = opts.timeoutMs ?? VISION_TIMEOUT_MS;
  const retries = opts.retries ?? VISION_MAX_RETRIES;
  const customFetch = opts.fetchImpl || globalThis.fetch.bind(globalThis);

  const payload = {
    model: process.env.ZHIPU_VISION_MODEL || VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: ref } },
          { type: 'text', text: SYSTEM_PROMPT },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: Number(process.env.ZHIPU_MAX_TOKENS || 160),
    ...(process.env.ZHIPU_THINKING_DISABLED !== 'false'
      ? { thinking: { type: 'disabled' } }
      : {}),
  };

  let lastErr = null;
  let fallbackReason = 'network';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await withTimeout(
        customFetch(visionUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.ZHIPU_API_KEY}`,
          },
          body: JSON.stringify(payload),
        }),
        timeoutMs,
      );
      if (res.ok) {
        const data = await res.json();
        const text = String(data?.choices?.[0]?.message?.content || '');
        const parsed = parseVisionJson(text);
        if (parsed) {
          recordSuccess();
          return parsed;
        }
        lastErr = new Error('Zhipu parse');
        fallbackReason = 'parse';
        if (attempt < retries) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        break;
      }
      const status = Number(res.status);
      if (status === 401 || status === 403) {
        recordFailure(false);
        return { fallback: true, reason: 'auth', error: `Zhipu HTTP ${status}` };
      }
      if (status === 429 || status >= 500) {
        lastErr = new Error(`Zhipu HTTP ${status}`);
        if (attempt < retries) {
          const ra = retryAfterSeconds(res);
          await sleep(ra ?? 800 * (attempt + 1));
          continue;
        }
        break;
      }
      lastErr = new Error(`Zhipu HTTP ${status}`);
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
    }
  }

  recordFailure(true);
  return { fallback: true, reason: fallbackReason, error: String(lastErr?.message || lastErr) };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeAccepts(point) {
  const raw = String(point.accepts || point.type || '');
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Планирует до 2 маршрутов сдачи вещей на переработку.
 * Возвращает { routes, uncovered }: каждый маршрут покрывает свои категории,
 * пункты упорядочены по близости при заданных координатах.
 */
export async function planRecyclingRoute(categories, userLat = null, userLng = null) {
  const unique = [...new Set((Array.isArray(categories) ? categories : []).filter(Boolean))];
  if (!unique.length) return { routes: [], uncovered: [] };

  const wantedTypes = [...new Set(unique.flatMap((c) => mapCategoryToPointTypes(c)))];
  const found = [];
  const seen = new Set();
  for (const type of wantedTypes) {
    const rows = await all(
      'SELECT * FROM recycling_points WHERE type = ? OR accepts LIKE ?',
      type,
      `%${type}%`,
    );
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      found.push(row);
    }
  }
  found.sort((a, b) => Number(a.id) - Number(b.id));

  const acceptedSet = new Map();
  for (const point of found) {
    acceptedSet.set(point.id, new Set(normalizeAccepts(point).concat(point.type)));
  }

  const covers = (point, category) =>
    mapCategoryToPointTypes(category).some((t) => acceptedSet.get(point.id)?.has(t));

  const distKm = (point) => {
    if (
      userLat == null || userLng == null ||
      point.lat == null || point.lng == null
    ) return null;
    return haversineKm(Number(userLat), Number(userLng), Number(point.lat), Number(point.lng));
  };

  const remaining = new Set(unique);
  const routes = [];

  while (remaining.size && routes.length < 2) {
    let best = null;
    for (const point of found) {
      if (routes.some((r) => r.point.id === point.id)) continue;
      const covered = [...remaining].filter((c) => covers(point, c));
      if (!covered.length) continue;
      const d = distKm(point);
      const score = covered.length * 100 - (d == null ? 0 : d);
      const better =
        !best ||
        score > best.score ||
        (score === best.score && d != null && (best.dist == null || d < best.dist));
      if (better) best = { point, covered, dist: d, score };
    }
    if (!best) break;

    const names =
      best.covered.length >= 3
        ? `${best.covered.length} категории из ваших вещей`
        : best.covered.filter(Boolean).join(', ');
    routes.push({
      point: best.point,
      categories: best.covered,
      reason: `Принимает: ${names}`,
      distanceKm: best.dist,
    });
    best.covered.forEach((c) => remaining.delete(c));
  }

  return { routes, uncovered: [...remaining] };
}