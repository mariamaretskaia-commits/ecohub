/**
 * Privacy: минимизация до согласия, экспорт данных, полнота удаления.
 * Запуск: node --test tests/privacy.test.mjs
 */
process.env.DATABASE_URL = '';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, get, all } from '../src/db.js';
import { findOrCreateUser, acceptLegal, exportUserData, deleteUserData } from '../src/users.js';
import {
  createDownloadToken,
  consumeDownloadToken,
  _resetDownloadTokens,
} from '../src/export-download.js';
import { BOT_COMMANDS } from '../../bot/src/createBot.js';

await initDb();

async function purgePrivacyRows() {
  await run(
    "DELETE FROM chat_messages WHERE sender_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%') OR want_id IN (SELECT id FROM item_wants WHERE item_id IN (SELECT id FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%')))",
  );
  await run(
    "DELETE FROM item_wants WHERE buyer_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%') OR item_id IN (SELECT id FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%'))",
  );
  await run(
    "DELETE FROM item_favorites WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%') OR item_id IN (SELECT id FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%'))",
  );
  await run("DELETE FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%')");
  await run("DELETE FROM eco_transactions WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%')");
  await run("DELETE FROM recycling_submissions WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%')");
  await run("DELETE FROM point_suggestions WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'privacy-%')");
  await run("DELETE FROM users WHERE telegram_id LIKE 'privacy-%'");
  await run("DELETE FROM mod_reports WHERE sender_telegram_id LIKE 'privacy-%' OR reporter_telegram_id LIKE 'privacy-%'");
  await run("DELETE FROM mod_messages WHERE sender_telegram_id LIKE 'privacy-%' OR receiver_telegram_id LIKE 'privacy-%'");
  await run("DELETE FROM mod_log WHERE target_telegram_id LIKE 'privacy-%' OR actor LIKE 'privacy-%'");
  await run("DELETE FROM mod_trust WHERE telegram_id LIKE 'privacy-%'");
  await run("DELETE FROM mod_banned WHERE telegram_id LIKE 'privacy-%'");
  await run("DELETE FROM meta WHERE key LIKE 'support_devmsg_%' OR key LIKE 'support_mode_%'");
}

await purgePrivacyRows();

function tg(id, over = {}) {
  return {
    id,
    first_name: 'Иван',
    last_name: 'Тестов',
    username: `privacy-${id}`,
    photo_url: 'https://example.com/avatar.jpg',
    ...over,
  };
}

let seq = 0;
function nextTgId() {
  seq += 1;
  return `privacy-${Date.now()}-${seq}`;
}

beforeEach(() => run("DELETE FROM meta WHERE key LIKE 'support_devmsg_%' OR key LIKE 'support_mode_%' OR key LIKE 'privacy-%'"));

test('до согласия сохраняется только telegram_id', async () => {
  const id = nextTgId();
  const user = await findOrCreateUser(tg(id));
  const row = await get('SELECT * FROM users WHERE id = ?', user.id);
  assert.equal(row.first_name, null);
  assert.equal(row.last_name, null);
  assert.equal(row.username, null);
  assert.equal(row.photo_url, null);
  assert.equal(row.telegram_id, id);
});

test('acceptLegal дозаполняет имя и фото после согласия', async () => {
  const telegram = tg(nextTgId());
  const user = await findOrCreateUser(telegram);
  const saved = await acceptLegal(user.id, { terms_rules: true, terms_privacy: true }, telegram);
  assert.ok(saved.consent_at || saved.terms_rules_at);
  const row = await get('SELECT first_name, last_name, username, photo_url FROM users WHERE id = ?', user.id);
  assert.equal(row.first_name, 'Иван');
  assert.equal(row.last_name, 'Тестов');
  assert.equal(row.username, telegram.username);
  assert.equal(row.photo_url, 'https://example.com/avatar.jpg');
});

