/**
 * Smoke-тест HTTP-контракта «Разобрать вещи»: categorize / categorize-fix / route
 * должны возвращать blocked и recyclingNote, а заблокированные вещи не должны
 * получать маршрут.
 *
 * Запуск: node --test tests/vision-api.test.mjs
 */
process.env.DATABASE_URL = '';
delete process.env.ZHIPU_API_KEY;

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, all } from '../src/db.js';
import { registerVisionRoutes } from '../src/routes.js';

await initDb();

const handlers = new Map();
const app = {
  post(path, ...stack) {
    handlers.set(path, stack[stack.length - 1]);
  },
};
const passAuth = (req, res, next) => next();
registerVisionRoutes(app, passAuth, null);

function call(path, body = {}) {
  const handler = handlers.get(path);
  assert.ok(handler, `нет обработчика ${path}`);
  const req = {
    body,
    telegramUser: { id: 'vision-api-smoke', first_name: 'Test' },
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        this.payload = value;
        resolve({ status: this.statusCode, body: value });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

let pointsSnapshot = [];
beforeEach(async () => {
  pointsSnapshot = await all('SELECT * FROM recycling_points');
  await run('DELETE FROM recycling_points');
  await run("DELETE FROM sqlite_sequence WHERE name = 'recycling_points'");
  await run(
    `INSERT INTO recycling_points (name, type, lat, lng, address, accepts)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'Пункт Батарейки', 'hazardous', 53.73, 23.88, 'ул. Тест 7', 'батарейки',
  );
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

test('categorize: блокировка и причина для салфеток', async () => {
  const { status, body } = await call('/api/vision/categorize', {
    names: ['салфетки'],
  });
  assert.equal(status, 200);
  assert.equal(body.items.length, 1);
  const item = body.items[0];
  assert.equal(item.name, 'салфетки');
  assert.equal(item.blocked, true);
  assert.equal(item.pointFound, false);
  assert.match(item.recyclingNote, /не перерабатываются/);
  assert.ok(item.recyclingNote.includes('общий мусор'));
});

test('categorize: батарейки не блокируются и находят пункт', async () => {
  const { status, body } = await call('/api/vision/categorize', {
    names: ['батарейки'],
  });
  assert.equal(status, 200);
  const item = body.items[0];
  assert.equal(item.blocked, false);
  assert.equal(item.pointFound, true);
  assert.equal(item.recyclingNote, null);
});

test('categorize-fix: смена категории пересчитывает блокировку', async () => {
  const { status, body } = await call('/api/vision/categorize-fix', {
    name: 'чеки автобусные',
    category: 'Авто и запчасти',
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.blocked, true);
  assert.equal(body.pointFound, false);
  assert.match(body.recyclingNote, /термобумага/);
});

test('route: блокированные вещи отдельно, остальные — в uncoveredItems', async () => {
  const { status, body } = await call('/api/vision/route', {
    items: [
      { name: 'чеки автобусные', category: 'Авто и запчасти' },
      { name: 'диван', category: 'Мебель' },
    ],
  });
  assert.equal(status, 200);
  assert.deepEqual(body.blocked.map((b) => b.name), ['чеки автобусные']);
  assert.match(body.blocked[0].reason, /термобумага/);
  assert.deepEqual(body.routes, []);
  assert.deepEqual(body.uncoveredItems, [{ name: 'диван', category: 'Мебель' }]);
});
