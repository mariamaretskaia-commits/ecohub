/**
 * Vision: классификация вещей по фото (Zhipu) + планирование маршрута переработки.
 * Запуск: node --test tests/vision.test.mjs
 */
process.env.DATABASE_URL = '';

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, all } from '../src/db.js';
import {
  mapCategoryToPointTypes,
  visionAvailable,
  parseVisionJson,
  classifyWithZhipu,
  planRecyclingRoute,
  _resetVisionForTests,
} from '../src/vision.js';

await initDb();

let pointsSnapshot = [];
beforeEach(async () => {
  _resetVisionForTests();
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

delete process.env.ZHIPU_API_KEY;

const DATA_URL = 'data:image/jpeg;base64,ZmFrZS1pbWFnZQ==';

function zhipuReply(content) {
  return {
    ok: true,
    async json() {
      return { choices: [{ message: { content } }] };
    },
  };
}

function httpReply(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return { error: `http ${status}` };
    },
  };
}

test('parseVisionJson: обычный JSON, fenced, мусор и неверная категория', () => {
  assert.deepEqual(
    parseVisionJson('{"name":"Пальто","category":"Одежда","confidence":0.9}'),
    { name: 'Пальто', category: 'Одежда', confidence: 0.9 },
  );
  const fenced = parseVisionJson('```json\n{"name":"Платье","category":"Одежда","confidence":0.8}\n```');
  assert.equal(fenced.name, 'Платье');
  assert.equal(parseVisionJson('никакого json'), null);
  assert.equal(parseVisionJson('{"name":"X","category":"Несуществующая","confidence":1}'), null);
  assert.equal(parseVisionJson('{"category":"Одежда","confidence":1}'), null);
  assert.equal(parseVisionJson('{broken'), null);
});

test('mapCategoryToPointTypes: категории → типы пунктов', () => {
  assert.deepEqual(mapCategoryToPointTypes('Одежда'), ['clothing']);
  assert.deepEqual(mapCategoryToPointTypes('Книги'), ['paper']);
  assert.deepEqual(mapCategoryToPointTypes('Техника'), ['electronics']);
  assert.deepEqual(mapCategoryToPointTypes('Посуда'), ['glass', 'other']);
  assert.deepEqual(mapCategoryToPointTypes('Мебель'), ['other']);
  assert.equal(visionAvailable(), false, 'без ключа vision выключен');
});

test('classifyWithZhipu: успех и поля ответа', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  const seen = [];
  const result = await classifyWithZhipu(DATA_URL, {
    retries: 0,
    fetchImpl: async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return zhipuReply('{"name":"Тёплое пальто","category":"Одежда","confidence":0.91}');
    },
  });
  assert.deepEqual(result, { name: 'Тёплое пальто', category: 'Одежда', confidence: 0.91 });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.includes('chat/completions'));
  assert.match(seen[0].body.messages[0].content[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(seen[0].body.model, 'glm-4.6v-flash');
});

test('classifyWithZhipu: 429 → ретрай → успех', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  let calls = 0;
  const result = await classifyWithZhipu(DATA_URL, {
    retries: 2,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return httpReply(429);
      return zhipuReply('{"name":"Куртка","category":"Одежда","confidence":0.7}');
    },
  });
  assert.equal(result.name, 'Куртка');
  assert.equal(calls, 2);
});

test('classifyWithZhipu: все 500 → fallback network и cooldown на следующий вызов', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  const fallback = await classifyWithZhipu(DATA_URL, {
    retries: 1,
    fetchImpl: async () => httpReply(500),
  });
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.reason, 'network');
  const cooled = await classifyWithZhipu(DATA_URL, {
    retries: 0,
    fetchImpl: async () => httpReply(500),
  });
  assert.equal(cooled.reason, 'cooldown');
});

test('classifyWithZhipu: backoff не вечный — после reset и после успеха API снова пробуется', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  await classifyWithZhipu(DATA_URL, { retries: 0, fetchImpl: async () => httpReply(500) });
  await classifyWithZhipu(DATA_URL, { retries: 0, fetchImpl: async () => httpReply(500) });
  const blocked = await classifyWithZhipu(DATA_URL, { retries: 0, fetchImpl: async () => httpReply(500) });
  assert.equal(blocked.reason, 'cooldown', 'после серии сбоев вызов блокируется паузой');
  _resetVisionForTests();
  const ok = await classifyWithZhipu(DATA_URL, {
    retries: 0,
    fetchImpl: async () => zhipuReply('{"name":"Куртка","category":"Одежда","confidence":0.7}'),
  });
  assert.equal(ok.name, 'Куртка');
  const again = await classifyWithZhipu(DATA_URL, {
    retries: 0,
    fetchImpl: async () => zhipuReply('{"name":"Шапка","category":"Одежда","confidence":0.6}'),
  });
  assert.equal(again.name, 'Шапка', 'после успеха блокировка сброшена');
});

test('classifyWithZhipu: 403 → fallback auth без ретраев', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  let calls = 0;
  const result = await classifyWithZhipu(DATA_URL, {
    retries: 2,
    fetchImpl: async () => {
      calls += 1;
      return httpReply(403);
    },
  });
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'auth');
  assert.equal(calls, 1);
});

test('classifyWithZhipu: 429 с Retry-After → ожидание → успех', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  let calls = 0;
  const result = await classifyWithZhipu(DATA_URL, {
    retries: 2,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (h) => (h === 'retry-after' ? '1' : null) },
          async json() {
            return { error: 'overload' };
          },
        };
      }
      return zhipuReply('{"name":"Кроссовки","category":"Обувь","confidence":0.8}');
    },
  });
  assert.equal(result.name, 'Кроссовки');
  assert.equal(calls, 2);
});

test('classifyWithZhipu: таймаут → fallback', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  const result = await classifyWithZhipu(DATA_URL, {
    retries: 0,
    timeoutMs: 40,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.equal(result.fallback, true);
});

test('classifyWithZhipu: плохой JSON → fallback parse', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  const result = await classifyWithZhipu(DATA_URL, {
    retries: 0,
    fetchImpl: async () => zhipuReply('извините, не понимаю'),
  });
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'parse');
});

test('classifyWithZhipu: без ключа → fallback config (API не вызывается)', async () => {
  delete process.env.ZHIPU_API_KEY;
  let called = false;
  const result = await classifyWithZhipu(DATA_URL, {
    fetchImpl: async () => {
      called = true;
      return zhipuReply('{}');
    },
  });
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'config');
  assert.equal(called, false);
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