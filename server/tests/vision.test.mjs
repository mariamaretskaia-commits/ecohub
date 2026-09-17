/**
 * Route-планировщик переработки (vision.js + point-kinds.js).
 * Запуск: node --test tests/vision.test.mjs
 */
process.env.DATABASE_URL = '';

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, all } from '../src/db.js';
import { mapCategoryToKinds, planRecyclingRoute, hasPointForItem } from '../src/vision.js';
import { kindsForItem, derivePointKinds } from '../src/point-kinds.js';

await initDb();

let pointsSnapshot = [];
beforeEach(async () => {
  pointsSnapshot = await all('SELECT * FROM recycling_points');
  await run('DELETE FROM recycling_points');
  await run("DELETE FROM sqlite_sequence WHERE name = 'recycling_points'");
});
afterEach(async () => {
  for (const p of pointsSnapshot) {
    const cols = Object.keys(p);
    const placeholders = cols.map(() => '?').join(', ');
    await run(
      `INSERT OR REPLACE INTO recycling_points (${cols.join(', ')}) VALUES (${placeholders})`,
      ...cols.map((c) => p[c]),
    );
  }
});

test('mapCategoryToKinds: категории → виды приёма', () => {
  assert.deepEqual(mapCategoryToKinds('Одежда'), ['textile']);
  assert.deepEqual(mapCategoryToKinds('Женский гардероб'), ['textile']);
  assert.ok(mapCategoryToKinds('Бытовая техника').includes('electronics'));
  assert.ok(mapCategoryToKinds('Ремонт и стройка').includes('metal'));
  assert.deepEqual(mapCategoryToKinds('Мебель'), ['furniture']);
  assert.deepEqual(mapCategoryToKinds('Другое'), []);
  assert.deepEqual(mapCategoryToKinds('Неизвестно'), []);
});

test('kindsForItem: смешанная категория «Красота и здоровье»', () => {
  assert.deepEqual(kindsForItem('прокладки', 'Красота и здоровье'), ['hygiene']);
  assert.deepEqual(kindsForItem('подгузники Pampers', 'Красота и здоровье'), ['hygiene']);
  assert.deepEqual(kindsForItem('туалетная бумага', 'Красота и здоровье'), ['hygiene']);
  assert.deepEqual(kindsForItem('духи Chanel', 'Красота и здоровье'), ['cosmetics']);
  assert.deepEqual(kindsForItem('помада', 'Красота и здоровье'), ['cosmetics']);
  assert.deepEqual(kindsForItem('жемчужные бусы', 'Красота и здоровье'), ['jewelry']);
  // Без понятного названия — все виды категории (честный поиск по любому из них).
  assert.deepEqual(
    kindsForItem('', 'Красота и здоровье'),
    ['hygiene', 'cosmetics', 'jewelry', 'health'],
  );
});

test('derivePointKinds: официальный текст приёма → виды', () => {
  assert.deepEqual(
    derivePointKinds({ type: 'clothing', accepts: 'одежда, обувь, гуманитарная помощь' }).sort(),
    ['books', 'food', 'household', 'hygiene', 'kids', 'textile', 'toys'],
  );
  assert.deepEqual(
    [...new Set(derivePointKinds({ type: 'paper', accepts: 'макулатура, стекло, ПЭТ-пластик, металлолом' }))].sort(),
    ['glass', 'metal', 'paper', 'plastic'],
  );
  assert.deepEqual(
    derivePointKinds({ type: 'electronics', accepts: 'акб, отработанные автомасла' }).sort(),
    ['electronics', 'hazardous'],
  );
});

test('hasPointForItem: есть пункт под вещь или нет', async () => {
  await run("DELETE FROM recycling_points WHERE name = 'Пункт Прочее'");
  assert.equal(await hasPointForItem('куртка', 'Одежда'), false, 'пока нет одежды – false');
  assert.equal(await hasPointForItem('духи', 'Красота и здоровье'), false, 'косметику не принимают');
  await run(
    `INSERT INTO recycling_points (name, type, lat, lng, address, accepts) VALUES (?, ?, ?, ?, ?, ?)`,
    'Пункт Одежда', 'clothing', 53.9, 23.9, 'ул. Тест 6', null,
  );
  assert.equal(await hasPointForItem('куртка', 'Одежда'), true, 'появился clothing – true');
  assert.equal(await hasPointForItem('духи', 'Красота и здоровье'), false, 'косметика всё ещё нет');
});

