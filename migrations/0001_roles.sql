-- 身份组与权限。
--
-- 角色本身由 Prism 团队身份组决定（设计条目 C6），官网没有任何分配角色的入口。
-- 本表只回答「这个等级能做什么」，即 level 与 capability 的映射。
CREATE TABLE IF NOT EXISTS roles (
  role_key    TEXT PRIMARY KEY,
  level       INTEGER NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]'   -- JSON 数组；'["*"]' = 全部
);

INSERT OR IGNORE INTO roles (role_key, level, name, permissions) VALUES
 ('guest',     0, '游客',   '[]'),
 ('sponsor',   1, '赞助者', '[]'),
 ('staff',     2, '客服',   '["feedback.manage","workshop.review"]'),
 ('developer', 3, '开发者', '["feedback.manage","workshop.review","changelog.manage","mods.manage","developers.manage"]'),
 ('admin',     4, '管理员', '["*"]');
