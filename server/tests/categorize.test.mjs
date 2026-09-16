/**
 * Категоризация вещей по названию (categorize.js).
 * Запуск: node --test tests/categorize.test.mjs
 */
process.env.DATABASE_URL = '';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeByRules, categorizeItems } from '../src/categorize.js';

test('categorizeByRules: типичные вещи по словарю', () => {
  assert.equal(categorizeByRules('Куртка зимняя'), 'Одежда');
  assert.equal(categorizeByRules('Кроссовки 42 размера'), 'Обувь');
  assert.equal(categorizeByRules('Детский велосипед'), 'Детям');
  assert.equal(categorizeByRules('Стол обеденный'), 'Мебель');
  assert.equal(categorizeByRules('Пылесос'), 'Техника');
  assert.equal(categorizeByRules('Смартфон'), 'Электроника');
  assert.equal(categorizeByRules('Набор тарелок'), 'Посуда');
  assert.equal(categorizeByRules('Сказки для детей'), 'Книги');
  assert.equal(categorizeByRules('Коврик для йоги'), 'Спорт');
  assert.equal(categorizeByRules('Шуруповёрт'), 'Инструменты');
  assert.equal(categorizeByRules('Горшок с цветком'), 'Растения');
  assert.equal(categorizeByRules('Корм для кота'), 'Животным');
});

test('categorizeByRules: незнакомое слово → Другое', () => {
  assert.equal(categorizeByRules('Причудливая штуковина'), 'Другое');
  assert.equal(categorizeByRules(''), 'Другое');
});

test('categorizeItems: без ключа работает офлайн-словарь (provider rules)', async () => {
  delete process.env.ZHIPU_API_KEY;
  const res = await categorizeItems(['Куртка', 'Стол']);
  assert.equal(res.provider, 'rules');
  assert.deepEqual(res.items, [
    { name: 'Куртка', category: 'Одежда' },
    { name: 'Стол', category: 'Мебель' },
  ]);
});

test('categorizeItems: пустой список → пустой результат', async () => {
  const res = await categorizeItems([]);
  assert.deepEqual(res, { items: [], provider: 'rules' });
});

test('categorizeItems: с фейковым ключом и fetchImpl ИИ-ответ перекрывает словарь', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  const res = await categorizeItems(['Куртка', 'Какая-то вещь'], {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { content: '{"Куртка":"Одежда","Какая-то вещь":"Электроника"}' } }],
        };
      },
    }),
  });
  assert.equal(res.provider, 'ai');
  assert.deepEqual(res.items, [
    { name: 'Куртка', category: 'Одежда' },
    { name: 'Какая-то вещь', category: 'Электроника' },
  ]);
});

test('categorizeItems: битый JSON от ИИ → фолбэк на словарь', async () => {
  process.env.ZHIPU_API_KEY = 'test-key';
  const res = await categorizeItems(['Куртка'], {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: 'извините' } }] };
      },
    }),
  });
  assert.equal(res.provider, 'rules');
  assert.equal(res.items[0].category, 'Одежда');
});