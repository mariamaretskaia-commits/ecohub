import { get, all, run, exec, isPostgres } from './db.js';
import { POINTS, DATA_VERSION } from './points-data.js';

const DEMO_ITEMS = [
  { title: 'Детский конструктор LEGO', description: 'Большой набор, все детали на месте.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Ленинский', category: 'Игрушки', type: 'free', first_name: 'Анна', username: 'anna_grodno' },
  { title: 'Перфоратор Bosch', description: 'Рабочий, в хорошем состоянии.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Ленинский', category: 'Инструменты', type: 'free', first_name: 'Дмитрий', username: 'dim_tools' },
  { title: 'Книги по программированию', description: '5 книг: Python, JavaScript, алгоритмы.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Октябрьский', category: 'Книги', type: 'free', first_name: 'Максим', username: 'max_dev' },
  { title: 'Детская коляска', description: 'Трёхколёсная, б/у, хорошее состояние.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Октябрьский', category: 'Другое', type: 'free', first_name: 'Елена', username: 'elena_m' },
  { title: 'Палатка 4-местная', description: 'Для походов, комплект полный.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Ленинский', category: 'Спорт', type: 'free', first_name: 'Игорь', username: 'igor_camp' },
  { title: 'Посуда керамическая', description: 'Набор тарелок и чашек, 12 шт.', oblast: 'Гродненская область', settlement: 'Гродно', district: 'Ленинский', category: 'Посуда', type: 'free', first_name: 'Ольга', username: 'olga_home' },
];

async function seedPoints() {
  if (!isPostgres()) {
    await exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  }

  const version = await get("SELECT value FROM meta WHERE key = 'points_version'");
  if (version && Number(version.value) >= DATA_VERSION) return;

  await exec('DELETE FROM recycling_submissions');
  await exec('DELETE FROM recycling_points');

  for (const p of POINTS) {
    await run(`
      INSERT INTO recycling_points
        (name, organization, type, district, lat, lng, address, phone, website, hours, prices, logistics, description, transit, source_key, short_address, accepts, last_synced, oblast, settlement, access_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    p.name, p.organization, p.type, p.district, p.lat, p.lng, p.address, p.phone, p.website,
    p.hours, p.prices, p.logistics, p.description, p.transit, p.source_key, p.short_address,
    p.accepts, p.last_synced, p.oblast, p.settlement, p.access_mode);
  }

  await run("INSERT OR REPLACE INTO meta (key, value) VALUES ('points_version', ?)", String(DATA_VERSION));
  console.log(`✅ Загружено ${POINTS.length} пунктов на карту (v${DATA_VERSION})`);
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
  await seedDemoItems();

  await run(`
    UPDATE items
    SET oblast = COALESCE(NULLIF(oblast, ''), 'Гродненская область'),
        settlement = COALESCE(NULLIF(settlement, ''), 'Гродно')
    WHERE oblast IS NULL OR settlement IS NULL OR oblast = '' OR settlement = ''
  `);

  await run(`
    UPDATE items SET district = 'Ленинский'
    WHERE settlement = 'Гродно' AND district IN (
      'Центр', 'Старый город', 'Девятовка', 'Переселка', 'Форты', 'Антоново',
      'Грандичи', 'Зарица', 'Зарница', 'Белые Росы'
    )
  `);
  await run(`
    UPDATE items SET district = 'Октябрьский'
    WHERE settlement = 'Гродно' AND district IN (
      'Вишневец', 'Ольшанка', 'Фолюш', 'Барановичи', 'Понемунь', 'Южный',
      'Принеманский', 'Победа', 'Колбасино', 'Лососно'
    )
  `);

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
