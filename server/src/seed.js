import { get, all, run, exec, isPostgres } from './db.js';
import { POINTS, DATA_VERSION } from './points-data.js';
import { derivePointKinds } from './point-kinds.js';
import { importTarget99 } from './import-target99.js';
import { importCharity } from './import-charity.js';
import { grodnoArea } from './grodno-areas.js';
import { cleanPointField } from './points-text.js';

const POINT_TEXT_FIELDS = [
  'name', 'organization', 'address', 'phone', 'website', 'hours', 'prices',
  'logistics', 'description', 'transit', 'short_address', 'accepts',
];

function cleanPoint(p) {
  const out = { ...p };
  for (const field of POINT_TEXT_FIELDS) {
    out[field] = cleanPointField(field, p[field]);
  }
  return out;
}

const COLS = [
  'name', 'organization', 'type', 'district', 'lat', 'lng', 'address', 'phone', 'website',
  'hours', 'prices', 'logistics', 'description', 'transit', 'source_key', 'short_address',
  'accepts', 'last_synced', 'oblast', 'settlement', 'access_mode', 'source',
];

const DEMO_ITEMS = [
  { title: 'Детский конструктор LEGO', description: 'Большой набор, все детали на месте.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Центр', category: 'Всё для детей и мам', type: 'free', first_name: 'Анна', username: 'anna_grodno' },
  { title: 'Перфоратор Bosch', description: 'Рабочий, в хорошем состоянии.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Ольшанка', category: 'Ремонт и стройка', type: 'free', first_name: 'Дмитрий', username: 'dim_tools' },
  { title: 'Книги по программированию', description: '5 книг: Python, JavaScript, алгоритмы.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Девятовка', category: 'Хобби, спорт и туризм', type: 'free', first_name: 'Максим', username: 'max_dev' },
  { title: 'Детская коляска', description: 'Трёхколёсная, б/у, хорошее состояние.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Вишневец', category: 'Всё для детей и мам', type: 'free', first_name: 'Елена', username: 'elena_m' },
  { title: 'Палатка 4-местная', description: 'Для походов, комплект полный.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Грандичи', category: 'Хобби, спорт и туризм', type: 'free', first_name: 'Игорь', username: 'igor_camp' },
  { title: 'Посуда керамическая', description: 'Набор тарелок и чашек, 12 шт.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Фолюш', category: 'Всё для дома', type: 'free', first_name: 'Ольга', username: 'olga_home' },
];

async function seedPoints() {
  if (!isPostgres()) {
    await exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  }

  const version = await get("SELECT value FROM meta WHERE key = 'points_version'");
  if (version && Number(version.value) >= DATA_VERSION) return;

  const existing = await all('SELECT id, source_key FROM recycling_points');
  const bySource = new Map(
    existing.filter((r) => r.source_key).map((r) => [String(r.source_key).toLowerCase(), r.id])
  );

  let inserted = 0;
  for (const raw of POINTS) {
    const p = cleanPoint(raw);
    const fallbackKey = String(p.organization || '').toLowerCase() + '|' + String(p.address || '').toLowerCase();
    const key = String(p.source_key || fallbackKey).toLowerCase();
    const acceptKinds = derivePointKinds(p).join(',');
    const id = bySource.get(key);
    if (id) {
      await run(`
        UPDATE recycling_points SET
          name = ?, organization = ?, type = ?, district = ?, lat = ?, lng = ?, address = ?,
          phone = ?, website = ?, hours = ?, prices = ?, logistics = ?, description = ?,
          transit = ?, short_address = ?, accepts = ?, accept_kinds = ?, last_synced = ?, oblast = ?,
          settlement = ?, access_mode = ?, source = ?
        WHERE id = ?
      `,
      p.name, p.organization, p.type, p.district, p.lat, p.lng, p.address, p.phone, p.website,
      p.hours, p.prices, p.logistics, p.description, p.transit, p.short_address, p.accepts,
      acceptKinds, p.last_synced, p.oblast, p.settlement, p.access_mode, p.source || '', id);
    } else {
      const r = await run(`
        INSERT INTO recycling_points
          (${COLS.join(', ')}, accept_kinds)
        VALUES (${COLS.map(() => '?').join(', ')}, ?)
      `,
      p.name, p.organization, p.type, p.district, p.lat, p.lng, p.address, p.phone, p.website,
      p.hours, p.prices, p.logistics, p.description, p.transit, p.source_key, p.short_address,
      p.accepts, p.last_synced, p.oblast, p.settlement, p.access_mode, p.source || '', acceptKinds);
      inserted += 1;
      bySource.set(key, r.lastInsertRowid);
    }
  }

  await run("INSERT OR REPLACE INTO meta (key, value) VALUES ('points_version', ?)", String(DATA_VERSION));
  console.log(`✅ Пункты на карте: ${POINTS.length} в датасете, добавлено новых ${inserted} (v${DATA_VERSION})`);
}

async function seedDemoItems() {
  const itemCount = await get('SELECT COUNT(*) as c FROM items');
  if (Number(itemCount?.c || 0) > 0) return;

  for (const item of DEMO_ITEMS) {
    let user = await get('SELECT id FROM users WHERE username = ?', item.username);
    if (!user) {
      const r = await run(`
        INSERT INTO users (telegram_id, username, first_name, eco_coins)
        VALUES (?, ?, ?, 80)
      `, `demo_${item.username}`, item.username, item.first_name);
      user = { id: r.lastInsertRowid };
    }
    await run(`
      INSERT INTO items (user_id, title, description, oblast, settlement, district, category, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, user.id, item.title, item.description, item.oblast, item.settlement, item.district, item.category, item.type);
  }
  console.log(`✅ Добавлено ${DEMO_ITEMS.length} демо-объявлений`);
}

export async function runSeed() {
  await seedPoints();
  await importTarget99();
  await importCharity();
  await seedDemoItems();

  await run(`
    UPDATE items
    SET oblast = COALESCE(NULLIF(oblast, ''), 'Гродненская область'),
        settlement = COALESCE(NULLIF(settlement, ''), 'Гродно')
    WHERE oblast IS NULL OR settlement IS NULL OR oblast = '' OR settlement = ''
  `);

  await assignGrodnoMicrodistricts();

  try {
    await run(`
      UPDATE eco_transactions
      SET description = REPLACE(description, 'Чысты След', 'EcoHub')
      WHERE description LIKE '%Чысты След%'
    `);
    await run(`
      UPDATE eco_transactions
      SET description = REPLACE(description, 'КРУГАВОРТ', 'EcoHub')
      WHERE description LIKE '%КРУГАВОРТ%'
    `);
  } catch {
    /* table may be empty */
  }
}

async function assignGrodnoMicrodistricts() {
  const grodno = await all(
    "SELECT id, lat, lng FROM recycling_points WHERE settlement = 'Гродно' AND lat IS NOT NULL AND lng IS NOT NULL AND (district IS NULL OR district = '')",
  );
  let updated = 0;
  for (const r of grodno) {
    const area = grodnoArea(r.lat, r.lng);
    if (area) {
      await run('UPDATE recycling_points SET district = ? WHERE id = ?', area, r.id);
      updated += 1;
    }
  }
  if (updated) console.log(`🏙 Гродно: ${grodno.length} точек распределено по микрорайонам`);
}