test('после согласия имя и фото обновляются при входе, до согласия — нет', async () => {
  const id = nextTgId();
  let user = await findOrCreateUser(tg(id, { first_name: 'Старый', photo_url: null }));
  const before = await get('SELECT photo_url FROM users WHERE id = ?', user.id);
  assert.equal(before.photo_url, null);

  await acceptLegal(user.id, { terms_rules: true, terms_privacy: true }, tg(id, { first_name: 'Старый', photo_url: 'https://after-consent.jpg' }));
  user = await findOrCreateUser(tg(id, { first_name: 'Старый', photo_url: 'https://second-login.jpg' }));
  const after = await get('SELECT photo_url, username FROM users WHERE id = ?', user.id);
  assert.equal(after.photo_url, 'https://second-login.jpg');
});

test('exportUserData: только данные самого субъекта, все разделы', async () => {
  const id = nextTgId();
  const telegram = tg(id);
  const user = await findOrCreateUser(telegram);
  await acceptLegal(user.id, { terms_rules: true, terms_privacy: true }, telegram);
  const testPhone = `+375${String(Date.now()).slice(-9)}`;
  await run('UPDATE users SET nickname = ?, phone = ? WHERE id = ?', 'Приват Тест', testPhone, user.id);

  const other = await findOrCreateUser(tg(nextTgId()));

  const itemRes = await run(
    "INSERT INTO items (user_id, title, description, district, category, type, oblast, settlement) VALUES (?, 'Кресло', '', 'Ленинский', 'мебель', 'free', 'Гродненская область', 'Гродно')",
    user.id,
  );
  await run('INSERT INTO items (user_id, title, description, district, category, type, oblast, settlement) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', other.id, 'Чужая', '', 'Ленинский', 'мебель', 'free', 'Гродненская область', 'Гродно');
  await run("INSERT INTO eco_transactions (user_id, amount, type, description) VALUES (?, 5, 'signup', 'старт')", user.id);
  await run("INSERT INTO item_favorites (item_id, user_id) VALUES (?, ?)", itemRes.lastInsertRowid, user.id);
  const wantRes = await run("INSERT INTO item_wants (item_id, buyer_id) VALUES (?, ?)", itemRes.lastInsertRowid, user.id);
  await run('INSERT INTO point_suggestions (type, address, contact, status, user_id) VALUES (?, ?, ?, ?, ?)', 'counter', 'ул. Тестовая, 1', 'ivan@mail.by', 'new', user.id);
  await run("INSERT INTO chat_messages (want_id, sender_id, body) VALUES (?, ?, 'привет')", wantRes.lastInsertRowid, user.id);

  const data = await exportUserData(user.id);

  assert.ok(data.exported_at);
  assert.equal(data.profile.nickname, 'Приват Тест');
  assert.equal(data.profile.phone, testPhone);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].title, 'Кресло');
  assert.equal(data.wants.length, 1);
  assert.equal(data.favorites.length, 1);
  assert.equal(data.transactions.length, 1);
  assert.equal(data.suggestions.length, 1);
  assert.equal(data.messages.length, 1);
  assert.ok(!data.items.some((i) => i.title === 'Чужая'), 'чужие данные не должны попадать в экспорт');
});

