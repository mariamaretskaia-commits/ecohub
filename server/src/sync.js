import { get, all, run } from './db.js';
import { locateByAddress } from './grodno-geo.js';

const UA = 'EcoHub/1.0 (+https://t.me/EcoHubBY_bot)';

async function loadHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

function clean(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;|&ndash;|—/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

async function applyLive(sourceKey, patch) {
  const row = await get('SELECT id FROM recycling_points WHERE source_key = ?', sourceKey);
  if (!row) return false;
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
  sets.push("last_synced = datetime('now')");
  values.push(row.id);
  await run(`UPDATE recycling_points SET ${sets.join(', ')} WHERE id = ?`, ...values);
  return true;
}

async function matchKeyByAddress(text) {
  const geo = locateByAddress(text);
  if (!geo) return null;
  const rows = await all('SELECT source_key, address FROM recycling_points');
  return rows.find((r) => locateByAddress(r.address)?.district === geo.district && (r.address || '').toLowerCase().includes(geo.match[0]))?.source_key
    || rows.find((r) => (r.address || '').toLowerCase().includes(geo.match[0]))?.source_key
    || null;
}

async function syncZagottorg() {
  const html = await loadHtml('https://zagottorg.by/adresa/');
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let updated = 0;
  for (const match of html.matchAll(rowRe)) {
    const address = clean(match[1]);
    const hours = clean(match[2]);
    if (!address || address.toLowerCase().includes('адрес')) continue;
    if (/вилейка|поречье|озеры|сопоцкин|гожа|скидель|индура/i.test(address)) continue;
    const key = await matchKeyByAddress(address);
    if (!key) continue;
    if (await applyLive(key, { hours })) updated += 1;
  }
  return updated;
}

async function syncBelvtor() {
  const text = clean(await loadHtml('https://belvtor.by/branchs/'));
  const block = text.match(/г\.\s*Гродно[\s\S]{0,280}/i);
  if (!block) return 0;
  const hours = (block[0].match(/Пн[^.]{8,80}/i) || [])[0];
  const phone = (block[0].match(/\+375[\d\s()-]{8,}|8015[\d-]{5,}/) || [])[0];
  return (await applyLive('belvtor:хвойная-1', { hours, phone })) ? 1 : 0;
}

async function syncGrodnobvm() {
  const text = clean(await loadHtml('https://grodnobvm.by/informacziya-dlya-fizicheskih-licz/'));
  const chunks = [
    { key: 'grodnobvm:скидельское-8в', needle: 'скидельское' },
    { key: 'grodnobvm:ткацкая-8', needle: 'ткацкая' },
    { key: 'grodnobvm:южный-30', needle: 'индурское' },
  ];
  let updated = 0;
  for (const chunk of chunks) {
    const idx = text.toLowerCase().indexOf(chunk.needle);
    if (idx < 0) continue;
    const slice = text.slice(idx, idx + 280);
    const hours = (slice.match(/пн[\s\S]{10,140}?выходн\w+/i) || [])[0];
    const phone = (slice.match(/\+375[\d\s-]{8,}/) || [])[0];
    if (await applyLive(chunk.key, { hours, phone })) updated += 1;
  }
  return updated;
}

async function syncOneAk() {
  const text = clean(await loadHtml('https://1ak.by/tradein'));
  const items = [
    { key: '1ak:суворова-166', needle: 'суворова, 166' },
    { key: '1ak:индурское-11', needle: 'индурское шоссе, 11' },
    { key: '1ak:лиможа-54', needle: 'лиможа, 54' },
  ];
  let updated = 0;
  for (const item of items) {
    const idx = text.toLowerCase().indexOf(item.needle);
    if (idx < 0) continue;
    const slice = text.slice(idx, idx + 220);
    const hours = (slice.match(/Пн[\s\S]{8,90}18:00/i) || [])[0];
    if (await applyLive(item.key, { hours })) updated += 1;
  }
  return updated;
}

async function syncGrbo() {
  const text = clean(await loadHtml('https://grbo.by/punkt-gumanitarnoy-pomoschi'));
  const hours = (text.match(/понедельник[\s\S]{10,120}?выходной/i) || [])[0];
  const phone = (text.match(/8\s*\(0152\)\s*39\s*67\s*90[^.]{0,40}/) || [])[0];
  return (await applyLive('grbo:академическая-2', { hours, phone })) ? 1 : 0;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const GRODNO_OVERPASS_BBOX = '53.60,23.71,53.76,23.94';

function formatStop(name, dist) {
  const meters = Math.max(10, Math.round(dist / 10) * 10);
  if (dist < 25) return `остановка «${name}» · у пункта`;
  return `остановка «${name}» · ${meters} м`;
}

async function fetchGrodnoBusStops() {
  const query = `[out:json][timeout:40];node(${GRODNO_OVERPASS_BBOX})["highway"="bus_stop"];out body;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const json = await res.json();
  return (json.elements || [])
    .filter((el) => el.lat && el.lon && (el.tags?.['name:ru'] || el.tags?.name))
    .map((el) => ({
      name: el.tags['name:ru'] || el.tags.name,
      lat: el.lat,
      lng: el.lon,
    }));
}

function nearestStop(point, stops) {
  let best = null;
  for (const stop of stops) {
    const dist = haversineMeters(point.lat, point.lng, stop.lat, stop.lng);
    if (!best || dist < best.dist) best = { name: stop.name, dist };
  }
  return best;
}

async function enrichTransit() {
  const points = await all('SELECT id, lat, lng, transit FROM recycling_points WHERE lat IS NOT NULL AND lng IS NOT NULL');
  if (!points.length) return 0;
  const stops = await fetchGrodnoBusStops();
  if (!stops.length) return 0;

  let updated = 0;
  for (const point of points) {
    const nearest = nearestStop(point, stops);
    if (!nearest) continue;
    const label = formatStop(nearest.name, nearest.dist);
    if (label !== point.transit) {
      await run('UPDATE recycling_points SET transit = ? WHERE id = ?', label, point.id);
      updated += 1;
    }
  }
  return updated;
}

export async function syncOfficialPoints() {
  const results = {};
  const jobs = [
    ['zagottorg', syncZagottorg],
    ['belvtor', syncBelvtor],
    ['grodnobvm', syncGrodnobvm],
    ['1ak', syncOneAk],
    ['grbo', syncGrbo],
  ];
  for (const [name, job] of jobs) {
    try {
      results[name] = await job();
    } catch (err) {
      results[name] = `error: ${err.message}`;
    }
  }
  try {
    results.transit = await enrichTransit();
  } catch (err) {
    results.transit = `error: ${err.message}`;
  }
  await run("INSERT OR REPLACE INTO meta (key, value) VALUES ('points_synced_at', datetime('now'))");
  console.log('🔄 Автообновление пунктов:', results);
  return results;
}

export function startPointSync() {
  const runSync = () => syncOfficialPoints().catch((err) => console.warn('Point sync failed:', err.message));
  setTimeout(runSync, 4000);
  setInterval(runSync, 6 * 60 * 60 * 1000);
}
