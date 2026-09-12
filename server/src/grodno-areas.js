export const GRODNO_AREAS = {
  Центр: [53.676, 23.829],
  Победа: [53.689, 23.849],
  Ольшанка: [53.684, 23.892],
  'Белые Росы': [53.716, 23.859],
  Девятовка: [53.734, 23.866],
  Зарица: [53.752, 23.843],
  Переселка: [53.725, 23.844],
  Форты: [53.723, 23.895],
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

function distKm(a, b) {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Ближайший микрорайон Гродно по координатам. */
export function grodnoArea(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
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