test('deleteUserData: удаляет всё, обезличивает мод-журналы, не трогает чужие данные', async () => {
  const id = nextTgId();
  const telegram = tg(id);
  const user = await findOrCreateUser(telegram);
  await acceptLegal(user.id, { terms_rules: true, terms_privacy: true }, telegram);
  await run("INSERT INTO meta (key, value) VALUES (?, '1')", `support_mode_${id}`);
  await run(
    "INSERT INTO meta (key, value) VALUES (?, ?)",
    'support_devmsg_777',
    JSON.stringify({ user: String(id), dev: '999000999' }),
  );
  await run(
    "INSERT INTO meta (key, value) VALUES (?, ?)",
    'support_devmsg_778',
    JSON.stringify({ user: 'privacy-other', dev: '999000999' }),
  );
  await run('INSERT INTO point_suggestions (type, address, contact, status, user_id) VALUES (?, ?, ?, ?, ?)', 'counter', 'ул. А, 2', 'con', 'new', user.id);
  const modMsgId = (await run("INSERT INTO mod_messages (entry_type, sender_telegram_id, receiver_telegram_id, content, status) VALUES ('chat', ?, ?, 'привет', 'clean')", id, 'someone')).lastInsertRowid;
  await run("INSERT INTO mod_reports (message_id, sender_telegram_id, reporter_telegram_id, category, source) VALUES (?, ?, 'reporter', 'user_report', 'user')", modMsgId, id);
  await run("INSERT INTO mod_log (event, target_telegram_id, actor, message_id) VALUES ('edit', ?, 'actor', ?)", id, modMsgId);
  await run("INSERT INTO mod_trust (telegram_id, score, level) VALUES (?, 10, 'low')", id);
  await run("INSERT INTO mod_banned (telegram_id, reason, category, banned_by) VALUES (?, 'тест', 'other', 'system')", id);

  const other = await findOrCreateUser(tg('privacy-other'));
  const otherItem = await run(
    "INSERT INTO items (user_id, title, description, district, category, type, oblast, settlement) VALUES (?, 'Стол', '', 'Октябрьский', 'мебель', 'free', 'Гродненская область', 'Гродно')",
    other.id,
  );
  const otherWant = await run('INSERT INTO item_wants (item_id, buyer_id) VALUES (?, ?)', otherItem.lastInsertRowid, other.id);
  await run("INSERT INTO chat_messages (want_id, sender_id, body) VALUES (?, ?, 'чужое сообщение')", otherWant.lastInsertRowid, other.id);

  const res = await deleteUserData(user.id);
  assert.equal(res.ok, true);

  assert.equal(await get('SELECT * FROM users WHERE id = ?', user.id), undefined);
  assert.equal((await all('SELECT * FROM point_suggestions WHERE user_id = ?', user.id)).length, 0);
  assert.equal(await get("SELECT * FROM meta WHERE key = 'support_mode_' || ?", id), undefined);
  assert.equal(await get("SELECT * FROM meta WHERE key = 'support_devmsg_777'"), undefined);
  assert.ok(await get("SELECT * FROM meta WHERE key = 'support_devmsg_778'"), 'чужие карты ответов сохраняются');

  const modRow = await get('SELECT sender_telegram_id, receiver_telegram_id FROM mod_messages WHERE sender_telegram_id IS NULL');
  assert.ok(modRow, 'мод-журнал остаётся');
  const repRow = await get('SELECT sender_telegram_id FROM mod_reports WHERE sender_telegram_id IS NULL');
  assert.ok(repRow, 'мод-репорты обезличены');
  assert.equal(await get("SELECT * FROM mod_trust WHERE telegram_id = ?", id), undefined);
  assert.equal(await get("SELECT * FROM mod_banned WHERE telegram_id = ?", id), undefined);

  const otherMsgs = await all('SELECT * FROM chat_messages WHERE sender_id = ?', other.id);
  assert.equal(otherMsgs.length, 1, 'данные другого пользователя не затронуты');
});

test('команда /developer_info зарегистрирована', () => {
  const dev = BOT_COMMANDS.find((c) => c.command === 'developer_info');
  assert.ok(dev, 'developer_info должен быть в списке команд');
  assert.match(dev.description, /права/i);
});

test('токен скачивания одноразовый и привязан к пользователю', () => {
  _resetDownloadTokens();
  const token = createDownloadToken('privacy-tok-1');
  assert.ok(token);
  assert.equal(consumeDownloadToken(token).telegramId, 'privacy-tok-1');
  assert.deepEqual(consumeDownloadToken(token), { error: 'invalid' }, 'повторное использование отклоняется');
});

test('токен скачивания: без токена и с неверным токеном — отказ', () => {
  _resetDownloadTokens();
  assert.deepEqual(consumeDownloadToken(), { error: 'missing' });
  assert.deepEqual(consumeDownloadToken(''), { error: 'missing' });
  assert.deepEqual(consumeDownloadToken('nope'), { error: 'invalid' });
});

test('истёкший токен скачивания отклоняется', async (t) => {
  _resetDownloadTokens();
  await t.mock.timers.enable({ apis: ['Date'] });
  try {
    const token = createDownloadToken('privacy-tok-2');
    t.mock.timers.tick(2 * 60 * 1000 + 1000);
    assert.deepEqual(consumeDownloadToken(token), { error: 'expired' });
  } finally {
    t.mock.timers.reset();
  }
});