import '../src/loadEnv.js';
import { get } from '../src/db.js';

const checks = [
  {
    name: 'isBanned (без "" сравнения)',
    sql: "EXPLAIN SELECT telegram_id FROM mod_banned WHERE telegram_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
    params: ['0'],
  },
  {
    name: 'buildSignals reports (30 day)',
    sql: "EXPLAIN SELECT COUNT(*) AS total FROM mod_reports WHERE sender_telegram_id = ? AND created_at > datetime('now', '-30 day')",
    params: ['0'],
  },
  {
    name: 'buildSignals confirmed (30 day)',
    sql: "EXPLAIN SELECT COUNT(*) AS total FROM mod_reports WHERE sender_telegram_id = ? AND status = 'confirmed' AND created_at > datetime('now', '-30 day')",
    params: ['0'],
  },
  {
    name: 'countOpenReports (30 day)',
    sql: "EXPLAIN SELECT COUNT(*) AS total FROM mod_reports WHERE sender_telegram_id = ? AND status = 'open' AND created_at > datetime('now', '-30 day')",
    params: ['0'],
  },
  {
    name: 'items INSERT (+21 days)',
    sql: "EXPLAIN INSERT INTO items (user_id, title, description, photo_url, photos, oblast, settlement, district, category, type, unclaimed_delete_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+21 days'))",
    params: ['0', 't', 'd', null, null, 'Гродненская область', 'Гродно', 'Центр', 'Одежда', 'free'],
  },
];

let failed = 0;
for (const c of checks) {
  try {
    await get(c.sql, ...c.params);
    console.log(`OK   ${c.name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.name}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);