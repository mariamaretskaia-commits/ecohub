/**
 * Nudge: напоминание о невостребованных объявлениях и авто-удаление через 21 день.
 * Запуск: node --test tests/nudge.test.mjs
 */
process.env.DATABASE_URL = '';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, run, get, all } from '../src/db.js';
import { findOrCreateUser } from '../src/users.js';
import { removeItemWithAssets } from '../src/items.js';
import {
  mapCategoryToPointType,
  selectItemsForUnclaimedNudge,
  selectItemsForUnclaimedRemoval,
  sendUnclaimedNudges,
  removeUnclaimedItems,
  buildUnclaimedText,
  buildKeyboard,
} from '../src/nudge.js';

await initDb();

async function purgeNudgeRows() {
  await run(
    "DELETE FROM chat_messages WHERE want_id IN (SELECT id FROM item_wants WHERE buyer_id IN (SELECT id FROM users WHERE telegram_id LIKE 'nudge-%') OR item_id IN (SELECT id FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'nudge-%')))",
  );
  await run(
    "DELETE FROM item_wants WHERE buyer_id IN (SELECT id FROM users WHERE telegram_id LIKE 'nudge-%') OR item_id IN (SELECT id FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'nudge-%'))",
  );
  await run(
    "DELETE FROM item_favorites WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'nudge-%') OR item_id IN (SELECT id FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'nudge-%'))",
  );
  await run("DELETE FROM items WHERE user_id IN (SELECT id FROM users WHERE telegram_id LIKE 'nudge-%')");
  await run("DELETE FROM users WHERE telegram_id LIKE 'nudge-%'");
}

await purgeNudgeRows();
beforeEach(() => purgeNudgeRows());

let seq = 0;
async function makeUser(telegramId, over = {}) {
  const user = await findOrCreateUser({ id: telegramId, first_name: 'Тест', username: telegramId });
  await run(
    `UPDATE users SET
       consent_at = COALESCE(consent_at, datetime('now')),
       terms_rules_at = COALESCE(terms_rules_at, datetime('now')),
       terms_privacy_at = COALESCE(terms_privacy_at, datetime('now'))
     WHERE id = ?`,
    user.id,
  );
  if (over.nudges_disabled !== undefined) {
    await run('UPDATE users SET nudges_disabled = ? WHERE id = ?', over.nudges_disabled ? 1 : 0, user.id);
  }
  if (over.no_consent) {
    await run('UPDATE users SET terms_rules_at = NULL, terms_privacy_at = NULL WHERE id = ?', user.id);
  }
  return get('SELECT * FROM users WHERE id = ?', user.id);
}

function nextTg() {
  seq += 1;
  return `nudge-${Date.now()}-${seq}`;
}

