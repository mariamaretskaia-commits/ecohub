/**
 * Route-планировщик переработки (vision.js).
 * Запуск: node --test tests/vision.test.mjs
 */
process.env.DATABASE_URL = '';

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, all } from '../src/db.js';
import { mapCategoryToPointTypes, planRecyclingRoute } from '../src/vision.js';

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

test('mapCategoryToPointTypes: категории → типы пунктов', () => {
  assert.deepEqual(mapCategoryToPointTypes('Одежда'), ['clothing']);
  assert.deepEqual(mapCategoryToPointTypes('Книги'), ['paper']);
  assert.deepEqual(mapCategoryToPointTypes('Техника'), ['electronics']);
  assert.deepEqual(mapCategoryToPointTypes('Посуда'), ['glass', 'other']);
  assert.deepEqual(mapCategoryToPointTypes('Мебель'), ['other']);
  assert.deepEqual(mapCategoryToPointTypes('Неизвестно'), ['other']);
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
}

test('planRecyclingRoute: одежда+техника покрываются одним универсальным пунктом', async () => {
  await seedPoints();
  const plan = await planRecyclingRoute(['Одежда', 'Техника']);
  assert.ok(plan.routes.length >= 1);
  const union = [...new Set(plan.routes.flatMap((r) => r.categories))];
  assert.deepEqual([...union].sort(), ['Одежда', 'Техника']);
  assert.deepEqual(plan.uncovered, []);
  const maxCat = plan.routes.reduce((a, r) => (r.categories.length > a ? r.categories.length : a), 0);
  assert.ok(maxCat === 2, 'объединение в один маршрут предпочтительно');
});

test('planRecyclingRoute: 5 категорий → ≤2 маршрута, всё покрыто, только принимаемые типы', async () => {
  await seedPoints();
  const cats = ['Одежда', 'Книги', 'Техника', 'Инструменты', 'Посуда'];
  const plan = await planRecyclingRoute(cats);
  assert.ok(plan.routes.length <= 2, `маршрутов ≤2, получено ${plan.routes.length}`);
  const covered = plan.routes.flatMap((r) => r.categories);
  assert.deepEqual([...new Set(covered)].sort(), [...cats].sort(), 'все категории покрыты');
  assert.deepEqual(plan.uncovered, []);
  for (const route of plan.routes) {
    const accepted = new Set(
      `${String(route.point.accepts || '')},${String(route.point.type || '')}`.split(','),
    );
    for (const cat of route.categories) {
      const ok = mapCategoryToPointTypes(cat).some((t) => accepted.has(t));
      assert.ok(ok, `маршрут принимает ${cat}`);
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

test('planRecyclingRoute: отсутствующий тип пункта уходит в uncovered', async () => {
  await seedPoints();
  const plan = await planRecyclingRoute(['Растения']);
  assert.deepEqual(plan.routes, []);
  assert.deepEqual(plan.uncovered, ['Растения']);
});

test('planRecyclingRoute: пустой список → пустой план', async () => {
  const plan = await planRecyclingRoute([]);
  assert.deepEqual(plan, { routes: [], uncovered: [] });
});