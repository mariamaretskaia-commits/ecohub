/**
 * Support flow: /support принимает сообщение и приватно передаёт команде.
 * Запуск: node --test tests/support.test.mjs
 */
process.env.DATABASE_URL = '';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, get } from '../src/db.js';
import { sendSupportTicket, sendSupportReply, BOT_COMMANDS } from '../../bot/src/createBot.js';

await initDb();
await run("DELETE FROM meta WHERE key = 'dev_telegram_chat_id'");
await run("INSERT INTO meta (key, value) VALUES ('dev_telegram_chat_id', '999000999')");

let sent = [];
const fakeBot = {
  telegram: {
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
      return { message_id: 1 };
    },
  },
};

beforeEach(() => {
  sent = [];
  return run("DELETE FROM meta WHERE key LIKE 'support_devmsg_%'");
});

test('sendSupportTicket: текст уходит в dev-чат с именем пользователя и картой ответа', async () => {
  const result = await sendSupportTicket(
    fakeBot,
    { id: 111, first_name: 'Иван', last_name: 'Петров', username: 'ivan_eco' },
    555,
    { text: 'Не открывается карта' },
  );
  assert.equal(result.delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '999000999');
  assert.match(sent[0].text, /Запрос в поддержку/);
  assert.match(sent[0].text, /Иван Петров \(@ivan_eco\)/);
  assert.match(sent[0].text, /Не открывается карта/);

  const row = await get("SELECT value FROM meta WHERE key = 'support_devmsg_1'");
  assert.ok(row, 'маппинг сообщения должен быть сохранён');
  const map = JSON.parse(row.value);
  assert.equal(map.user, '555');
  assert.equal(map.dev, '999000999');
});

test('sendSupportReply: из чата поддержки ответ уходит пользователю анонимно', async () => {
  const mapping = JSON.stringify({ user: '555', dev: '999000999' });
  const res = await sendSupportReply(fakeBot, '999000999', mapping, { text: 'Всё починили' });
  assert.equal(res.ok, true);
  assert.equal(res.to, '555');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '555');
  assert.match(sent[0].text, /^💬 Ответ команды EcoHub:/);
  assert.match(sent[0].text, /Всё починили/);
  assert.doesNotMatch(sent[0].text, /Мария|Поддержка:\s*\nОт:/);
});

test('sendSupportReply: из чата, не привязанного к тикету, ничего не отправляется', async () => {
  const mapping = JSON.stringify({ user: '555', dev: '999000999' });
  const res = await sendSupportReply(fakeBot, '123456', mapping, { text: 'вы' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not-a-support-chat');
  assert.equal(sent.length, 0);
});

test('sendSupportReply: пустой ответ без текста отклоняется', async () => {
  const mapping = JSON.stringify({ user: '555', dev: '999000999' });
  const res = await sendSupportReply(fakeBot, '999000999', mapping, { sticker: { file_id: 'x' } });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'empty-reply');
  assert.equal(sent.length, 0);
});

test('команды бота зарегистрированы для меню', () => {
  const commands = BOT_COMMANDS.map((c) => c.command);
  assert.ok(commands.includes('start'));
  assert.ok(commands.includes('support'));
  assert.ok(commands.includes('app'));
  assert.ok(commands.includes('help'));
});