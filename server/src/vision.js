/**
 * Планирование маршрута сдачи вещей на переработку.
 * Матчинг «вещь → пункт» идёт по видам приёма (point-kinds.js): пункт подходит
 * только если вид вещи реально входит в его перечень приёма. Иначе — «Пункт не найден».
 * (Классификация по фото удалена – распознавание вещей идёт по названию
 * в categorize.js через Zhipu с офлайн-словарём.)
 */
import { all } from './db.js';
import { kindsForItem, pointKindsFor } from './point-kinds.js';

/** Категория вещи → виды приёма. */
export function mapCategoryToKinds(category) {
  return kindsForItem(null, category);
}

/** Есть ли в БД пункт, принимающий хотя бы один вид этой вещи. */
export async function hasPointForItem(name, category) {
  const wanted = kindsForItem(name, category);
  if (!wanted.length) return false;
  const points = await all('SELECT type, accepts, accept_kinds FROM recycling_points');
  return points.some((p) => {
    const accepted = pointKindsFor(p);
    return wanted.some((k) => accepted.includes(k));
  });
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

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const item = typeof raw === 'string'
      ? { name: null, category: raw }
      : { name: raw?.name ? String(raw.name).trim() : null, category: raw?.category };
    const category = String(item.category || '').trim();
    if (!category) continue;
    const key = `${item.name || ''}\u0000${category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: item.name, category });
  }
  return out;
}

/**
 * Планирует до 2 маршрутов сдачи вещей.
 * items: [{ name, category }] или строки категорий (совместимо).
 * Возвращает { routes, uncovered }: каждый маршрут покрывает свои вещи,
 * пункты упорядочены по близости при заданных координатах.
 */
export async function planRecyclingRoute(items, userLat = null, userLng = null) {
  const list = normalizeItems(items);
  if (!list.length) return { routes: [], uncovered: [] };

  const points = await all('SELECT * FROM recycling_points');
  const wanted = list.map((it) => ({ ...it, kinds: kindsForItem(it.name, it.category) }));
  const acceptedByPoint = new Map(points.map((p) => [p.id, pointKindsFor(p)]));

  const distKm = (point) => {
    if (
      userLat == null || userLng == null ||
      point.lat == null || point.lng == null
    ) return null;
    return haversineKm(Number(userLat), Number(userLng), Number(point.lat), Number(point.lng));
  };

  const remaining = new Set(wanted.map((_, i) => i));
  const routes = [];

  while (remaining.size && routes.length < 2) {
    let best = null;
    for (const point of points) {
      if (routes.some((r) => r.point.id === point.id)) continue;
      const accepted = acceptedByPoint.get(point.id) || [];
      if (!accepted.length) continue;
      const covered = [...remaining].filter((i) =>
        wanted[i].kinds.some((k) => accepted.includes(k)),
      );
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

    const categories = [...new Set(best.covered.map((i) => wanted[i].category))];
    const names = [...new Set(best.covered.map((i) => wanted[i].name).filter(Boolean))];
    const label = names.length
      ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` и ещё ${names.length - 3}` : '')
      : categories.join(', ');
    routes.push({
      point: best.point,
      categories,
      items: names,
      reason: `Принимает: ${label}`,
      distanceKm: best.dist,
    });
    best.covered.forEach((i) => remaining.delete(i));
  }

  const uncovered = [...new Set([...remaining].map((i) => wanted[i].category))];
  return { routes, uncovered };
}
