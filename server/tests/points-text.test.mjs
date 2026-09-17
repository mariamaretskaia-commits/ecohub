/**
 * Очистка текстов пунктов приёма (points-text.js).
 * Запуск: node --test tests/points-text.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  stripTags,
  cleanPointText,
  isSpammyDescription,
  cleanPointField,
} from '../src/points-text.js';

test('decodeEntities: именованные и числовые сущности', () => {
  assert.equal(decodeEntities('а&nbsp;б'), 'а б');
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&#1055;&#1088;'), 'Пр');
  assert.equal(decodeEntities('&#x41;'), 'A');
  assert.equal(decodeEntities('без сущностей'), 'без сущностей');
});

test('stripTags: обычные и битые теги', () => {
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(squash(stripTags('<strong>Заславль</strong> Березовая')), 'Заславль Березовая');
  assert.equal(squash(stripTags('‹strong>беларуси, общественная</strong>')), 'беларуси, общественная');
  assert.equal(stripTags('без тегов'), 'без тегов');
});

test('cleanPointText: теги, &nbsp; и обрывки ... удаляются', () => {
  const raw = 'белорусские общественные <strong>организации,</strong> клуб &nbsp;&nbsp; любителей ... <strong>Общества</strong> и союзы';
  const out = cleanPointText(raw);
  assert.ok(!out.includes('<'), out);
  assert.ok(!out.includes('&nbsp;'), out);
  assert.ok(!out.includes('...'), out);
  assert.ok(!/\s{2,}/.test(out), out);
  assert.ok(out.includes('организации'), out);
});

test('cleanPointText: пустой/битый ввод', () => {
  assert.equal(cleanPointText(null), '');
  assert.equal(cleanPointText(undefined), '');
  assert.equal(cleanPointText('   '), '');
  assert.equal(cleanPointText('<strong>&nbsp;</strong>'), '');
});

test('isSpammyDescription: скрап-спам распознаётся', () => {
  const spam = 'объединение,адреса профсоюзов,общественные <strong>организации,общественный</strong> союз,общество защиты... &nbsp;&nbsp; <strong>Общества</strong> и союзы общественная организация,общественная... &nbsp;&nbsp;';
  assert.equal(isSpammyDescription(spam), true);
  assert.equal(isSpammyDescription('Пункт принимает старую одежду и обувь, книги и игрушки.'), false);
  assert.equal(isSpammyDescription('Принимаем текстиль по будням с 9 до 18.'), false);
  assert.equal(isSpammyDescription(''), false);
});

test('cleanPointField: спам в описании/логистике обнуляется, accepts не ломается', () => {
  const spam = 'общественные <strong>организации</strong>, адреса профсоюзов';
  assert.equal(cleanPointField('description', spam), '');
  assert.equal(cleanPointField('logistics', spam), '');
  assert.equal(cleanPointField('accepts', 'одежда, <strong>обувь</strong>&nbsp;'), 'одежда, обувь');
  assert.equal(
    cleanPointField('description', 'Принимаем одежду и книги'),
    'Принимаем одежду и книги',
  );
});
