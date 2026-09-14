/**
 * DDL для таблиц Trust & Safety.
 * - TRUST_SQLITE_DDL — локальная SQLite (server/data/eco-grodno.db)
 * - TRUST_PG_DDL     — продакшн Postgres (Render/Supabase)
 *
 * Таблицы версионируются кодом: initDb() применяет их при каждом старте.
 */

export const TRUST_SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS mod_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_type TEXT NOT NULL,
  sender_telegram_id TEXT,
  receiver_telegram_id TEXT,
  want_id INTEGER,
  item_id INTEGER,
  content TEXT,
  censored TEXT,
  photo_url TEXT,
  has_link INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  decided_by TEXT DEFAULT 'filter',
  flags_json TEXT,
  score INTEGER,
  level TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mod_messages_sender ON mod_messages(sender_telegram_id);

CREATE TABLE IF NOT EXISTS mod_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES mod_messages(id),
  sender_telegram_id TEXT,
  reporter_telegram_id TEXT,
  category TEXT,
  source TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  decision TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mod_reports_sender ON mod_reports(sender_telegram_id);
CREATE INDEX IF NOT EXISTS idx_mod_reports_status ON mod_reports(status);

CREATE TABLE IF NOT EXISTS mod_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  target_telegram_id TEXT,
  actor TEXT,
  message_id INTEGER,
  detail_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mod_trust (
  telegram_id TEXT PRIMARY KEY,
  score INTEGER,
  level TEXT,
  signals_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mod_banned (
  telegram_id TEXT PRIMARY KEY,
  reason TEXT,
  category TEXT,
  banned_by TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

export const TRUST_PG_DDL = `
CREATE TABLE IF NOT EXISTS mod_messages (
  id BIGSERIAL PRIMARY KEY,
  entry_type TEXT NOT NULL,
  sender_telegram_id TEXT,
  receiver_telegram_id TEXT,
  want_id BIGINT,
  item_id BIGINT,
  content TEXT,
  censored TEXT,
  photo_url TEXT,
  has_link INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  decided_by TEXT DEFAULT 'filter',
  flags_json TEXT,
  score INTEGER,
  level TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mod_messages_sender ON mod_messages(sender_telegram_id);

CREATE TABLE IF NOT EXISTS mod_reports (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT REFERENCES mod_messages(id),
  sender_telegram_id TEXT,
  reporter_telegram_id TEXT,
  category TEXT,
  source TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  decision TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mod_reports_sender ON mod_reports(sender_telegram_id);
CREATE INDEX IF NOT EXISTS idx_mod_reports_status ON mod_reports(status);

CREATE TABLE IF NOT EXISTS mod_log (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  target_telegram_id TEXT,
  actor TEXT,
  message_id BIGINT,
  detail_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_trust (
  telegram_id TEXT PRIMARY KEY,
  score INTEGER,
  level TEXT,
  signals_json TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_banned (
  telegram_id TEXT PRIMARY KEY,
  reason TEXT,
  category TEXT,
  banned_by TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;