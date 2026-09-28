import { test } from 'node:test';
import assert from 'node:assert/strict';

import { POINTS, ZAGOTTORG_PRICES } from '../src/points-data.js';
import {
  derivePointKinds,
  kindsFromText,
  positiveText,
} from '../src/point-kinds.js';

/**
 * Аудит согласованности: если пункт в любом из своих текстовых полей
 * (accepts/prices/description) упоминает вид в НЕОТРИЦАТЕЛЬНОЙ клаузе,
 * то accept_kinds пункта обязан содержать этот вид.
 * Иначе фильтр на карте перестаёт показывать реально принимающий пункт.
 */
function materialInText(point, kind) {
  const blob = positiveText(point.accepts, point.prices, point.description);
  return kindsFromText(blob).includes(kind) ||
    String(point.accepts || '').split(',').map((t) => t.trim()).includes(kind);
}

test('каждая точка: виды из текста ⊆ accept_kinds', () => {
  const bad = [];
  for (const point of POINTS) {
    const kinds = derivePointKinds(point);
    for (const kind of kindsFromText(positiveText(point.accepts, point.prices, point.description))) {
      if (!kinds.includes(kind)) bad.push({ key: point.source_key, kind, accept_kinds: kinds.join(','), org: point.organization });
    }
  }
  assert.deepEqual(bad, [], `Пункты, где текст упоминает вид, отсутствующий в accept_kinds:\n${bad.map((b) => `  ${b.key}: не хватает "${b.kind}" (accept_kinds="${b.accept_kinds}") ${b.org || ''}`).join('\n')}`);
});

test('Заготторг-Победа на Озёрском шоссе 16Е принимает стекло', () => {
  const point = POINTS.find((p) => p.source_key === 'zagottorg:озерское-16е');
  assert.ok(point, 'точка заготторг:озерское-16е должна существовать');
  const kinds = derivePointKinds(point);
  for (const kind of ['paper', 'glass', 'plastic', 'electronics', 'metal', 'hazardous']) {
    assert.ok(kinds.includes(kind), `Озёрское шоссе 16Е должно принимать "${kind}", есть: ${kinds}`);
  }
});

test('Заготторг: prices перечисляют и стекло тоже', () => {
  assert.match(ZAGOTTORG_PRICES, /стеклобой/);
  assert.match(ZAGOTTORG_PRICES, /стеклотара/);
  assert.ok(kindsFromText(ZAGOTTORG_PRICES).includes('glass'));
});

test('отрицательные клаузы не дают ложных видов', () => {
  // «бытовой металл на этом пункте не принимается» — металла добавлять нельзя.
  const text = 'Заготавливаются макулатура, полиэтилен, ПЭТ-бутылки, стеклобой (бытовой металл на этом пункте не принимается)';
  const kinds = kindsFromText(text);
  assert.ok(kinds.includes('paper'));
  assert.ok(kinds.includes('glass'));
  assert.ok(kinds.some((k) => ['plastic', 'paper', 'glass'].includes(k)));
  assert.ok(!kinds.includes('metal'), 'металл не должен выводиться из отрицательной клаузы');
});

test('no source_key IS NULL в датасете', () => {
  const orphan = POINTS.filter((p) => !p.source_key);
  assert.deepEqual(orphan.map((p) => p.name), []);
});