async function seedPoints() {
  await run(
    `INSERT INTO recycling_points (name, type, lat, lng, address, accepts) VALUES (?, ?, ?, ?, ?, ?)`,
    'Пункт Одежда', 'clothing', 53.68, 23.83, 'ул. Тест 1', null,
  );
  await run(
    `INSERT INTO recycling_points (name, type, lat, lng, address, accepts) VALUES (?, ?, ?, ?, ?, ?)`,
    'Пункт Техника', 'electronics', 53.69, 23.84, 'ул. Тест 2', null,
  );
  await run(
    `INSERT INTO recycling_points (name, type, lat, lng, address, accepts) VALUES (?, ?, ?, ?, ?, ?)`,
    'Универсальный', 'metal', 53.7, 23.85, 'ул. Тест 3', 'clothing,paper,electronics',
  );
  await run(
    `INSERT INTO recycling_points (name, type, lat, lng, address, accepts) VALUES (?, ?, ?, ?, ?, ?)`,
    'Стекло и металл', 'glass', 53.71, 23.86, 'ул. Тест 4', 'glass,metal',
  );
  await run(
    `INSERT INTO recycling_points (name, type, lat, lng, address, accepts) VALUES (?, ?, ?, ?, ?, ?)`,
    'Приют помощи', 'clothing', 53.72, 23.87, 'ул. Тест 5', 'гуманитарная помощь',
  );
}

test('planRecyclingRoute: одежда+электроника покрываются одним универсальным пунктом', async () => {
  await seedPoints();
  const plan = await planRecyclingRoute([
    { name: 'куртка', category: 'Одежда' },
    { name: 'телевизор', category: 'Бытовая техника' },
  ]);
  assert.ok(plan.routes.length >= 1);
  const union = [...new Set(plan.routes.flatMap((r) => r.categories))];
  assert.deepEqual([...union].sort(), ['Бытовая техника', 'Одежда'].sort());
  assert.deepEqual(plan.uncovered, []);
  const maxCat = plan.routes.reduce((a, r) => (r.categories.length > a ? r.categories.length : a), 0);
  assert.ok(maxCat === 2, 'объединение в один маршрут предпочтительно');
});

test('planRecyclingRoute: 5 категорий → ≤2 маршрута и всё покрыто принимаемыми видами', async () => {
  await seedPoints();
  const cats = ['Одежда', 'Женский гардероб', 'Бытовая техника', 'Ремонт и стройка', 'Всё для дома'];
  const plan = await planRecyclingRoute(cats);
  assert.ok(plan.routes.length <= 2, `маршрутов ≤2, получено ${plan.routes.length}`);
  const covered = plan.routes.flatMap((r) => r.categories);
  assert.deepEqual([...new Set(covered)].sort(), [...cats].sort(), 'все категории покрыты');
  assert.deepEqual(plan.uncovered, []);
  for (const route of plan.routes) {
    const accepted = derivePointKinds(route.point);
    for (const cat of route.categories) {
      const wanted = mapCategoryToKinds(cat);
      assert.ok(wanted.some((k) => accepted.includes(k)), `пункт принимает ${cat}`);
    }
  }
});

test('planRecyclingRoute: при координатах выбирается ближайший пункт', async () => {
  await seedPoints();
  const plan = await planRecyclingRoute(['Одежда'], 53.68, 23.83);
  assert.equal(plan.routes.length, 1);
  assert.equal(plan.routes[0].point.name, 'Пункт Одежда');
  assert.ok(plan.routes[0].distanceKm < 1, 'ближайший пункт в <1 км');
});

test('planRecyclingRoute: гигиена → приют, косметика → пункт не найден', async () => {
  await seedPoints();
  const plan = await planRecyclingRoute([
    { name: 'прокладки', category: 'Красота и здоровье' },
    { name: 'духи', category: 'Красота и здоровье' },
  ]);
  const coveredNames = plan.routes.flatMap((r) => r.items);
  assert.ok(coveredNames.includes('прокладки'), 'прокладки находят благотворительный пункт');
  assert.ok(!coveredNames.includes('духи'), 'духи не попадают в маршрут');
  assert.deepEqual(plan.uncovered, ['Красота и здоровье']);
  assert.equal(plan.routes[0].point.name, 'Приют помощи');
});

test('planRecyclingRoute: отсутствующий вид уходит в uncovered', async () => {
  await seedPoints();
  const plan = await planRecyclingRoute([{ name: 'диван', category: 'Мебель' }]);
  assert.deepEqual(plan.routes, []);
  assert.deepEqual(plan.uncovered, ['Мебель']);
});

test('planRecyclingRoute: пустой список → пустой план', async () => {
  const plan = await planRecyclingRoute([]);
  assert.deepEqual(plan, { routes: [], uncovered: [] });
});
