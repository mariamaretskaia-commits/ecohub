-- EcoHub schema for Supabase (Postgres)
-- Paste into: Supabase → SQL Editor → New query → Run

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  eco_coins INTEGER DEFAULT 0,
  items_shared INTEGER DEFAULT 0,
  items_taken INTEGER DEFAULT 0,
  kg_recycled DOUBLE PRECISION DEFAULT 0,
  batteries_recycled INTEGER DEFAULT 0,
  books_saved INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  patronymic TEXT,
  birth_date TEXT,
  phone TEXT,
  phone_verified INTEGER DEFAULT 0,
  consent_at TIMESTAMPTZ,
  nickname TEXT,
  terms_rules_at TIMESTAMPTZ,
  terms_privacy_at TIMESTAMPTZ,
  nudges_disabled INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
  ON users(phone) WHERE phone IS NOT NULL AND phone <> '';

ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS nudges_disabled INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  district TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('free', 'sharing')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'reserved', 'given')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  oblast TEXT DEFAULT 'Гродненская область',
  settlement TEXT DEFAULT 'Гродно',
  photos TEXT,
  unclaimed_delete_at TIMESTAMPTZ,
  unclaimed_nudge_at TIMESTAMPTZ,
  photo_thumbs TEXT,
  mod_status TEXT DEFAULT 'ok'
);

-- Миграция существующих БД: новые колонки и роль-гейт для старых объявлений.
ALTER TABLE IF EXISTS items ADD COLUMN IF NOT EXISTS unclaimed_delete_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS items ADD COLUMN IF NOT EXISTS unclaimed_nudge_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS items ADD COLUMN IF NOT EXISTS photo_thumbs TEXT;
ALTER TABLE IF EXISTS items ADD COLUMN IF NOT EXISTS mod_status TEXT DEFAULT 'ok';

UPDATE items
SET unclaimed_delete_at = NOW() + INTERVAL '21 days'
WHERE unclaimed_delete_at IS NULL
  AND status = 'active'
  AND user_id IN (SELECT id FROM users WHERE telegram_id NOT LIKE 'demo\_%');

CREATE TABLE IF NOT EXISTS recycling_points (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT,
  type TEXT NOT NULL,
  district TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  hours TEXT,
  prices TEXT,
  logistics TEXT,
  description TEXT,
  transit TEXT,
  source_key TEXT,
  short_address TEXT,
  accepts TEXT,
  last_synced TIMESTAMPTZ,
  source TEXT,
  oblast TEXT DEFAULT 'Гродненская область',
  settlement TEXT DEFAULT 'Гродно',
  access_mode TEXT DEFAULT 'counter'
);

CREATE TABLE IF NOT EXISTS eco_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recycling_submissions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  point_id BIGINT NOT NULL REFERENCES recycling_points(id),
  photo_url TEXT,
  weight_kg DOUBLE PRECISION,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS item_wants (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  buyer_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (item_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS item_favorites (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  want_id BIGINT NOT NULL REFERENCES item_wants(id) ON DELETE CASCADE,
  sender_id BIGINT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_want_id_idx ON chat_messages(want_id);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS photo_url TEXT;

ALTER TABLE item_wants ADD COLUMN IF NOT EXISTS owner_last_read_at TIMESTAMPTZ;
ALTER TABLE item_wants ADD COLUMN IF NOT EXISTS buyer_last_read_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS point_suggestions (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  address TEXT NOT NULL,
  contact TEXT,
  status TEXT DEFAULT 'new',
  notified INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE point_suggestions ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

-- Storage: create public bucket "item-photos" in Dashboard → Storage
-- (or run via API after creating bucket in UI)

-- Trust & Safety tables (added by ecohub-trust integration)
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_rules_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_privacy_at TIMESTAMPTZ;

-- Кэш категоризации: имя вещи -> категория (быстрый повтор без ИИ)
CREATE TABLE IF NOT EXISTS categorization_cache (
  name TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  cnt INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Лог категоризации: история для самообучения словаря
CREATE TABLE IF NOT EXISTS categorization_log (
  id BIGSERIAL PRIMARY KEY,
  user_telegram_id TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  category_rules TEXT,
  provider TEXT,
  corrected INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categorization_log_name ON categorization_log(name);
