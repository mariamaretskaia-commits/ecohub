/**
 * Витрина демо-объявлений: создание, идемпотентность, сброс.
 * Запуск: node --test tests/showcase.test.mjs (из server/)
 */
process.env.DATABASE_URL = '';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, all, get, run } from '../src/db.js';
import { ensureShowcaseItems, SHOWCASE_ITEMS } from '../src/showcase.js';

await initDb();

async function purgeShowcase() {
  const users = await all("SELECT id FROM users WHERE telegram_id LIKE 'showcase_%'");
  for (const user of users) {
    await run('DELETE FROM item_wants WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)', user.id);
    await run('DELETE FROM item_favorites WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)', user.id);
    await run('DELETE FROM items WHERE user_id = ?', user.id);
    await run('DELETE FROM users WHERE id = ?', user.id);
  }
}

beforeEach(purgeShowcase);

test('создаёт 5 демо-объявлений с фото и миниатюрами', async () => {
  const result = await ensureShowcaseItems();
  assert.equal(result.created.length, 5);
  assert.equal(result.updated.length, 0);
  assert.equal(result.removed, 0);

  const rows = await all(`
    SELECT i.*, u.telegram_id, u.items_shared, u.nickname
    FROM items i JOIN users u ON u.id = i.user_id
    WHERE u.telegram_id LIKE 'showcase_%'
    ORDER BY i.id
  `);
  assert.equal(rows.length, 5);

  const titles = new Set(rows.map((r) => r.title));
  for (const item of SHOWCASE_ITEMS) assert.ok(titles.has(item.title), `нет «${item.title}»`);

  for (const row of rows) {
    assert.equal(row.type, 'free');
    assert.equal(row.status, 'active');
    assert.equal(row.mod_status, 'ok');
    assert.equal(row.oblast, 'Гродненская область');
    assert.equal(row.settlement, 'Гродно');
    assert.equal(row.items_shared, 0);
    assert.ok(row.unclaimed_delete_at, 'unclaimed_delete_at задан');
    assert.ok(Number(row.user_id) > 0);

    const photos = JSON.parse(row.photos);
    assert.equal(photos.length, 1);
    assert.match(photos[0], /^data:image\/jpeg;base64,/);

    const thumbs = JSON.parse(row.photo_thumbs);
    assert.equal(thumbs.length, 1);
    assert.match(thumbs[0], /^data:image\/jpeg;base64,/);
    assert.ok(Buffer.from(thumbs[0].split(',')[1], 'base64').length > 3000);
  }
});

test('повторный вызов не создаёт дублей и обновляет те же записи', async () => {
  const first = await ensureShowcaseItems();
  const second = await ensureShowcaseItems();

  assert.equal(second.created.length, 0);
  assert.equal(second.updated.length, 5);
  assert.deepEqual(second.updated.slice().sort(), first.created.slice().sort());

  const count = await get(`
    SELECT COUNT(*) AS c FROM items i JOIN users u ON u.id = i.user_id
    WHERE u.telegram_id LIKE 'showcase_%'
  `);
  assert.equal(Number(count.c), 5);
});

test('reset удаляет объявления и профили витрины', async () => {
  await ensureShowcaseItems();
  const result = await ensureShowcaseItems({ reset: true });
  assert.equal(result.removed, 5);

  const items = await get(`
    SELECT COUNT(*) AS c FROM items i JOIN users u ON u.id = i.user_id
    WHERE u.telegram_id LIKE 'showcase_%'
  `);
  assert.equal(Number(items.c), 0);

  const users = await get("SELECT COUNT(*) AS c FROM users WHERE telegram_id LIKE 'showcase_%'");
  assert.equal(Number(users.c), 0);
});
