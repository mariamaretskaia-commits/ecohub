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

/** Человекочитаемая подпись покрытия (вещи или категории). */
function coveredLabel(wanted, covered) {
  const categories = [...new Set(covered.map((i) => wanted[i].category))];
  const names = [...new Set(covered.map((i) => wanted[i].name).filter(Boolean))];
  const label = names.length
    ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` и ещё ${names.length - 3}` : '')
    : categories.join(', ');
  return { categories, names, label };
}

/**
 * Режим списка: все пункты, принимающие хотя бы один вид вещей.
 * Область поиска: город (settlement) → область (oblast) → вся страна,
 * чтобы ехать далеко только если рядом действительно ничего нет.
 * Пункты сортируются по удалённости (если заданы координаты), затем по числу
 * покрытых вещей. Возвращает { routes, uncovered, scope, total, truncated }.
 */
function planAllPoints(points, wanted, acceptedByPoint, userLat, userLng, opts) {
  const limit = Math.max(1, Number(opts.limit) || 60);

  const matches = [];
  for (const point of points) {
    const accepted = acceptedByPoint.get(point.id) || [];
    if (!accepted.length) continue;
    const covered = wanted.map((_, i) => i).filter((i) =>
      wanted[i].kinds.some((k) => accepted.includes(k)),
    );
    if (covered.length) matches.push({ point, covered });
  }

  const scopeMatch = (field, value) => (
    value ? matches.filter((m) => String(m.point[field] || '') === String(value)) : []
  );

  let scoped = matches;
  let scope = 'country';
  if (opts.settlement) {
    const bySettlement = scopeMatch('settlement', opts.settlement);
    const byOblast = scopeMatch('oblast', opts.oblast);
    if (bySettlement.length) { scoped = bySettlement; scope = 'settlement'; }
    else if (byOblast.length) { scoped = byOblast; scope = 'oblast'; }
  } else if (opts.oblast) {
    const byOblast = scopeMatch('oblast', opts.oblast);
    if (byOblast.length) { scoped = byOblast; scope = 'oblast'; }
  }

  const distOf = (point) => {
    if (
      userLat == null || userLng == null ||
      point.lat == null || point.lng == null
    ) return null;
    return haversineKm(Number(userLat), Number(userLng), Number(point.lat), Number(point.lng));
  };

  const scored = scoped.map((m) => ({ ...m, dist: distOf(m.point) }));
  scored.sort((a, b) => {
    if (a.dist == null && b.dist == null) return b.covered.length - a.covered.length;
    if (a.dist == null) return 1;
    if (b.dist == null) return -1;
    if (Math.abs(a.dist - b.dist) > 0.05) return a.dist - b.dist;
    return b.covered.length - a.covered.length;
  });

  const truncated = scored.length > limit;
  const routes = scored.slice(0, limit).map((m) => {
    const { categories, names, label } = coveredLabel(wanted, m.covered);
    return {
      point: m.point,
      categories,
      items: names,
      reason: `Принимает: ${label}`,
      distanceKm: m.dist,
    };
  });

  const coveredKinds = new Set();
  scoped.forEach((m) => (acceptedByPoint.get(m.point.id) || []).forEach((k) => coveredKinds.add(k)));
  const uncovered = [...new Set(
    wanted.filter((w) => !w.kinds.some((k) => coveredKinds.has(k))).map((w) => w.category),
  )];

  return { routes, uncovered, all: true, scope, total: scored.length, truncated };
}

/**
 * Планирует маршрут сдачи вещей.
 * items: [{ name, category }] или строки категорий (совместимо).
 * По умолчанию — до 2 маршрутов (минимум пунктов). С opts.all — все пункты,
 * принимающие вещи (список «Куда сдать»).
 */
export async function planRecyclingRoute(items, userLat = null, userLng = null, opts = {}) {
  const list = normalizeItems(items);
  if (!list.length) return { routes: [], uncovered: [] };

  const points = await all('SELECT * FROM recycling_points');
  const wanted = list.map((it) => ({ ...it, kinds: kindsForItem(it.name, it.category) }));
  const acceptedByPoint = new Map(points.map((p) => [p.id, pointKindsFor(p)]));

  if (opts.all) {
    return planAllPoints(points, wanted, acceptedByPoint, userLat, userLng, opts);
  }

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

    const { categories, names, label } = coveredLabel(wanted, best.covered);
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
