/**
 * Планирование маршрута сдачи вещей на переработку по категориям.
 * (Классификация по фото удалена — распознавание вещей идёт по названию
 * в categorize.js через Zhipu с офлайн-словарём.)
 */
import { all } from './db.js';
import { ITEM_CATEGORIES } from './moderation.js';

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