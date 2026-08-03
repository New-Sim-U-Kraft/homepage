-- 本地开发用的示例数据。仅供 `pnpm db:seed:local`，不要在生产库执行。
-- 内容是占位性质的，不代表真实文案。

-- 首页公告
INSERT OR REPLACE INTO site_config (key, value) VALUES
 ('announcements', '[{"id":"a1","title":"内测授权已启用","body":"赞助者可在账号中心生成模组令牌。","level":"important","publishedAt":"2026-08-01T00:00:00.000Z"},{"id":"a2","title":"创意工坊开放投稿","body":"欢迎提交你的建筑作品。","level":"info","publishedAt":"2026-07-20T00:00:00.000Z"}]');

-- 更新日志
INSERT OR IGNORE INTO changelog (id, version, title, body, published_at, created_at) VALUES
 ('c1', 'v0.4.0', '新增城市天际线生成', '大幅提升大型建筑群的生成效率。', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
 ('c2', 'v0.3.2', '修复 NBT 解析崩溃', '修复了部分结构文件导致客户端崩溃的问题。', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'),
 ('c3', 'v0.3.0', '创意工坊上线', '支持投稿与在线 3D 预览。', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');

-- 外部模组
INSERT OR IGNORE INTO external_mods (id, data) VALUES
 ('m1', '{"name":"Sim-U-Kraft Legacy","description":"前代版本，仍在维护。","url":"https://example.com/legacy"}'),
 ('m2', '{"name":"NSUK Resource Pack","description":"配套材质包。","url":"https://example.com/rp"}');

-- 开发者
INSERT OR IGNORE INTO developers (slug, data) VALUES
 ('kafei', '{"name":"咖啡","role":"主程","avatar":"","intro":"负责模组主体与后端。","links":[]}'),
 ('menglan', '{"name":"梦蓝","role":"美术","avatar":"","intro":"负责材质与界面视觉。","links":[]}'),
 ('xiaoliang', '{"name":"小亮","role":"策划","avatar":"","intro":"负责玩法设计。","links":[]}');

-- 创意工坊作品
INSERT OR IGNORE INTO workshop_items
 (id, title, category, description, files, external_links, author_sub, author_display_name, status, created_at, updated_at, published_at)
VALUES
 ('w1', '海滨图书馆', 'building',
  '一座三层的现代图书馆，含完整室内。',
  '{"items":[{"name":"library.nbt","kind":"structure","size":184320}]}',
  '[{"label":"蓝奏云","url":"https://example.com/d/library"}]',
  NULL, '示例作者', 'published',
  '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z', '2026-07-12T00:00:00.000Z'),
 ('w2', '中央车站', 'building',
  '带月台与钟楼的火车站。',
  '{"items":[{"name":"station.nbt","kind":"structure","size":512000}]}',
  '[{"label":"GitHub Releases","url":"https://example.com/d/station"}]',
  NULL, '示例作者', 'published',
  '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-07-02T00:00:00.000Z'),
 ('w3', '未过审的草稿', 'building',
  '这条用于验证未发布作品对匿名访客不可见。',
  '{"items":[]}', '[]',
  NULL, '示例作者', 'pending',
  '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z', NULL);
