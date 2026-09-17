import { readFileSync } from 'node:fs';
import { all, run } from './db.js';
import { derivePointKinds } from './point-kinds.js';

const TARGET99_POINTS = JSON.parse(
  readFileSync(new URL('./data/target99-points.json', import.meta.url), 'utf8')
);

const COLS = [
  'name', 'organization', 'type', 'district', 'lat', 'lng', 'address', 'phone', 'website',
  'hours', 'prices', 'logistics', 'description', 'transit', 'source_key', 'short_address',
  'accepts', 'accept_kinds', 'last_synced', 'oblast', 'settlement', 'access_mode', 'source',
];

function normText(s) {
  return String(s || '').replace(/ё/g, 'е').toLowerCase();
}

function addressKey(addr) {
  let s = normText(addr);
  s = s.replace(/^(г\.?\s*|пгт\.?\s*|д\.?\s*|дер\.?\s*|деревня\s*|аг\.?\s*|с\.?\s*)?([а-яёё\-\s]+?),\s*/u, '')
    .replace(/^(г\.?\s*|пгт\.?\s*|д\.?\s*|дер\.?\s*|аг\.?\s*|с\.?\s*)\s*[а-яёё]+(?:[-\s][а-яёё]+)*/u, '');
  s = s.replace(/ул\.?\s*/g, 'улица')
    .replace(/пр\s*-?\s*т\.?\s*/g, 'проспект')
    .replace(/пер\.?\s*/g, 'переулок')
    .replace(/\bб-р\b/g, 'бульвар');
  return s.replace(/[^а-яёё0-9]+/g, '');
}

function dedupeKey(settlement, address) {
  return `${normText(settlement)}|${addressKey(address)}`;
}

function toParams(p) {
  return [
    p.name, p.organization, p.type, p.district, p.lat, p.lng, p.address, p.phone, p.website,
    p.hours, p.prices, p.logistics, p.description, p.transit, p.source_key, p.short_address,
    p.accepts, derivePointKinds(p).join(','), p.last_synced, p.oblast, p.settlement, p.access_mode, p.source,
  ];
}

async function insertPoint(p) {
  const r = await run(`
    INSERT INTO recycling_points
      (${COLS.join(', ')})
    VALUES (${COLS.map(() => '?').join(', ')})
  `, ...toParams(p));
  return r.lastInsertRowid;
}

async function updatePoint(p, id) {
  const sets = COLS.map((c) => `${c} = ?`).join(', ');
  await run(`UPDATE recycling_points SET ${sets} WHERE id = ?`, ...toParams(p), id);
}

export function planTarget99(existingRows) {
  const bySource = new Map();
  const byAddr = new Map();
  for (const r of existingRows) {
    if (r.source_key) bySource.set(String(r.source_key).toLowerCase(), r);
    const k = dedupeKey(r.settlement, r.address);
    if (!byAddr.has(k)) byAddr.set(k, r);
  }

  const updates = [];
  const inserts = [];
  let skipped = 0;

  for (const p of TARGET99_POINTS) {
    const srcKey = String(p.source_key).toLowerCase();
    const existing = bySource.get(srcKey);
    if (existing) {
      updates.push({ p, id: existing.id });
      continue;
    }
    const k = dedupeKey(p.settlement, p.address);
    if (byAddr.has(k)) {
      skipped += 1;
      continue;
    }
    inserts.push(p);
    const row = { id: 0, source_key: p.source_key, settlement: p.settlement, address: p.address };
    bySource.set(srcKey, row);
    byAddr.set(k, row);
  }

  return { inserts, updates, skipped };
}

export async function importTarget99() {
  const existingRows = await all(
    'SELECT id, source_key, settlement, address FROM recycling_points'
  );
  const { inserts, updates, skipped } = planTarget99(existingRows);

  let inserted = 0;
  for (const p of inserts) {
    await insertPoint(p);
    inserted += 1;
  }
  let updated = 0;
  for (const { p, id } of updates) {
    await updatePoint(p, id);
    updated += 1;
  }

  console.log(`🌍 Цель 99: добавлено ${inserted}, обновлено ${updated}, дублей пропущено ${skipped}`);
  return { inserted, updated, skipped };
}

export { TARGET99_POINTS };
export default importTarget99;