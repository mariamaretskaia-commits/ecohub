/**
 * Moderator reports queue + ban-from-report.
 * Запуск: node --test tests/reports.test.mjs
 */
process.env.DATABASE_URL = '';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, get, all } from '../src/db.js';
import { findOrCreateUser, isTrustAdmin } from '../src/users.js';
import {
  getReportsQueue,
  moderatorBanFromReport,
  adminDismissReport,
} from '../src/trust/pipeline.js';
import { insertModMessage, insertReport, isBanned } from '../src/trust/store.js';

await initDb();

async function purgeReportRows() {
  await run("DELETE FROM mod_reports WHERE sender_telegram_id LIKE 'reports-%' OR reporter_telegram_id LIKE 'reports-%'");
  await run("DELETE FROM mod_messages WHERE sender_telegram_id LIKE 'reports-%' OR receiver_telegram_id LIKE 'reports-%'");
  await run("DELETE FROM mod_log WHERE target_telegram_id LIKE 'reports-%'");
  await run("DELETE FROM mod_banned WHERE telegram_id LIKE 'reports-%'");
  await run('DELETE FROM item_wants WHERE buyer_id IN (SELECT id FROM users WHERE telegram_id LIKE \'reports-%\')');
  await run('DELETE FROM chat_messages WHERE sender_id IN (SELECT id FROM users WHERE telegram_id LIKE \'reports-%\')');
  await run('DELETE FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE \'reports-%\')');
  await run('DELETE FROM users WHERE telegram_id LIKE \'reports-%\'');
}

await purgeReportRows();

beforeEach(purgeReportRows);

let seq = 0;
const tid = (suffix) => `reports-${suffix}-${Date.now()}-${seq++}`;

async function makeUser(telegramId, { nickname = 'Пользователь', first = 'А', last = 'Б' } = {}) {
  const u = await findOrCreateUser({ id: telegramId, first_name: first, last_name: last, username: `r${seq}` });
  await run("UPDATE users SET nickname = ?, first_name = ?, last_name = ? WHERE id = ?", nickname, first, last, u.id);
  return u;
}

async function makeItemAndWant(owner, buyer) {
  const ins = await run(
    "INSERT INTO items (user_id, title, description, status, district, category, type) VALUES (?, ?, ?, 'active', 'Ленинский', 'other', 'free')",
    owner.id, 'Стол', 'Деревянный стол', 
  );
  const itemId = ins.lastInsertRowid;
  const wan = await run('INSERT INTO item_wants (item_id, buyer_id) VALUES (?, ?)', itemId, buyer.id);
  return { itemId, wantId: wan.lastInsertRowid };
}

test('getReportsQueue: пользовательская жалоба с именами и названием вещи', async () => {
  const sender = await makeUser(tid('bob'), { nickname: 'Борис' });
  const reporter = await makeUser(tid('alice'), { nickname: 'Алиса' });
  const owner = await makeUser(tid('owner'), { nickname: 'Владелец' });
  const { wantId } = await makeItemAndWant(owner, sender);

  const msgId = await insertModMessage({
    senderTelegramId: sender.telegram_id,
    receiverTelegramId: owner.telegram_id,
    wantId,
    text: 'скиньте деньги на карту',
    censored: null,
    hasLink: 0,
    status: 'flagged',
    decidedBy: 'filter',
  });
  await insertReport({ msgId, senderTelegramId: sender.telegram_id, reporterTelegramId: reporter.telegram_id, category: 'payment_solicit', source: 'user' });

  const items = await getReportsQueue({ status: 'open' });
  const r = items.find((x) => String(x.sender_telegram_id) === String(sender.telegram_id));
  assert.ok(r, 'жалоба в очереди');
  assert.equal(r.sender_nickname, 'Борис');
  assert.equal(r.reporter_nickname, 'Алиса');
  assert.equal(String(r.item_title), 'Стол');
  assert.equal(r.content, 'скиньте деньги на карту');
  assert.equal(r.category, 'payment_solicit');
  assert.equal(r.source, 'user');
});

test('getReportsQueue: авто-пометка объявления (source=ai) с названием вещи', async () => {
  const owner = await makeUser(tid('owner2'), { nickname: 'Олег' });
  const ins = await run(
    "INSERT INTO items (user_id, title, description, status, mod_status, district, category, type) VALUES (?, ?, ?, 'active', 'flagged', 'Октябрьский', 'weapons', 'free')",
    owner.id, 'Пневматика', 'Пневматический пистолет',
  );
  const itemId = ins.lastInsertRowid;
  const msgId = await insertModMessage({
    senderTelegramId: owner.telegram_id,
    itemId,
    text: 'Продам пневматический пистолет',
    censored: 'Продам пневматический пистолет',
    hasLink: 0,
    status: 'flagged',
    decidedBy: 'ai',
  });
  await insertReport({ msgId, senderTelegramId: owner.telegram_id, category: 'weapons', source: 'ai' });

  const items = await getReportsQueue({ status: 'open' });
  const r = items.find((x) => String(x.sender_telegram_id) === String(owner.telegram_id));
  assert.ok(r);
  assert.equal(r.source, 'ai');
  assert.equal(String(r.item_title), 'Пневматика');
  assert.equal(r.entry_type, 'item');
});

