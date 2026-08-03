-- 内容与业务数据。
--
-- 拆列口径（设计条目 C10）：需要按状态 / 时间筛选或统计的拆成正规列，
-- 纯展示且结构自由的保留 JSON blob。

-- ─── 创意工坊 ───
-- 结构文件仅供站内预览，下载一律走投稿者提供的站外链接（设计条目 W2/W5）。
CREATE TABLE IF NOT EXISTS workshop_items (
  id                  TEXT PRIMARY KEY,
  draft_id            TEXT,
  title               TEXT NOT NULL DEFAULT '',
  category            TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  files               TEXT NOT NULL DEFAULT '{}',  -- JSON：天然是结构化附件清单
  external_links      TEXT NOT NULL DEFAULT '[]',  -- JSON：至少一条，投稿时校验
  author_sub          TEXT REFERENCES users(sub),
  author_display_name TEXT NOT NULL DEFAULT '',    -- 冗余快照，作者注销后仍可展示
  status              TEXT NOT NULL DEFAULT 'pending',
  review_reason       TEXT NOT NULL DEFAULT '',
  reviewed_by         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  reviewed_at         TEXT,
  published_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_workshop_status ON workshop_items(status);
CREATE INDEX IF NOT EXISTS idx_workshop_author ON workshop_items(author_sub);

-- ─── 反馈 ───
-- 原实现整体存 JSON，改为正规列：客服要按状态和时间筛选。
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  author_sub  TEXT REFERENCES users(sub),
  category    TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  contact     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',   -- open / resolved / rejected
  reply       TEXT NOT NULL DEFAULT '',
  handled_by  TEXT,
  created_at  TEXT NOT NULL,
  handled_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);

-- ─── 更新日志 ───
-- 同样拆列：首页要按版本与时间倒序取最近若干条。
CREATE TABLE IF NOT EXISTS changelog (
  id           TEXT PRIMARY KEY,
  version      TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changelog_published ON changelog(published_at);

-- ─── 外部模组与开发者 ───
-- 纯展示内容，结构自由，保留 JSON。
CREATE TABLE IF NOT EXISTS external_mods (
  id   TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS developers (
  slug TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- ─── 站点配置 ───
-- License 有效期、换绑冷却等运行期可调参数都在这里，避免改代码重新部署。
CREATE TABLE IF NOT EXISTS site_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL   -- JSON
);

INSERT OR IGNORE INTO site_config (key, value) VALUES
 ('license_ttl_hours',      '24'),
 ('rebind_cooldown_hours',  '24'),
 ('offline_grace_days',     '3'),
 ('announcements',          '[]');

-- ─── 审计日志 ───
-- actor 刻意不加外键：账号注销后审计历史必须仍然可查。
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
