/**
 * E2E Trust & Safety: полный цикл против SQLite.
 * Запуск: node tests/e2e.mjs   (из server/)
 */
process.env.DATABASE_URL = '';
process.env.TRUST_ADMIN_TOKEN = 'test-token';

import { initDb, run, get, all } from '../src/db.js';
import {
  moderateChatMessage,
  moderateItem,
  getAdminQueue,
  adminConfirmReport,
  adminDismissReport,
  adminBanUser,
  adminUnbanUser,
} from '../src/trust/pipeline.js';
import { isBanned } from '../src/trust/store.js';

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};

await initDb();

await run('DELETE FROM mod_reports');
await run('DELETE FROM mod_messages');
await run('DELETE FROM mod_log');
await run('DELETE FROM mod_trust');
await run('DELETE FROM mod_banned');

// ── базовая модерация чата ─────────────────────────────────────────
let res = await moderateChatMessage({ senderTg: '700001', receiverTg: '700002', wantId: 1, text: 'отдам стул в хорошем состоянии', bot: null });
check('chat clean', res.verdict === 'clean' && res.level === 'medium', `${res.verdict}/${res.level}`);

res = await moderateChatMessage({ senderTg: '700001', wantId: 1, text: 'продаю спайс, лучшая цена', bot: null });
check('chat drugs block', res.verdict === 'block' && res.category === 'drugs', `${res.verdict}/${res.category}`);

res = await moderateChatMessage({
  senderTg: '700003', receiverTg: '700004', wantId: 2, text: 'переведи за доставку', firstMessage: true, bot: null,
});
check('chat first-msg fraud block', res.verdict === 'block' && res.category === 'payment_triggers', `${res.verdict}/${res.category}`);

res = await moderateChatMessage({
  senderTg: '700005', receiverTg: '700006', wantId: 3, text: 'переведи за доставку', firstMessage: false, bot: null,
});
check('chat mid-conv fraud flag', res.verdict === 'flag' && res.category === 'payment_triggers', `${res.verdict}/${res.category}`);

// ── модерация объявления ───────────────────────────────────────────
let threwBlock = null;
try {
  await moderateItem({ senderTg: '700007', title: 'пистолет пневматический', description: '' });
} catch (e) {
  threwBlock = e;
}
check('item weapons block (400)', threwBlock?.status === 400, String(threwBlock?.status));

res = await moderateItem({ senderTg: '700008', title: 'детский велосипед', description: 'самовывоз, состояние отличное' });
check('item clean', res.verdict === 'clean', res.verdict);

// ── очередь и решения админа ───────────────────────────────────────
let queue = await getAdminQueue({ status: 'open' });
check('admin queue has >=2', queue.length >= 2, `n=${queue.length}`);

const reportId = queue[0].id;
await adminConfirmReport(reportId, 'test');
queue = await getAdminQueue({ status: 'open' });
check('queue after confirm', !queue.some((r) => r.id === reportId), 'confirmed removed');

const reportId2 = (await getAdminQueue({ status: 'open' }))[0].id;
await adminDismissReport(reportId2, 'test');
check('report dismissed', !(await getAdminQueue({ status: 'open' })).some((r) => r.id === reportId2));

// ── бан / разбан ───────────────────────────────────────────────────
await adminBanUser('700010', 'тест', 'other', 'test', 7);
check('ban in effect', await isBanned('700010'));
await adminUnbanUser('700010');
check('unban', !(await isBanned('700010')));

// ── авто-бан: 3 жалобы за 30д ─────────────────────────────────────
for (let i = 0; i < 3; i += 1) {
  await moderateChatMessage({ senderTg: '700020', wantId: 10 + i, text: 'переведи за доставку', bot: null });
}
check('auto-ban after 3 flags', await isBanned('700020'));

const bannedRow = await get("SELECT * FROM mod_banned WHERE telegram_id = '700020'");
check('auto-ban reason stored', Boolean(bannedRow?.reason));

// ── заблокированный пользователь получает 403 ─────────────────────
let blocked = false;
try {
  await moderateChatMessage({ senderTg: '700020', wantId: 99, text: 'привет', bot: null });
} catch (e) {
  blocked = e.status === 403;
}
check('banned user rejected (403)', blocked);

// ── trust score сохраняется ────────────────────────────────────────
const trustRow = await get("SELECT * FROM mod_trust WHERE telegram_id = '700001'");
check('trust persisted', Boolean(trustRow && trustRow.level));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
process.exit(failed.length ? 1 : 0);