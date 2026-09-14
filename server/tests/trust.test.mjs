import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = (name) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'trust', name)).href);

// ── textFilter ──────────────────────────────────────────────────────
const tf = await mod('textFilter.js');

test('checkText: кокс → drugs/high', () => {
  const r = tf.checkText('купил кокс вчера');
  assert.equal(r.flagged, true);
  assert.equal(r.type, 'drugs');
  assert.equal(r.severity, 'high');
});

test('checkText: leet-обфускация к0кс → drugs', () => {
  const r = tf.checkText('есть к0кс');
  assert.equal(r.flagged, true);
  assert.equal(r.type, 'drugs');
  assert.ok(r.matched.includes('кокс'));
});

test('checkText: точки к.о.к.с с пробелами → ловится', () => {
  const r = tf.checkText('достану к.о.к.с завтра');
  assert.equal(r.flagged, true);
  assert.equal(r.type, 'drugs');
});

test('checkText: пробельная обфускация "к о к с" → ловится', () => {
  const r = tf.checkText('к о к с');
  assert.equal(r.flagged, true);
  assert.equal(r.type, 'drugs');
});

test('checkText: дубли букв ккоокс → ловится', () => {
  const r = tf.checkText('надёжный поставщик ккоокс');
  assert.equal(r.flagged, true);
  assert.equal(r.type, 'drugs');
});

test('checkText: чистое сообщение', () => {
  const r = tf.checkText('Спасибо за вещь, всё отлично!');
  assert.equal(r.flagged, false);
  assert.equal(r.type, 'clean');
});

test('checkMessageForFraud: платёж в первом сообщении → high', () => {
  const r = tf.checkMessageForFraud('скинь на карту', { firstMessage: true });
  assert.equal(r.flagged, true);
  assert.equal(r.type, 'fraud');
  assert.equal(r.severity, 'high');
});

test('checkMessageForFraud: платёж без эскалации → medium', () => {
  const r = tf.checkMessageForFraud('переведи за доставку', { firstMessage: false, hasLink: false });
  assert.equal(r.flagged, true);
  assert.equal(r.type, 'fraud');
  assert.equal(r.severity, 'medium');
});

test('checkMessageForFraud: фишинг → high', () => {
  const r = tf.checkMessageForFraud('нажми на ссылку и пришли код из смс');
  assert.equal(r.flagged, true);
  assert.equal(r.type, 'phishing');
  assert.equal(r.severity, 'high');
});

test('censorText: заменяет совпадения на [***]', () => {
  const { censored } = tf.censorText('кокс на выходных');
  assert.equal(censored.includes('[***]'), true);
  assert.equal(/кокс/i.test(censored), false);
});

test('censorText: чистое сообщение — без изменений', () => {
  const { censored, count } = tf.censorText('отдам стул в хорошем состоянии');
  assert.equal(count, 0);
  assert.equal(censored, 'отдам стул в хорошем состоянии');
});

// ── linkDetector ────────────────────────────────────────────────────
const ld = await mod('linkDetector.js');

test('detectLinks: обычный URL', () => {
  const links = ld.detectLinks('ссылка https://example.com/page супер');
  assert.equal(links.length, 1);
  assert.equal(links[0].domain, 'example.com');
});

test('detectLinks: whitelist + незнакомый домен', () => {
  const links = ld.detectLinks('https://onliner.by и https://strange.xyz');
  const { allowed, hidden } = ld.checkLinks(links);
  assert.ok(allowed.some((l) => l.domain === 'onliner.by'));
  assert.ok(hidden.some((l) => l.domain === 'strange.xyz'));
});

test('detectLinks: короткая ссылка считается редирект-риском', () => {
  const links = ld.detectLinks('жми сюда bit.ly/abc123');
  assert.ok(links.length >= 1);
  assert.equal(links.some((l) => l.isShort), true);
});

test('maskLinks: ненадёжная ссылка скрывается', () => {
  const text = 'промокод https://evil-shop.ru/x';
  const links = ld.detectLinks(text);
  const { hidden } = ld.checkLinks(links);
  const { censored } = ld.maskLinks(text, hidden);
  assert.ok(censored.includes('[ссылка скрыта]'));
  assert.ok(!censored.includes('evil-shop.ru'));
});

// ── trustScore ──────────────────────────────────────────────────────
const ts = await mod('trustScore.js');

test('trust: нейтральный 45 дней (аватар есть, username нет) → база 50', () => {
  const [score, level] = ts.compute({ acct_age_days: 45, has_avatar: true });
  assert.equal(score, 50);
  assert.equal(level, 'medium');
});

test('trust: 45 дней без профиля → 40 (штраф профиля)', () => {
  const [score, level] = ts.compute({ acct_age_days: 45 });
  assert.equal(score, 40);
  assert.equal(level, 'medium');
});

test('trust: новый аккаунт без профиля → 15, high', () => {
  const [score, level] = ts.compute({ acct_age_days: 3 });
  assert.equal(score, 15);
  assert.equal(level, 'high');
});

test('trust: полный профиль старше 90 дней + 6 сделок → 100', () => {
  const [score, level] = ts.compute({ acct_age_days: 120, has_avatar: true, has_username: true, completed_deals: 6 });
  assert.equal(score, 100);
  assert.equal(level, 'low');
});

test('trust: подтверждённые репорты штрафуют сильнее', () => {
  const [score] = ts.compute({ acct_age_days: 45, has_avatar: true, has_username: true, confirmed_reports_30d: 2 });
  assert.equal(score, 30);
});

test('trust: неподтверждённые репорты — половина веса', () => {
  const [score] = ts.compute({ acct_age_days: 45, has_avatar: true, has_username: true, reports_30d: 2, confirmed_reports_30d: 0 });
  assert.equal(score, 45);
});

test('trust: suspicious first msg — одноразовый штраф 20', () => {
  const [s1] = ts.compute({ acct_age_days: 45, has_avatar: true, has_username: true, suspicious_first_msg: true, first_msg_penalty_applied: false });
  const [s2] = ts.compute({ acct_age_days: 45, has_avatar: true, has_username: true, suspicious_first_msg: true, first_msg_penalty_applied: true });
  assert.equal(s1, 40);
  assert.equal(s2, 60);
});

test('trust: клиентские границы уровней', () => {
  assert.equal(ts.levelFor(100), 'low');
  assert.equal(ts.levelFor(70), 'low');
  assert.equal(ts.levelFor(69), 'medium');
  assert.equal(ts.levelFor(40), 'medium');
  assert.equal(ts.levelFor(39), 'high');
  assert.equal(ts.levelFor(0), 'high');
});