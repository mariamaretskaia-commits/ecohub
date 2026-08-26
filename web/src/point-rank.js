function blob(point) {
  return [point.hours, point.prices, point.logistics, point.description, point.name, point.organization]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function parsePrice(text) {
  const match = text.match(/(\d+[.,]\d+)\s*byn/) || text.match(/от\s+(\d+[.,]\d+)/);
  return match ? Number(match[1].replace(',', '.')) : 0;
}

function weekendOpen(hours) {
  const text = String(hours || '').toLowerCase();
  if (/сб[–-]вс:\s*выходной|сб:\s*выходной/.test(text)) return false;
  return /сб|воскресен|пн[–-]вс/.test(text);
}

export function scorePoint(point, type = '') {
  const text = blob(point);
  const hours = String(point.hours || '').toLowerCase();

  if (/временно не работает|не работает \(официальный/.test(text)) return -1000;
  if (/по договорённости|по договоренности/.test(hours)) return 8;

  let score = 0;

  const money = parsePrice(text);
  if (money) score += money * 40;
  else if (type !== 'clothing' && /прайс|прейскурант|расчёт|оплат|byn/.test(text)) score += 22;

  if (/бесплатн|безвозмездн/.test(text) && type === 'clothing') score += 6;

  if (/главный пункт|главный цех|официальный филиал/.test(text)) score += 28;
  if (/выездн|заявки на вывоз|вывоз:/.test(text)) score += 18;
  if (/автомобильные весы|расчёт в день/.test(text)) score += 10;
  if (/trade-in/.test(text)) score += 12;
  if (/круглосуточн/.test(text)) score += 24;
  if (/пн[–-]вс|работает в воскресенье/.test(hours)) score += 16;
  if (weekendOpen(hours)) score += 8;
  if (/можно сдать и взять|и приём, и выдача/.test(text)) score += 14;

  if (/14:00[-–—]15:00/.test(hours)) score -= 24;
  if (/уточняйте перед визитом|звоните заранее/.test(text)) score -= 4;
  if (!point.phone) score -= 6;

  if (type && point.type === type) score += 10;

  if (type === 'paper' && /заготторг/.test(text)) score += 12;
  if (type === 'metal' && /вторчермет/.test(text)) score += 18;
  if (type === 'electronics' && /белвти|белвтор|ресайклпро/.test(text)) score += 18;
  if (type === 'hazardous' && /1ak|аккумулятор|белвти/.test(text)) score += 16;
  if (type === 'clothing' && /красный крест|grbo/.test(text)) score += 10;

  return score;
}

export function relevanceHint(point, type = '') {
  const text = blob(point);
  const hours = String(point.hours || '').toLowerCase();
  if (/временно не работает/.test(text)) return 'Сейчас не работает';

  const bits = [];
  if (point.access_mode === 'box') bits.push('контейнер');
  else if (point.access_mode === 'desk') bits.push('приёмка');
  const money = parsePrice(text);
  if (money) bits.push(`${String(money).replace('.', ',')} BYN/кг`);
  else if (type !== 'clothing' && /прайс|прейскурант/.test(text)) bits.push('Платят по прайсу');
  if (/главный пункт|главный цех/.test(text)) bits.push('главный пункт');
  if (/выездн|заявки на вывоз/.test(text)) bits.push('есть вывоз');
  if (/круглосуточн/.test(text)) bits.push('круглосуточно');
  else if (/пн[–-]вс|работает в воскресенье/.test(hours)) bits.push('без выходных');
  if (/trade-in/.test(text)) bits.push('trade-in');
  if (/можно сдать и взять|и приём, и выдача/.test(text)) bits.push('можно сдать и взять');
  return bits.slice(0, 2).join(' · ');
}

export function sortByRelevance(points, type = '') {
  return [...points].sort((a, b) => {
    const diff = scorePoint(b, type) - scorePoint(a, type);
    if (diff) return diff;
    return String(a.short_address || a.address).localeCompare(String(b.short_address || b.address), 'ru');
  });
}
