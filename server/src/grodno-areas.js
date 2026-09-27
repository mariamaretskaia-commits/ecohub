export const GRODNO_AREAS = {
  Центр: [53.676, 23.829],
  Победа: [53.689, 23.849],
  Ольшанка: [53.624, 23.813],
  'Белые Росы': [53.716, 23.859],
  Девятовка: [53.703, 23.847],
  Зарица: [53.752, 23.843],
  Переселка: [53.725, 23.844],
  Форты: [53.708, 23.808],
  Антоново: [53.725, 23.818],
  Грандичи: [53.695, 23.775],
  Лососно: [53.678, 23.772],
  Барановичи: [53.672, 23.733],
  Фолюш: [53.654, 23.803],
  Понемунь: [53.661, 23.895],
  Южный: [53.633, 23.865],
  Вишневец: [53.645, 23.864],
  Колбасино: [53.657, 23.874],
};

/**
 * Адресные правила Гродно: применяются до центроидного подбора,
 * т.к. у «Усход»/Победы, Девятовки и центра границы не сводятся к координатам.
 * Импортируется research'ом (server/scripts/geo-research.mjs) — единый источник.
 */
const GRODNO_STREET_RULES = [
  { match: ['ткацкая'], district: 'Лососно' },
  { match: ['скидельское шоссе'], district: 'Понемунь' },
  { match: ['аульская'], district: 'Понемунь' },
  { match: ['подольная'], district: 'Центр' },
  { match: ['ложице'], district: 'Форты' },
  { match: ['озерское шоссе'], district: 'Победа' },
  { match: ['озёрское шоссе'], district: 'Победа' },
  { match: ['куйбышева'], district: 'Победа' },
  { match: ['карского'], district: 'Победа' },
  { match: ['тавлая'], district: 'Девятовка' },
  { match: ['терешковой'], district: 'Девятовка' },
  { match: ['академическая'], district: 'Центр' },
  { match: ['горького', '121'], district: 'Форты' },
  { match: ['богуцкого'], district: 'Форты' },
  { match: ['домбровского'], district: 'Форты' },
  { match: ['пестрака'], district: 'Вишневец' },
  { match: ['индурское шоссе'], district: 'Южный' },
  { match: ['гаражная'], district: 'Южный' },
  { match: ['сухомбаева'], district: 'Центр' },
  { match: ['скрынника'], district: 'Центр' },
  { match: ['коммунальная'], district: 'Центр' },
  { match: ['хвойная'], district: 'Лососно' },
];

export function streetRule(address) {
  const a = String(address || '').toLowerCase();
  for (const rule of GRODNO_STREET_RULES) {
    if (rule.match.every((m) => a.includes(String(m).toLowerCase()))) return rule.district;
  }
  return null;
}

function distKm(a, b) {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Ближайший микрорайон Гродно по координатам (с адресными правилами). */
export function grodnoArea(lat, lng, address) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  const byStreet = streetRule(address);
  if (byStreet) return byStreet;
  let best = null;
  let bestD = Infinity;
  for (const [name, coords] of Object.entries(GRODNO_AREAS)) {
    const d = distKm(coords, [Number(lat), Number(lng)]);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}