test('moderatorBanFromReport: бан, подтверждение жалоб отправителя, лог', async () => {
  const sender = await makeUser(tid('bob2'), { nickname: 'Вася' });
  const reporter = await makeUser(tid('alice2'), { nickname: 'Алиса' });
  const other = await makeUser(tid('other'), { nickname: 'Другой' });
  const owner = await makeUser(tid('owner3'), { nickname: 'Владелец' });
  const { wantId } = await makeItemAndWant(owner, sender);

  const msgId = await insertModMessage({
    senderTelegramId: sender.telegram_id,
    receiverTelegramId: owner.telegram_id,
    wantId,
    text: 'запрещённое',
    censored: null,
    status: 'flagged',
  });
  const reportId = await insertReport({ msgId, senderTelegramId: sender.telegram_id, reporterTelegramId: reporter.telegram_id, category: 'other', source: 'user' });
  const msgId2 = await insertModMessage({
    senderTelegramId: sender.telegram_id,
    receiverTelegramId: owner.telegram_id,
    wantId,
    text: 'ещё одно',
    censored: null,
    status: 'flagged',
  });
  await insertReport({ msgId: msgId2, senderTelegramId: sender.telegram_id, reporterTelegramId: reporter.telegram_id, category: 'other', source: 'user' });
  const otherReportId = await insertReport({ msgId, senderTelegramId: other.telegram_id, reporterTelegramId: reporter.telegram_id, category: 'other', source: 'user' });

  await moderatorBanFromReport(reportId, 'moderator-1', 'подтверждено', null);
  assert.equal(await isBanned(sender.telegram_id), true);
  assert.equal(await isBanned(other.telegram_id), false);

  const senderOpen = await get('SELECT status FROM mod_reports WHERE sender_telegram_id = ? AND status = ?', sender.telegram_id, 'open');
  assert.equal(senderOpen, undefined);
  const otherOpen = await get('SELECT status FROM mod_reports WHERE id = ?', otherReportId);
  assert.equal(otherOpen.status, 'open');
  const log = await all("SELECT * FROM mod_log WHERE target_telegram_id = ?", sender.telegram_id);
  assert.ok(log.some((l) => l.event === 'moderator_confirm'));
});

test('moderatorBanFromReport: срок блокировки фиксируется в expires_at', async () => {
  const sender = await makeUser(tid('bob3'), { nickname: 'Гена' });
  const reporter = await makeUser(tid('alice3'), { nickname: 'Алиса' });
  const owner = await makeUser(tid('owner4'), { nickname: 'Владелец' });
  const { wantId } = await makeItemAndWant(owner, sender);

  const msgId = await insertModMessage({
    senderTelegramId: sender.telegram_id,
    receiverTelegramId: owner.telegram_id,
    wantId,
    text: 'плохо',
    censored: null,
    status: 'flagged',
  });
  const reportId = await insertReport({ msgId, senderTelegramId: sender.telegram_id, reporterTelegramId: reporter.telegram_id, category: 'other', source: 'user' });

  await moderatorBanFromReport(reportId, 'moderator-2', 'на неделю', 7);
  const ban = await get('SELECT * FROM mod_banned WHERE telegram_id = ?', sender.telegram_id);
  assert.ok(ban);
  assert.ok(ban.expires_at && ban.expires_at > String(ban.created_at || ''));
});

test('moderatorBanFromReport: несуществующая жалоба → 404-ошибка', async () => {
  await assert.rejects(
    () => moderatorBanFromReport(99999999, 'moderator'),
    (err) => err.status === 404,
  );
});

test('adminDismissReport: жалоба становится dismissed', async () => {
  const sender = await makeUser(tid('bob4'), { nickname: 'Ден' });
  const reporter = await makeUser(tid('alice4'), { nickname: 'Алиса' });
  const owner = await makeUser(tid('owner5'), { nickname: 'Владелец' });
  const { wantId } = await makeItemAndWant(owner, sender);

  const msgId = await insertModMessage({
    senderTelegramId: sender.telegram_id,
    receiverTelegramId: owner.telegram_id,
    wantId,
    text: 'спорно',
    censored: null,
    status: 'flagged',
  });
  const reportId = await insertReport({ msgId, senderTelegramId: sender.telegram_id, reporterTelegramId: reporter.telegram_id, category: 'other', source: 'user' });
  await adminDismissReport(reportId, 'moderator-3');
  const row = await get('SELECT status FROM mod_reports WHERE id = ?', reportId);
  assert.equal(row.status, 'dismissed');
});

test('isTrustAdmin: только перечисленные id из TRUST_ADMIN_IDS', () => {
  const prev = process.env.TRUST_ADMIN_IDS;
  try {
    process.env.TRUST_ADMIN_IDS = ' 42 , 777 ';
    assert.equal(isTrustAdmin(42), true);
    assert.equal(isTrustAdmin('777'), true);
    assert.equal(isTrustAdmin(1), false);
  } finally {
    process.env.TRUST_ADMIN_IDS = prev;
  }
});