-- 模组授权令牌。详见 docs/mod-authorization.md
--
-- 一账号至多一条记录，即一账号一设备。
-- 表名与既有列沿用旧实现，仅 username → sub，并补充新列。
CREATE TABLE IF NOT EXISTS mod_tokens (
  token             TEXT PRIMARY KEY,
  sub               TEXT NOT NULL REFERENCES users(sub),
  bound_fingerprint TEXT,
  bound_at          TEXT,
  reset_at          TEXT,
  created_at        TEXT NOT NULL,

  device_name       TEXT NOT NULL DEFAULT '',
  machine_hint      TEXT,        -- 异常检测用，不参与放行判定
  last_seen_at      TEXT,
  current_jti       TEXT,        -- 当前有效 License 的 jti，吊销时用
  revoked_at        TEXT         -- 非空即失效
);

CREATE INDEX IF NOT EXISTS idx_mod_tokens_sub ON mod_tokens(sub);
