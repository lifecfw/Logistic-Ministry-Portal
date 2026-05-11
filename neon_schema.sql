-- ============================================================
--  Arab First — AFMOD  |  Neon PostgreSQL Schema
--  انسخ هذا الملف كامل وشغّله في Neon SQL Editor
-- ============================================================

-- ── Auth codes (رموز التحقق المؤقتة) ──────────────────────
CREATE TABLE IF NOT EXISTS auth_codes (
  user_id    TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  user_data  JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts   INT NOT NULL DEFAULT 0
);

-- ── Known users (كل لاعب سجّل دخول) ──────────────────────
CREATE TABLE IF NOT EXISTS known_users (
  user_id      TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url   TEXT NOT NULL DEFAULT '',
  last_seen_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_known_users_username ON known_users(lower(username));

-- ── Twitter profiles ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tw_profiles (
  user_id             TEXT PRIMARY KEY,
  discord_username    TEXT NOT NULL,
  username            TEXT UNIQUE NOT NULL,
  display_name        TEXT NOT NULL,
  bio                 TEXT DEFAULT '',
  avatar_base64       TEXT,
  header_base64       TEXT,
  verified            BOOLEAN DEFAULT FALSE,
  password            TEXT,
  fake_follower_count INT DEFAULT 0,
  followers           JSONB DEFAULT '[]',
  following           JSONB DEFAULT '[]',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tw_tweets (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL,
  content      TEXT DEFAULT '',
  image_base64 TEXT,
  likes        JSONB DEFAULT '[]',
  retweeted_by JSONB DEFAULT '[]',
  reply_to     TEXT,
  retweet_of   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tw_notifications (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id   TEXT NOT NULL,
  tweet_id     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  read         BOOLEAN DEFAULT FALSE
);

-- ── Messaging system ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS msg_profiles (
  user_id       TEXT PRIMARY KEY,
  phone         TEXT UNIQUE NOT NULL,
  name          TEXT DEFAULT '',
  family_name   TEXT DEFAULT '',
  bio           TEXT DEFAULT '',
  avatar_base64 TEXT,
  username      TEXT DEFAULT '',
  display_name  TEXT DEFAULT '',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS msg_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO msg_config (key, value) VALUES ('next_phone', '1001') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS msg_chats (
  chat_key    TEXT NOT NULL,
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  content     TEXT NOT NULL,
  type        TEXT DEFAULT 'text',
  sender_name TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_chats_key ON msg_chats(chat_key);

CREATE TABLE IF NOT EXISTS msg_groups (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  avatar_base64 TEXT,
  admin_id      TEXT NOT NULL,
  members       JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Business system ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_state (
  user_id            TEXT NOT NULL,
  business_id        TEXT NOT NULL,
  business_type      TEXT NOT NULL,
  inventory_pct      REAL NOT NULL DEFAULT 100,
  last_refill_at     BIGINT NOT NULL DEFAULT 0,
  accumulated_profit BIGINT NOT NULL DEFAULT 0,
  last_sync_at       BIGINT NOT NULL DEFAULT 0,
  weekly_bonus_at    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, business_id, business_type)
);

CREATE TABLE IF NOT EXISTS business_profit_log (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  business_id   TEXT NOT NULL,
  business_type TEXT NOT NULL,
  amount        BIGINT NOT NULL,
  note          TEXT DEFAULT '',
  logged_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_profit_log ON business_profit_log(user_id, business_id, business_type, logged_at);

CREATE TABLE IF NOT EXISTS customer_purchases (
  id             SERIAL PRIMARY KEY,
  buyer_user_id  TEXT NOT NULL,
  buyer_username TEXT NOT NULL DEFAULT '',
  seller_user_id TEXT NOT NULL,
  business_id    TEXT NOT NULL,
  business_type  TEXT NOT NULL,
  item_name      TEXT NOT NULL DEFAULT '',
  price          BIGINT NOT NULL,
  purchased_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_purchases_seller ON customer_purchases(seller_user_id, purchased_at);

-- ── House ownership & rental ───────────────────────────────
CREATE TABLE IF NOT EXISTS house_ownership (
  id                 SERIAL PRIMARY KEY,
  house_id           TEXT NOT NULL,
  owner_user_id      TEXT NOT NULL,
  owner_username     TEXT DEFAULT '',
  owner_display_name TEXT DEFAULT '',
  purchased_at       BIGINT NOT NULL,
  UNIQUE (house_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS house_rental_listings (
  id                 SERIAL PRIMARY KEY,
  house_id           TEXT NOT NULL,
  owner_user_id      TEXT NOT NULL,
  owner_username     TEXT NOT NULL DEFAULT '',
  owner_display_name TEXT NOT NULL DEFAULT '',
  daily_price        BIGINT NOT NULL DEFAULT 0,
  is_available       BOOLEAN NOT NULL DEFAULT false,
  notes              TEXT NOT NULL DEFAULT '',
  updated_at         BIGINT NOT NULL DEFAULT 0,
  UNIQUE (house_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS house_rental_bookings (
  id                  SERIAL PRIMARY KEY,
  listing_id          INTEGER NOT NULL,
  house_id            TEXT NOT NULL,
  renter_user_id      TEXT NOT NULL,
  renter_username     TEXT DEFAULT '',
  renter_display_name TEXT DEFAULT '',
  days                INTEGER NOT NULL,
  daily_price         BIGINT NOT NULL,
  total_price         BIGINT NOT NULL,
  started_at          BIGINT NOT NULL,
  expires_at          BIGINT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS house_rental_state (
  house_id           TEXT NOT NULL,
  owner_user_id      TEXT NOT NULL,
  accumulated_profit BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (house_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS house_rental_profit_log (
  id            SERIAL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  house_id      TEXT NOT NULL,
  amount        BIGINT NOT NULL,
  note          TEXT DEFAULT '',
  logged_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_house_rental_log ON house_rental_profit_log(owner_user_id, house_id, logged_at);

-- ── Bank owner ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_owner (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  username     TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  purchased_at BIGINT NOT NULL
);

-- ── Manufacturing system ───────────────────────────────────
CREATE TABLE IF NOT EXISTS manufacture_resources (
  user_id          TEXT PRIMARY KEY,
  discord_username TEXT NOT NULL DEFAULT '',
  steel            INTEGER NOT NULL DEFAULT 0,
  aluminum         INTEGER NOT NULL DEFAULT 0,
  plastic          INTEGER NOT NULL DEFAULT 0,
  iron             INTEGER NOT NULL DEFAULT 0,
  coal             INTEGER NOT NULL DEFAULT 0,
  weapon_count     INTEGER NOT NULL DEFAULT 0,
  last_mined_at    BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS manufacture_tables (
  user_id      TEXT PRIMARY KEY,
  purchased_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS manufacture_weapons (
  user_id    TEXT PRIMARY KEY,
  crafted_at BIGINT NOT NULL
);

-- ── Marketplace ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id                  SERIAL PRIMARY KEY,
  seller_user_id      TEXT NOT NULL,
  seller_username     TEXT NOT NULL DEFAULT '',
  seller_display_name TEXT NOT NULL DEFAULT '',
  item_type           TEXT NOT NULL,
  item_name           TEXT NOT NULL,
  quantity            INTEGER NOT NULL DEFAULT 1,
  price               BIGINT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          BIGINT NOT NULL,
  sold_at             BIGINT
);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_status ON marketplace_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_seller ON marketplace_listings(seller_user_id, status);

CREATE TABLE IF NOT EXISTS marketplace_transactions (
  id                 SERIAL PRIMARY KEY,
  listing_id         INTEGER NOT NULL,
  buyer_user_id      TEXT NOT NULL,
  buyer_username     TEXT NOT NULL DEFAULT '',
  buyer_display_name TEXT NOT NULL DEFAULT '',
  seller_user_id     TEXT NOT NULL,
  seller_username    TEXT NOT NULL DEFAULT '',
  item_type          TEXT NOT NULL,
  item_name          TEXT NOT NULL,
  quantity           INTEGER NOT NULL DEFAULT 1,
  price              BIGINT NOT NULL,
  payment_status     TEXT NOT NULL DEFAULT 'ok',
  bought_at          BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_tx_buyer  ON marketplace_transactions(buyer_user_id,  bought_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_tx_seller ON marketplace_transactions(seller_user_id, bought_at DESC);

-- ── Gang system ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gangs (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  president_id           TEXT NOT NULL,
  president_username     TEXT NOT NULL DEFAULT '',
  president_display_name TEXT NOT NULL DEFAULT '',
  vp_id                  TEXT NOT NULL DEFAULT '',
  vp_username            TEXT NOT NULL DEFAULT '',
  vp_display_name        TEXT NOT NULL DEFAULT '',
  color                  TEXT NOT NULL DEFAULT '#ef4444',
  logo_base64            TEXT,
  treasury               BIGINT NOT NULL DEFAULT 0,
  radius_pct             REAL NOT NULL DEFAULT 0.08,
  created_at             BIGINT NOT NULL,
  created_by             TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS gang_members (
  gang_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  username     TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    BIGINT NOT NULL,
  PRIMARY KEY (gang_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gang_members_user ON gang_members(user_id);

CREATE TABLE IF NOT EXISTS gang_weapons (
  id          SERIAL PRIMARY KEY,
  gang_id     TEXT NOT NULL,
  weapon_name TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  added_by    TEXT NOT NULL DEFAULT '',
  added_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gang_weapons_gang ON gang_weapons(gang_id);

CREATE TABLE IF NOT EXISTS gang_resources (
  gang_id  TEXT PRIMARY KEY,
  steel    INTEGER NOT NULL DEFAULT 0,
  aluminum INTEGER NOT NULL DEFAULT 0,
  plastic  INTEGER NOT NULL DEFAULT 0,
  iron     INTEGER NOT NULL DEFAULT 0,
  coal     INTEGER NOT NULL DEFAULT 0,
  weapons  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gang_treasury_log (
  id             SERIAL PRIMARY KEY,
  gang_id        TEXT NOT NULL,
  type           TEXT NOT NULL,
  amount         BIGINT NOT NULL,
  actor_username TEXT NOT NULL DEFAULT '',
  note           TEXT DEFAULT '',
  logged_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gang_treasury_log ON gang_treasury_log(gang_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS gang_log (
  id             SERIAL PRIMARY KEY,
  gang_id        TEXT NOT NULL,
  action         TEXT NOT NULL,
  actor_username TEXT NOT NULL DEFAULT '',
  details        TEXT DEFAULT '',
  logged_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gang_log ON gang_log(gang_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS gang_sprays (
  id         SERIAL PRIMARY KEY,
  gang_id    TEXT NOT NULL,
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  sprayed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gang_sprays_gang ON gang_sprays(gang_id);

-- ============================================================
--  انتهى الملف — كل الجداول تُنشأ إذا لم تكن موجودة
-- ============================================================
