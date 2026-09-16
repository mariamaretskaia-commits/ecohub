import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = ''; // изолированная in-memory SQLite
delete process.env.ZHIPU_API_KEY; // не ходим в реальный ИИ

const { run, all } = await import('../src/db.js');
const { addStems, refreshGeneratedRules } = await import('../src/catrules.js');
const { growStems, deriveStems } = await import('../src/catgrow.js');
const { categorizeByRules } = await import('../src/categorize.js');

test('categorizeByRules: стем, добавленный через addStems, начинает работать', async () => {
  await refreshGeneratedRules();
  assert.equal(categorizeByRules('шишки сосновые'), 'Другое');
  const added = await addStems('Сад и огород', ['шишк']);
  assert.equal(added, 1);
  assert.equal(categorizeByRules('шишки сосновые'), 'Сад и огород');
  assert.equal(categorizeByRules('шишка'), 'Сад и огород');
  const rows = await all('SELECT stem FROM categorization_stems WHERE category = ?', 'Сад и огород');
  assert.ok(rows.some((r) => r.stem === 'шишк'));
  // повторное добавление — без дублей
  assert.equal(await addStems('Сад и огород', ['шишк']), 0);
});

test('addStems: отсекает мусор (короткие стемы, пробелы)', async () => {
  const added = await addStems('Мебель', ['ок', '  ', 'шкаф']);
  assert.equal(added, 1);
  assert.equal(categorizeByRules('шкафчик'), 'Мебель');
});

test('deriveStems: парсит JSON-массив стемов от ИИ', async () => {
  const stems = await deriveStems('Электроника', ['кассеты', 'наушники'], {
    apiKey: 'test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '["кассет","наушник"]' } }] };
      },
    }),
  });
  assert.deepEqual(stems, ['кассет', 'наушник']);
});

test('growStems: из новых логов пополняет словарь и ставит маркер', async () => {
  await run(
    "INSERT INTO categorization_log (name, category, provider) VALUES ('флюгегехаймен', 'Хобби, спорт и туризм', 'ai')",
  );
  const res = await growStems({
    apiKey: 'test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '["флюгегехайм"]' } }] };
      },
    }),
  });
  assert.equal(res.skipped, undefined);
  assert.ok(res.processed >= 1);
  assert.ok(res.added >= 1);
  assert.equal(categorizeByRules('флюгегехаймен редкий'), 'Хобби, спорт и туризм');
  const marker = await all("SELECT value FROM meta WHERE key = 'stems_last_log_id'");
  assert.ok(Number(marker[0].value) >= 1);
});

test('growStems: без ключа — пропускает', async () => {
  const res = await growStems({ apiKey: '' });
  assert.equal(res.skipped, 'no_key');
});
