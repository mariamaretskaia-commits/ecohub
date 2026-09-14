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
  nickname TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
  ON users(phone) WHERE phone IS NOT NULL AND phone <> '';

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
  photos TEXT
);

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
