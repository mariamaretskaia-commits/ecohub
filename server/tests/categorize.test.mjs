/**
 * Категоризация вещей по названию (categorize.js).
 * Запуск: node --test tests/categorize.test.mjs
 */
process.env.DATABASE_URL = '';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeByRules, categorizeItems } from '../src/categorize.js';
import { RECYCLING_CATEGORIES } from '../src/moderation.js';

test('categorizeByRules: типичные вещи по словарю', () => {
  assert.equal(categorizeByRules('Куртка зимняя'), 'Одежда');
  assert.equal(categorizeByRules('Кроссовки 42 размера'), 'Одежда');
  assert.equal(categorizeByRules('Детский велосипед'), 'Всё для детей и мам');
  assert.equal(categorizeByRules('Стол обеденный'), 'Мебель');
  assert.equal(categorizeByRules('Пылесос'), 'Бытовая техника');
  assert.equal(categorizeByRules('Смартфон'), 'Телефоны и планшеты');
  assert.equal(categorizeByRules('Набор тарелок'), 'Всё для дома');
  assert.equal(categorizeByRules('Сказки для детей'), 'Хобби, спорт и туризм');
  assert.equal(categorizeByRules('Коврик для йоги'), 'Хобби, спорт и туризм');
  assert.equal(categorizeByRules('Шуруповёрт'), 'Ремонт и стройка');
  assert.equal(categorizeByRules('Горшок с цветком'), 'Сад и огород');
  assert.equal(categorizeByRules('Корм для кота'), 'Для животных');
});

test('categorizeByRules: пример живой ленты — носки/пальто/радио', () => {
  assert.equal(categorizeByRules('3 пары носков'), 'Одежда');
  assert.equal(categorizeByRules('тёплое пальто'), 'Одежда');
  assert.equal(categorizeByRules('радио'), 'Электроника');
  assert.equal(categorizeByRules('Микроволновка'), 'Бытовая техника');
  assert.equal(categorizeByRules('шарф'), 'Одежда');
});

test('categorizeByRules: составные словосочетания не сваливаются в «Авто»', () => {
  assert.equal(categorizeByRules('стиральная машина'), 'Бытовая техника');
  assert.equal(categorizeByRules('посудомоечная машина'), 'Бытовая техника');
  assert.equal(categorizeByRules('швейная машинка'), 'Всё для дома');
  assert.equal(categorizeByRules('кухонный гарнитур'), 'Всё для дома');
  assert.equal(categorizeByRules('машина'), 'Авто и запчасти');
});

test('categorizeByRules: незнакомое слово → Другое', () => {
  assert.equal(categorizeByRules('Причудливая штуковина'), 'Другое');
  assert.equal(categorizeByRules(''), 'Другое');
});

test('categorizeItems: без ключа работает офлайн-словарь (provider rules)', async () => {
  delete process.env.ZHIPU_API_KEY;
  const res = await categorizeItems(['Куртка', 'Стол'], { categories: RECYCLING_CATEGORIES });
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
    categories: RECYCLING_CATEGORIES,
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
    categories: RECYCLING_CATEGORIES,
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

test('categorizeItems: лимит 30 вещей', async () => {
  const names = Array.from({ length: 50 }, (_, i) => `Вещь ${i + 1}`);
  const res = await categorizeItems(names, { categories: RECYCLING_CATEGORIES });
  assert.equal(res.items.length, 30);
});