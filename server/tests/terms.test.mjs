/**
 * Terms & Privacy agreement gate: сохранение профиля требует согласий.
 * Запуск: node --test tests/terms.test.mjs
 */
process.env.DATABASE_URL = '';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, get } from '../src/db.js';
import { saveProfile, findOrCreateUser } from '../src/users.js';

await initDb();
await run('DELETE FROM users WHERE telegram_id LIKE \'terms-%\'');

function tg(id) {
  return { id, first_name: 'Тест', username: `terms_${id}` };
}

async function freshUser() {
  return findOrCreateUser(tg(`terms-${Math.random().toString(36).slice(2, 8)}`));
}

test('saveProfile: отклоняет без согласия с правилами', async () => {
  const user = await freshUser();
  await assert.rejects(
    () => saveProfile(user.id, { nickname: 'Тестовый', terms_privacy: true }, true),
    (err) => err.status === 400 && /Правилами сообщества/.test(err.message),
  );
});

test('saveProfile: отклоняет без согласия с политикой', async () => {
  const user = await freshUser();
  await assert.rejects(
    () => saveProfile(user.id, { nickname: 'Тестовый', terms_rules: true }, true),
    (err) => err.status === 400 && /политикой обработки данных/.test(err.message),
  );
});

test('saveProfile: оба согласия фиксируются временем', async () => {
  const user = await freshUser();
  const saved = await saveProfile(
    user.id,
    { nickname: 'Тестовый', terms_rules: true, terms_privacy: true },
    true,
  );
  assert.equal(saved.nickname, 'Тестовый');
  const row = await get('SELECT terms_rules_at, terms_privacy_at, consent_at FROM users WHERE id = ?', user.id);
  assert.ok(row.terms_rules_at, 'terms_rules_at должен быть установлен');
  assert.ok(row.terms_privacy_at, 'terms_privacy_at должен быть установлен');
  assert.ok(row.consent_at, 'consent_at должен быть установлен');
});