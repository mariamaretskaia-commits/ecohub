/**
 * Правила «что нельзя сдавать в обычную переработку» и сужение видов по названию.
 * Запуск: node --test tests/recycling-rules.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recyclingRuleFor } from '../src/recycling-rules.js';
import { kindsForItem } from '../src/point-kinds.js';

function assertBlocked(name, category) {
  const rule = recyclingRuleFor(name, category);
  assert.equal(rule?.blocked, true, `«${name}» должна блокироваться`);
  assert.ok(rule.reason, `у «${name}» должна быть причина`);
  assert.ok(rule.advice, `у «${name}» должен быть совет`);
}

test('recycling-rule: чеки, салфетки и загрязнённая бумага', () => {
  for (const name of [
    'чеки автобусные',
    'чек из магазина',
    'квитанция ЖКХ',
    'салфетки',
    'бумажное полотенце',
    'туалетная бумага',
    'обои',
    'самоклеющаяся плёнка',
    'фотобумага',
    'калька',
    'ламинированная бумага',
    'вощёная бумага',
    'одноразовая посуда',
    'бумажный стаканчик',
    'коробка от пиццы',
    'Tetra Pak',
  ]) {
    assertBlocked(name, 'Всё для дома');
  }
});

test('recycling-rule: стекло, которое не стеклотара', () => {
  for (const name of [
    'зеркало',
    'хрустальная ваза',
    'керамическая кружка',
    'фарфоровая тарелка',
    'оконное стекло',
    'строительное стекло',
    'стеклопакет',
    'стеклопластик',
    'стекловата',
    'стеклянная тарелка',
    'стеклянная дверь',
  ]) {
    assertBlocked(name, 'Ремонт и стройка');
  }
});

test('recycling-rule: проблемный пластик и упаковка', () => {
  for (const name of [
    'одноразовые стаканчики',
    'стаканчик от йогурта',
    'блистер от таблеток',
    'ПВХ',
    'полистирол',
    'пенопласт',
    'многослойная упаковка',
    'упаковка с остатками еды',
    'бутылка от масла',
    'канистра от химии',
  ]) {
    assertBlocked(name, 'Всё для дома');
  }
});

test('recycling-rule: крупный металл и опасные предметы', () => {
  for (const name of [
    'газовый баллон',
    'огнетушитель',
    'рельсы',
    'люк',
    'ограда',
    'памятник',
    'бесхозный лом',
  ]) {
    assertBlocked(name, 'Ремонт и стройка');
  }
});

test('recycling-rule: игрушки и одежда', () => {
  for (const name of [
    'мягкая игрушка',
    'плюшевый мишка',
    'кукла',
    'электронная игрушка',
    'радиоуправляемая машинка',
    'носки',
    'нижнее белье',
    'изношенная обувь',
    'грязная куртка',
    'мокрое пальто',
    'рваные джинсы',
  ]) {
    assertBlocked(name, 'Одежда');
  }
});

test('recycling-rule: спецотходы', () => {
  for (const name of [
    'ртутный градусник',
    'градусник',
    'лекарства',
    'просроченные таблетки',
    'краска',
    'растворитель',
    'аэрозоль',
    'пестициды',
    'энергосберегающая лампа',
    'люминесцентная лампа',
    'лампа накаливания',
    'шины',
    'автошина',
    'покрышка',
    'автомасло',
    'моторное масло',
    'отработанное масло',
  ]) {
    assertBlocked(name, 'Авто и запчасти');
  }
});

test('recycling-rule: батарейки идут только в hazardous', () => {
  for (const name of ['батарейки', 'аккумулятор', 'АКБ', 'элемент питания']) {
    const rule = recyclingRuleFor(name, 'Электроника');
    assert.equal(rule?.blocked, undefined, `«${name}» не блокируется`);
    assert.deepEqual(rule?.kinds, ['hazardous']);
  }
});

test('recycling-rule: нормальные вещи не блокируются', () => {
  for (const [name, category] of [
    ['картонная коробка', 'Всё для дома'],
    ['книга', 'Хобби, спорт и туризм'],
    ['журнал', 'Всё для дома'],
    ['газета', 'Хобби, спорт и туризм'],
    ['стеклянная бутылка', 'Всё для дома'],
    ['стеклянная банка', 'Всё для дома'],
    ['стеклотара', 'Всё для дома'],
    ['пластиковая бутылка', 'Всё для дома'],
    ['полиэтиленовый пакет', 'Всё для дома'],
    ['жестяная банка', 'Всё для дома'],
    ['консервная банка', 'Всё для дома'],
    ['металлолом', 'Ремонт и стройка'],
    ['кастрюля', 'Всё для дома'],
    ['чистая куртка', 'Одежда'],
    ['вафельное полотенце', 'Всё для дома'],
    ['пластиковый конструктор', 'Всё для детей и мам'],
    ['настольная игра', 'Всё для детей и мам'],
    ['настольная лампа', 'Всё для дома'],
    ['светодиодная лампа', 'Всё для дома'],
    ['пищевое масло', 'Другое'],
    ['шинель', 'Одежда'],
    ['зеркальный шкаф', 'Мебель'],
    ['чехол', 'Авто и запчасти'],
    ['обычная тарелка', 'Всё для дома'],
  ]) {
    assert.equal(
      recyclingRuleFor(name, category)?.blocked,
      undefined,
      `«${name}» не должна блокироваться`,
    );
  }
});

test('kindsForItem: широкие категории сужаются по названию', () => {
  assert.deepEqual(kindsForItem('кастрюля', 'Всё для дома').sort(), ['household', 'metal']);
  assert.deepEqual(kindsForItem('книга', 'Всё для дома').sort(), ['books', 'paper']);
  assert.deepEqual(kindsForItem('газета', 'Хобби, спорт и туризм').sort(), ['books', 'paper']);
  assert.deepEqual(kindsForItem('стеклянная бутылка', 'Всё для дома'), ['glass']);
  assert.deepEqual(kindsForItem('пластиковая бутылка', 'Всё для дома'), ['plastic']);
  assert.deepEqual(kindsForItem('полиэтиленовый пакет', 'Всё для дома'), ['plastic']);
  assert.deepEqual(kindsForItem('жестяная банка', 'Всё для дома'), ['metal']);
  assert.deepEqual(kindsForItem('консервная банка', 'Всё для дома'), ['metal']);
  assert.deepEqual(kindsForItem('лампа настольная', 'Всё для дома'), ['electronics']);
});

test('kindsForItem: заблокированные вещи не получают виды', () => {
  assert.deepEqual(kindsForItem('чеки автобусные', 'Авто и запчасти'), []);
  assert.deepEqual(kindsForItem('салфетки', 'Всё для дома'), []);
  assert.deepEqual(kindsForItem('зеркало', 'Всё для дома'), []);
  assert.deepEqual(kindsForItem('стеклянная тарелка', 'Всё для дома'), []);
  assert.deepEqual(kindsForItem('мягкая игрушка', 'Всё для детей и мам'), []);
  assert.deepEqual(kindsForItem('носки', 'Одежда'), []);
  assert.deepEqual(kindsForItem('грязная куртка', 'Одежда'), []);
  assert.deepEqual(kindsForItem('лампа накаливания', 'Всё для дома'), []);
  assert.deepEqual(kindsForItem('шины', 'Авто и запчасти'), []);
});

test('kindsForItem: батарейки не смешиваются с электроникой', () => {
  assert.deepEqual(kindsForItem('батарейки', 'Электроника'), ['hazardous']);
  assert.deepEqual(kindsForItem('аккумулятор', 'Авто и запчасти'), ['hazardous']);
});

test('kindsForItem: без материала остаётся широкий поиск', () => {
  assert.deepEqual(
    kindsForItem('чехол', 'Авто и запчасти').sort(),
    ['auto', 'hazardous', 'metal'],
  );
  assert.deepEqual(kindsForItem('тканевое полотенце', 'Всё для дома'), ['textile']);
  assert.deepEqual(kindsForItem('обычная тарелка', 'Всё для дома'), ['household']);
});
