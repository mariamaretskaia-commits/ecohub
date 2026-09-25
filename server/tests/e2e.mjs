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
  notifyAdminsOfUserReport,
} from '../src/trust/pipeline.js';
import { isBanned, insertModMessage, insertReport } from '../src/trust/store.js';
import { __setFetch } from '../src/aiModeration.js';

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

// ── строгий словарь: ваш кейс ───────────────────────────────────────
res = await moderateChatMessage({ senderTg: '700030', receiverTg: '700031', wantId: 30, text: 'хочу вам 10 рублей хотя бы заплатить', bot: null });
check('chat strict payment block', res.verdict === 'block' && res.category === 'payment_solicit', `${res.verdict}/${res.category}`);

res = await moderateChatMessage({ senderTg: '700032', receiverTg: '700033', wantId: 31, text: 'возьму nаркоooтиKi', bot: null });
check('chat obfuscated drugs block', res.verdict === 'block' && res.category === 'drugs', `${res.verdict}/${res.category}`);

res = await moderateChatMessage({ senderTg: '700034', receiverTg: '700035', wantId: 32, text: 'перев0d на карту', bot: null });
check('chat leet+translit block', res.verdict === 'block' && res.category === 'payment_solicit', `${res.verdict}/${res.category}`);

// ── жалоба пользователя → заявка в очереди ──────────────────────────
const repMsg = await insertModMessage({
  senderTelegramId: '700040', receiverTelegramId: '700041', wantId: 40,
  text: 'плачу за доставку', censored: 'плачу за доставку',
  photoUrl: null, hasLink: false, status: 'reported', decidedBy: 'user',
  flagsJson: '["user_report"]', score: 0, level: 'low',
});
const repId = await insertReport({ msgId: repMsg, senderTelegramId: '700040', reporterTelegramId: '700041', category: 'user_report', source: 'user' });
check('user report in open queue', (await getAdminQueue({ status: 'open' })).some((r) => r.id === repId));

// лог не нужен для вызова notify без бота: проверяем только персист
check('user report persisted', Boolean(repId > 0));

// ── пожизненный бан по жалобе (как adban) ───────────────────────────
await adminBanUser('700040', 'Пожизненная блокировка: подтверждённая жалоба в чате', 'user_report', 'test', null);
check('permanent ban in effect', await isBanned('700040'));
const permRow = await get("SELECT * FROM mod_banned WHERE telegram_id = '700040'");
check('permanent ban has no expiry', permRow && !permRow.expires_at);
await adminUnbanUser('700040');

// ── пустое уведомление без бота не падает ───────────────────────────
let notifOk = true;
try {
  await notifyAdminsOfUserReport({ bot: null, modMsgId: repMsg, senderTg: '700040', senderName: 'Тест', body: 'плачу за доставку' });
} catch {
  notifOk = false;
}
check('report notify no-crash without bot', notifOk);

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

// ── ИИ-модерация: недоступна → публикуем с меткой pending ──────────
res = await moderateItem({ senderTg: '700080', title: 'старый комод из дуба', description: 'самовывоз' });
check('item dict-clean + AI unavailable → passed', res.verdict === 'clean', res.verdict);
check('item pendingAiReview метка', Boolean(res.pendingAiReview), String(res.pendingAiReview));
const pendRow = await get("SELECT * FROM mod_messages WHERE content = 'старый комод из дуба самовывоз' ORDER BY id DESC LIMIT 1");
check('item mod_message status=pending', Boolean(pendRow && pendRow.status === 'pending'), pendRow?.status);
check('item flags_json содержит ai_unavailable', Boolean(pendRow && String(pendRow.flags_json).includes('ai_unavailable')), pendRow?.flags_json);

res = await moderateChatMessage({ senderTg: '700081', receiverTg: '700082', wantId: 81, text: 'отдам кресло, выкинуть жалко', firstMessage: true, bot: null });
check('chat clean + AI pending', res.verdict === 'clean' && res.pendingAiReview === true, `${res.verdict}/${res.pendingAiReview}`);

// ── ИИ-блок через Nemotron (mock fetch) ─────────────────────────────
process.env.OPENROUTER_API_KEY = 'sk-test-e2e';
try {
  __setFetch((url, opts) => {
    if (String(url).includes('openrouter.ai')) {
      const bodyText = typeof opts?.body === 'string' ? opts.body : '';
      const verdict = bodyText.includes('обычное сообщение')
        ? 'User Safety: unsafe\nSafety Categories: Profanity'
        : 'User Safety: unsafe\nSafety Categories: weapons';
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: verdict } }] }),
      });
    }
    return Promise.resolve({ status: 401, json: () => Promise.resolve({}) });
  });
  let aiBlock = null;
  try {
    await moderateItem({ senderTg: '700083', title: 'ничего противозаконного', description: '' });
  } catch (e) {
    aiBlock = e;
  }
  check('item AI (mock Nemotron) block → 400', Boolean(aiBlock && aiBlock.status === 400), String(aiBlock?.status));

  let aiReview = await moderateChatMessage({ senderTg: '700084', receiverTg: '700085', wantId: 84, text: 'обычное сообщение', firstMessage: true, bot: null });
  check('chat AI review → flag/requiresManual', aiReview.verdict === 'flag' && Boolean(aiReview.requiresManual), `${aiReview.verdict}/${aiReview.requiresManual}`);
} finally {
  delete process.env.OPENROUTER_API_KEY;
  __setFetch(undefined);
  await new Promise((r) => setTimeout(r, 20));
}

res = await moderateChatMessage({ senderTg: '700090', receiverTg: '700091', wantId: 90, text: 'отдам вазу', bot: null });
check('chat clean after AI reset (no key)', res.verdict === 'clean', res.verdict);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
process.exit(failed.length ? 1 : 0);