/**
 * Support flow: /support принимает сообщение и приватно передаёт команде.
 * Запуск: node --test tests/support.test.mjs
 */
process.env.DATABASE_URL = '';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, get } from '../src/db.js';
import { sendSupportTicket, BOT_COMMANDS } from '../../bot/src/createBot.js';

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

test('sendSupportTicket: текст уходит в dev-чат с именем пользователя', async () => {
  sent = [];
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
});

test('sendSupportTicket: фото без подписи помечается, имя отсутствует — не падает', async () => {
  sent = [];
  const result = await sendSupportTicket(fakeBot, { id: 222 }, 556, { photo: [{ file_id: 'x' }] });
  assert.equal(result.delivered, true);
  assert.match(sent[0].text, /📷 Фото/);
  assert.match(sent[0].text, /Аноним/);
});

test('команды бота зарегистрированы для меню', () => {
  const commands = BOT_COMMANDS.map((c) => c.command);
  assert.ok(commands.includes('start'));
  assert.ok(commands.includes('support'));
  assert.ok(commands.includes('app'));
  assert.ok(commands.includes('help'));
});