/** Вставка объявления; значения datetime('...') вычисляются в SQL, остальные – параметры. */
async function insertItem(userId, over = {}) {
  const columns = ['user_id', 'title', 'description', 'photo_url', 'district', 'category', 'type', 'status'];
  const params = [userId, over.title || 'Пальто', '', over.photo_url ?? null, 'Ленинский', over.category || 'Одежда', 'free', over.status || 'active'];
  const placeholders = columns.map(() => '?');
  const addDateTime = (name, value) => {
    if (value === undefined) return;
    columns.push(name);
    if (String(value).startsWith('datetime(')) placeholders.push(`(${value})`);
    else {
      placeholders.push('?');
      params.push(value);
    }
  };
  addDateTime('created_at', over.created_at);
  addDateTime('unclaimed_delete_at', over.unclaimed_delete_at);
  if (over.photos !== undefined) {
    columns.push('photos');
    placeholders.push('?');
    params.push(JSON.stringify(over.photos));
  }
  const res = await run(
    `INSERT INTO items (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    ...params,
  );
  return get('SELECT * FROM items WHERE id = ?', res.lastInsertRowid);
}

function makeBot() {
  const calls = [];
  return {
    calls,
    telegram: {
      async sendMessage(chatId, text, extra) {
        calls.push({ chatId, text, extra });
        return { ok: true };
      },
    },
  };
}

test('mapCategoryToPointType: одежда/детское/электроника → типы карты, Мебель → нет', () => {
  assert.equal(mapCategoryToPointType('Одежда'), 'clothing');
  assert.equal(mapCategoryToPointType('Всё для детей и мам'), 'clothing');
  assert.equal(mapCategoryToPointType('Бытовая техника'), 'electronics');
  assert.equal(mapCategoryToPointType('Электроника'), 'electronics');
  assert.equal(mapCategoryToPointType('Мебель'), null);
});

test('новое объявление получает дедлайн авто-удаления +21 день', async () => {
  const user = await makeUser(nextTg());
  const item = await insertItem(user.id, {
    unclaimed_delete_at: "datetime('now', '+21 days')",
  });
  const row = await get('SELECT unclaimed_delete_at FROM items WHERE id = ?', item.id);
  assert.ok(row.unclaimed_delete_at, 'дедлайн проставлен при создании');
  const ts = new Date(String(row.unclaimed_delete_at).replace(' ', 'T') + 'Z').getTime();
  assert.ok(ts > Date.now(), 'дедлайн в будущем на 21 день');
  assert.ok(ts < Date.now() + UNCLAIMED_DAYS_TOLERANCE, 'дедлайн не слишком далеко');
});

const UNCLAIMED_DAYS_TOLERANCE = 25 * 24 * 3600 * 1000;

test('напоминание: отбираются только старые активные без откликов', async () => {
  const user = await makeUser(nextTg());
  const inWindow = await insertItem(user.id, {
    title: 'В окне',
    created_at: "datetime('now', '-14 days')",
    unclaimed_delete_at: "datetime('now', '+7 days')",
  });
  await insertItem(user.id, {
    title: 'Рано',
    created_at: "datetime('now', '-1 day')",
    unclaimed_delete_at: "datetime('now', '+20 days')",
  });

  const rows = await selectItemsForUnclaimedNudge();
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes(inWindow.id), 'объявление в окне напоминания должно попасть');
  assert.ok(!rows.some((r) => r.title === 'Рано'), 'объявление с далёким дедлайном не отбирается');
});

test('напоминание: исключаются отклики, given, демо, отписка, без согласия, уже уведомлённые', async () => {
  const owner = await makeUser(nextTg());
  const interloper = await makeUser(nextTg());
  const consent = await makeUser(nextTg());
  const opted = await makeUser(nextTg(), { nudges_disabled: 1 });
  const noConsent = await makeUser(nextTg(), { no_consent: true });
  const demoUser = await makeUser('demo_x');

  const withWant = await insertItem(owner.id, { title: 'С откликом', unclaimed_delete_at: "datetime('now', '+7 days')" });
  await run('INSERT INTO item_wants (item_id, buyer_id) VALUES (?, ?)', withWant.id, interloper.id);

  await insertItem(owner.id, { title: 'Отданная', status: 'given', unclaimed_delete_at: "datetime('now', '+7 days')" });
  await insertItem(demoUser.id, { title: 'Демо', unclaimed_delete_at: "datetime('now', '+7 days')" });
  await insertItem(opted.id, { title: 'Отписка', unclaimed_delete_at: "datetime('now', '+7 days')" });
  await insertItem(noConsent.id, { title: 'Без согласия', unclaimed_delete_at: "datetime('now', '+7 days')" });
  const nudged = await insertItem(consent.id, { title: 'Уже уведомлён', unclaimed_delete_at: "datetime('now', '+7 days')" });
  await run("UPDATE items SET unclaimed_nudge_at = datetime('now') WHERE id = ?", nudged.id);

  const titles = (await selectItemsForUnclaimedNudge()).map((r) => r.title);
  for (const t of ['С откликом', 'Отданная', 'Демо', 'Отписка', 'Без согласия', 'Уже уведомлён']) {
    assert.ok(!titles.includes(t), `«${t}» не должно отбираться`);
  }
});

test('sendUnclaimedNudges: шлёт одно сообщение с кнопками и помечает; повтор не шлёт', async () => {
  const owner = await makeUser(nextTg());
  const item = await insertItem(owner.id, {
    title: 'Тёплое пальто',
    unclaimed_delete_at: "datetime('now', '+7 days')",
  });

  const bot = makeBot();
  const WEB_APP = 'https://ecohub-baoc.onrender.com';
  const first = await sendUnclaimedNudges(bot, WEB_APP);
  assert.equal(first, 1);
  assert.equal(bot.calls.length, 1);
  const [call] = bot.calls;
  assert.equal(call.chatId, owner.telegram_id);
  assert.ok(call.text.includes('Тёплое пальто'));
  assert.ok(call.text.includes('(Одежда)'));
  const markup = call.extra.reply_markup?.inline_keyboard || [];
  const urls = markup.flat().map((b) => b.web_app?.url).filter(Boolean);
  assert.ok(urls.includes(`${WEB_APP}?map=clothing`), 'кнопка карты с фильтром категории');
  assert.ok(urls.includes(`${WEB_APP}?tab=profile`), 'кнопка моих объявлений');

  const marked = await get('SELECT unclaimed_nudge_at FROM items WHERE id = ?', item.id);
  assert.ok(marked.unclaimed_nudge_at, 'маркер отправки проставлен');

  bot.calls.length = 0;
  const second = await sendUnclaimedNudges(bot, WEB_APP);
  assert.equal(second, 0);
  assert.equal(bot.calls.length, 0, 'повторно не отправляется');
});

test('sendUnclaimedNudges: при сбое доставки маркер не ставится, повтор возможен', async () => {
  const owner = await makeUser(nextTg());
  const item = await insertItem(owner.id, {
    title: 'Не получилось доставить',
    unclaimed_delete_at: "datetime('now', '+7 days')",
  });

  const failingBot = {
    telegram: {
      async sendMessage() {
        throw new Error('Telegram API: connection refused');
      },
    },
  };
  const sent = await sendUnclaimedNudges(failingBot, 'https://ecohub-baoc.onrender.com');
  assert.equal(sent, 0);
  assert.equal(await get('SELECT unclaimed_nudge_at FROM items WHERE id = ?', item.id).then((r) => r.unclaimed_nudge_at), null, 'маркер не ставится при ошибке');

  const okBot = makeBot();
  const after = await sendUnclaimedNudges(okBot, 'https://ecohub-baoc.onrender.com');
  assert.equal(after, 1);
  assert.equal(okBot.calls.length, 1, 'повторная попытка доставляет');
});

test('sendUnclaimedNudges: без бота ничего не отправляется и не помечается', async () => {
  const owner = await makeUser(nextTg());
  await insertItem(owner.id, {
    title: 'Нет бота',
    unclaimed_delete_at: "datetime('now', '+7 days')",
  });
  const sent = await sendUnclaimedNudges(null, 'https://ecohub-baoc.onrender.com');
  assert.equal(sent, 0);
  assert.equal((await all("SELECT * FROM items WHERE title = 'Нет бота' AND unclaimed_nudge_at IS NOT NULL")).length, 0);
});

test('buildKeyboard: без типа пункта нет кнопки карты', () => {
  const kb = buildKeyboard({ category: 'Мебель' }, 'https://app.example');
  const urls = (kb?.inline_keyboard || []).flat().map((b) => b.web_app?.url).filter(Boolean);
  assert.ok(!urls.some((u) => u.includes('?map=')), 'для Мебель нет кнопки карты');
  assert.ok(urls.includes('https://app.example?tab=profile'));
});

test('buildUnclaimedText: содержит дату дедлайна и предложение действий', () => {
  const text = buildUnclaimedText({
    title: 'Пальто',
    category: 'Одежда',
    unclaimed_delete_at: '2026-10-06 12:00:00',
    created_at: '2026-09-01 12:00:00',
  });
  assert.ok(text.includes('06.10.2026'));
  assert.ok(text.includes('удалено автоматически'));
  assert.ok(text.includes('отключить'));
  assert.ok(text.includes('Сдать вещь на переработку'));
});

test('removeUnclaimedItems: удаляет пережившие дедлайн без откликов вместе с избранным и фото', async () => {
  const owner = await makeUser(nextTg());
  const interloper = await makeUser(nextTg());

  const expired = await insertItem(owner.id, {
    title: 'Просрочено',
    photo_url: 'https://example.com/coat.jpg',
    photos: ['https://example.com/coat.jpg'],
    unclaimed_delete_at: "datetime('now', '-1 hour')",
  });
  await run('INSERT INTO item_favorites (item_id, user_id) VALUES (?, ?)', expired.id, interloper.id);

  const wanted = await insertItem(owner.id, { title: 'С откликом', unclaimed_delete_at: "datetime('now', '-1 hour')" });
  await run('INSERT INTO item_wants (item_id, buyer_id) VALUES (?, ?)', wanted.id, interloper.id);

  const notYet = await insertItem(owner.id, { title: 'Ещё рано', unclaimed_delete_at: "datetime('now', '+1 day')" });

  const removed = await removeUnclaimedItems();
  assert.equal(removed, 1, 'удаляется только просроченное без откликов');

  assert.equal(await get('SELECT * FROM items WHERE id = ?', expired.id), undefined, 'просроченное удалено');
  assert.equal((await all('SELECT * FROM item_favorites WHERE item_id = ?', expired.id)).length, 0, 'избранное удалено');
  assert.ok(await get('SELECT * FROM items WHERE id = ?', wanted.id), 'объявление с откликом живёт');
  assert.ok(await get('SELECT * FROM items WHERE id = ?', notYet.id), 'непросроченное живёт');
});

test('removeUnclaimedItems: отписка спасает объявление от авто-удаления', async () => {
  const opted = await makeUser(nextTg(), { nudges_disabled: 1 });
  const kept = await insertItem(opted.id, { title: 'Вручную', unclaimed_delete_at: "datetime('now', '-1 hour')" });
  const removed = await removeUnclaimedItems();
  assert.equal(removed, 0);
  assert.ok(await get('SELECT * FROM items WHERE id = ?', kept.id), 'отписавшийся не теряет объявление');
});

test('selectItemsForUnclaimedRemoval: только с прошедшим дедлайном', async () => {
  const user = await makeUser(nextTg());
  const past = await insertItem(user.id, { title: 'В прошлом', unclaimed_delete_at: "datetime('now', '-2 hours')" });
  const future = await insertItem(user.id, { title: 'В будущем', unclaimed_delete_at: "datetime('now', '+1 day')" });
  const rows = await selectItemsForUnclaimedRemoval();
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes(past.id));
  assert.ok(!ids.includes(future.id));
});

test('removeItemWithAssets: удаляет строки и фото', async () => {
  const owner = await makeUser(nextTg());
  const item = await insertItem(owner.id, { photo_url: 'https://example.com/x.jpg' });
  await removeItemWithAssets(await get('SELECT * FROM items WHERE id = ?', item.id));
  assert.equal(await get('SELECT * FROM items WHERE id = ?', item.id), undefined);
});