/**
 * Единый async-доступ к БД.
 * - Без DATABASE_URL: SQLite (локально)
 * - С DATABASE_URL: Postgres (Supabase)
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usePg = Boolean(process.env.DATABASE_URL);

let sqlite;
let pool;

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export function adaptSql(sql) {
  if (!usePg) return sql;
  let s = sql;
  s = s.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
  if (/INSERT OR REPLACE INTO meta/i.test(s)) {
    s = s.replace(/INSERT OR REPLACE INTO meta/gi, 'INSERT INTO meta');
    if (!/ON CONFLICT/i.test(s)) {
      s = `${s.replace(/;?\s*$/, '')} ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    }
  }
  s = s.replace(/datetime\('now',\s*'-1 day'\)/gi, "(NOW() - INTERVAL '1 day')");
  s = s.replace(/datetime\('now'\)/gi, 'NOW()');
  if (/INSERT INTO item_wants/i.test(s) && !/ON CONFLICT/i.test(s)) {
    s = `${s.replace(/;?\s*$/, '')} ON CONFLICT (item_id, buyer_id) DO NOTHING`;
  }
  return s;
}

async function initSqlite() {
  const Database = (await import('better-sqlite3')).default;
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  sqlite = new Database(path.join(dataDir, 'eco-grodno.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  ensureSqliteSchema(sqlite);
}

async function initPg() {
  const pg = await import('pg');
  pool = new pg.default.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === '0' ? false : { rejectUnauthorized: false },
    max: 8,
  });
  const schemaPath = path.join(__dirname, '..', 'sql', 'supabase-schema.sql');
  if (fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('✅ Postgres schema ready');
  }
}

function ensureSqliteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      eco_coins INTEGER DEFAULT 0,
      items_shared INTEGER DEFAULT 0,
      items_taken INTEGER DEFAULT 0,
      kg_recycled REAL DEFAULT 0,
      batteries_recycled INTEGER DEFAULT 0,
      books_saved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      district TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('free', 'sharing')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'reserved', 'given')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS recycling_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      organization TEXT,
      type TEXT NOT NULL,
      district TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      address TEXT NOT NULL,
      phone TEXT,
      website TEXT,
      hours TEXT,
      prices TEXT,
      logistics TEXT,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS eco_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS recycling_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      point_id INTEGER NOT NULL REFERENCES recycling_points(id),
      photo_url TEXT,
      weight_kg REAL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS item_wants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id),
      buyer_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(item_id, buyer_id)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const pointCols = db.prepare('PRAGMA table_info(recycling_points)').all().map((c) => c.name);
  for (const [col, def] of [
    ['district', 'TEXT'], ['organization', 'TEXT'], ['transit', 'TEXT'],
    ['source_key', 'TEXT'], ['short_address', 'TEXT'], ['accepts', 'TEXT'],
    ['last_synced', 'TEXT'], ['oblast', "TEXT DEFAULT 'Гродненская область'"],
    ['settlement', "TEXT DEFAULT 'Гродно'"], ['access_mode', "TEXT DEFAULT 'counter'"],
  ]) {
    if (!pointCols.includes(col)) db.exec(`ALTER TABLE recycling_points ADD COLUMN ${col} ${def}`);
  }

  const itemCols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  if (!itemCols.includes('oblast')) db.exec("ALTER TABLE items ADD COLUMN oblast TEXT DEFAULT 'Гродненская область'");
  if (!itemCols.includes('settlement')) db.exec("ALTER TABLE items ADD COLUMN settlement TEXT DEFAULT 'Гродно'");
  if (!itemCols.includes('photos')) db.exec('ALTER TABLE items ADD COLUMN photos TEXT');

  const legacy = db.prepare(`
    SELECT id, photo_url FROM items
    WHERE (photos IS NULL OR photos = '') AND photo_url IS NOT NULL AND photo_url != ''
  `).all();
  const upd = db.prepare('UPDATE items SET photos = ? WHERE id = ?');
  for (const row of legacy) upd.run(JSON.stringify([row.photo_url]), row.id);

  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  for (const [col, def] of [
    ['patronymic', 'TEXT'], ['birth_date', 'TEXT'], ['phone', 'TEXT'],
    ['phone_verified', 'INTEGER DEFAULT 0'], ['consent_at', 'TEXT'], ['nickname', 'TEXT'],
  ]) {
    if (!userCols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  }

  db.exec(`
    UPDATE users
    SET nickname = TRIM(TRIM(COALESCE(last_name, '')) || ' ' || TRIM(COALESCE(first_name, '')) || ' ' || TRIM(COALESCE(patronymic, '')))
    WHERE (nickname IS NULL OR nickname = '')
      AND TRIM(COALESCE(first_name, '') || COALESCE(last_name, '')) != ''
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
    ON users(phone) WHERE phone IS NOT NULL AND phone != ''
  `);
  db.exec(`UPDATE items SET type = 'free' WHERE type = 'sharing'`);
}

let ready;
export function initDb() {
  if (!ready) ready = usePg ? initPg() : initSqlite();
  return ready;
}

export function isPostgres() {
  return usePg;
}

export async function get(sql, ...params) {
  await initDb();
  const q = adaptSql(sql);
  if (usePg) {
    const r = await pool.query(toPgPlaceholders(q), params);
    return r.rows[0] || undefined;
  }
  return sqlite.prepare(q).get(...params);
}

export async function all(sql, ...params) {
  await initDb();
  const q = adaptSql(sql);
  if (usePg) {
    const r = await pool.query(toPgPlaceholders(q), params);
    return r.rows;
  }
  return sqlite.prepare(q).all(...params);
}

export async function run(sql, ...params) {
  await initDb();
  const q = adaptSql(sql);
  if (usePg) {
    let pgSql = toPgPlaceholders(q);
    if (/^\s*INSERT/i.test(pgSql) && !/RETURNING/i.test(pgSql) && !/ON CONFLICT/i.test(pgSql)) {
      pgSql = `${pgSql.replace(/;?\s*$/, '')} RETURNING id`;
    }
    const r = await pool.query(pgSql, params);
    return {
      lastInsertRowid: r.rows[0]?.id ?? null,
      changes: r.rowCount || 0,
    };
  }
  const info = sqlite.prepare(q).run(...params);
  return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
}

export async function exec(sql) {
  await initDb();
  if (usePg) {
    await pool.query(sql);
    return;
  }
  sqlite.exec(sql);
}

export default { get, all, run, exec, initDb, isPostgres };
