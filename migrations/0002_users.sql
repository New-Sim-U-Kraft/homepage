-- 用户档案表。
--
-- 身份（账号、密码、2FA、邮箱）全部在 Prism，本表只存「此人在 NSUK 是什么」。
-- 主键是 Prism 的 sub —— 稳定且不随改名变化。
--
-- 刻意不存 password_hash / email：前者已无意义，后者从 Prism userinfo 实时取，
-- 本地留副本只会产生一份会过期的数据。
CREATE TABLE IF NOT EXISTS users (
  sub             TEXT PRIMARY KEY,

  -- Prism 侧字段的本地缓存，登录时同步
  username        TEXT NOT NULL UNIQUE,       -- preferred_username，用于 URL 与展示
  display_name    TEXT NOT NULL DEFAULT '',
  avatar_override TEXT NOT NULL DEFAULT '',   -- 空则回落 Prism picture

  -- 由 Prism 身份组派生，官网不可手改
  role_key        TEXT NOT NULL DEFAULT 'guest' REFERENCES roles(role_key),
  groups_synced_at TEXT,                      -- 最近一次身份组同步时间，供对账使用

  -- 站内属性
  qq              TEXT NOT NULL DEFAULT '',
  intro           TEXT NOT NULL DEFAULT '',
  cover           TEXT NOT NULL DEFAULT '',
  wall_type       TEXT NOT NULL DEFAULT 'none',
  developer_slug  TEXT NOT NULL DEFAULT '',

  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_login_at   TEXT,

  -- Prism 账号被注销时置位。不删行，否则工坊作品与审计会指向空。
  deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_key);
CREATE INDEX IF NOT EXISTS idx_users_synced ON users(groups_synced_at);
