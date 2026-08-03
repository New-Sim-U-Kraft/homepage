// 管理后台。
//
// 注意这里**没有任何修改用户角色的端点**：角色由 Prism 团队身份组派生
// （设计条目 C6），要调整某人的权限得去 Prism 的团队页面操作。
// 官网若也能改，两边就会各有一份真相，迟早不一致。
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { requireCap } from '../lib/rbac'
import { CAPS } from '../lib/roles'
import { getConfig, nowIso, parseJson, parsePaging } from '../lib/db'
import { AUDIT, recordAudit } from '../lib/audit'

const r = new Hono<AppBindings>()

// ─────────────────────────────────────────────────────────────
// 反馈处理
// ─────────────────────────────────────────────────────────────

interface AdminFeedbackRow {
  id: string
  author_sub: string | null
  category: string
  title: string
  content: string
  contact: string
  status: string
  reply: string
  handled_by: string | null
  created_at: string
  handled_at: string | null
  author_name: string | null
}

r.get('/feedback', requireCap(CAPS.FEEDBACK_MANAGE), async (c) => {
  const { limit, offset } = parsePaging(c.req.query())
  const status = c.req.query('status')?.trim() ?? ''

  const where = status ? 'WHERE f.status = ?' : ''
  const binds: unknown[] = status ? [status] : []

  const { results } = await c.env.DB.prepare(
    `SELECT f.*, u.display_name AS author_name
       FROM feedback f LEFT JOIN users u ON u.sub = f.author_sub
       ${where}
      ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<AdminFeedbackRow>()

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM feedback f ${where}`)
    .bind(...binds)
    .first<{ n: number }>()

  return c.json({
    ok: true,
    total: total?.n ?? 0,
    items: results.map((f) => ({
      id: f.id,
      category: f.category,
      title: f.title,
      content: f.content,
      contact: f.contact,
      status: f.status,
      reply: f.reply,
      // 作者可能已在 Prism 侧注销，档案行还在但没有名字
      authorName: f.author_name ?? '已注销用户',
      createdAt: f.created_at,
      handledAt: f.handled_at,
    })),
  })
})

r.patch('/feedback/:id', requireCap(CAPS.FEEDBACK_MANAGE), async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const body = await c.req
    .json<{ status?: string; reply?: string }>()
    .catch((): { status?: string; reply?: string } => ({}))

  const status = String(body.status ?? '').trim()
  if (!['open', 'resolved', 'rejected'].includes(status)) {
    return c.json({ ok: false, error: '无效的状态' }, 400)
  }

  const result = await c.env.DB.prepare(
    `UPDATE feedback SET status = ?, reply = ?, handled_by = ?, handled_at = ? WHERE id = ?`,
  )
    .bind(status, String(body.reply ?? '').slice(0, 1000), user.sub, nowIso(), id)
    .run()

  if (!result.meta.changes) return c.json({ ok: false, error: '反馈不存在' }, 404)

  await recordAudit(c.env.DB, {
    actor: user.sub,
    action: AUDIT.FEEDBACK_HANDLE,
    target: id,
    detail: { status },
  })
  return c.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// 工坊审核
// ─────────────────────────────────────────────────────────────

r.get('/workshop', requireCap(CAPS.WORKSHOP_REVIEW), async (c) => {
  const { limit, offset } = parsePaging(c.req.query())
  const status = c.req.query('status')?.trim() || 'pending'

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, category, description, external_links, author_display_name,
            status, review_reason, created_at
       FROM workshop_items WHERE status = ?
      ORDER BY created_at ASC LIMIT ? OFFSET ?`,
  )
    .bind(status, limit, offset)
    .all<{
      id: string
      title: string
      category: string
      description: string
      external_links: string
      author_display_name: string
      status: string
      review_reason: string
      created_at: string
    }>()

  return c.json({
    ok: true,
    items: results.map((w) => ({
      id: w.id,
      title: w.title,
      category: w.category,
      description: w.description,
      // 审核时要人工核对外链与上传文件是否一致，所以这里必须给出链接
      externalLinks: parseJson(w.external_links, [], `workshop.${w.id}.links`),
      authorName: w.author_display_name,
      status: w.status,
      reviewReason: w.review_reason,
      createdAt: w.created_at,
    })),
  })
})

r.patch('/workshop/:id', requireCap(CAPS.WORKSHOP_REVIEW), async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const body = await c.req
    .json<{ status?: string; reason?: string }>()
    .catch((): { status?: string; reason?: string } => ({}))

  const status = String(body.status ?? '').trim()
  if (!['published', 'rejected', 'pending'].includes(status)) {
    return c.json({ ok: false, error: '无效的状态' }, 400)
  }

  const now = nowIso()
  const result = await c.env.DB.prepare(
    `UPDATE workshop_items
        SET status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?,
            published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN ? ELSE published_at END
      WHERE id = ?`,
  )
    .bind(status, String(body.reason ?? '').slice(0, 500), user.sub, now, now, status, now, id)
    .run()

  if (!result.meta.changes) return c.json({ ok: false, error: '作品不存在' }, 404)

  await recordAudit(c.env.DB, {
    actor: user.sub,
    action: AUDIT.WORKSHOP_REVIEW,
    target: id,
    detail: { status, reason: body.reason ?? '' },
  })
  return c.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// 更新日志
// ─────────────────────────────────────────────────────────────

r.post('/changelog', requireCap(CAPS.CHANGELOG_MANAGE), async (c) => {
  const user = c.get('user')!
  const body = await c.req
    .json<{ version?: string; title?: string; body?: string; publishedAt?: string }>()
    .catch(() => ({}) as Record<string, string>)

  const version = String(body.version ?? '').trim().slice(0, 32)
  const title = String(body.title ?? '').trim().slice(0, 120)
  if (!version || !title) return c.json({ ok: false, error: '版本号与标题不能为空' }, 400)

  const id = crypto.randomUUID()
  const now = nowIso()
  await c.env.DB.prepare(
    'INSERT INTO changelog (id, version, title, body, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, version, title, String(body.body ?? '').slice(0, 5000), body.publishedAt || now, now)
    .run()

  await recordAudit(c.env.DB, { actor: user.sub, action: AUDIT.CHANGELOG_CREATE, target: id })
  return c.json({ ok: true, id })
})

r.delete('/changelog/:id', requireCap(CAPS.CHANGELOG_MANAGE), async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const result = await c.env.DB.prepare('DELETE FROM changelog WHERE id = ?').bind(id).run()
  if (!result.meta.changes) return c.json({ ok: false, error: '记录不存在' }, 404)

  await recordAudit(c.env.DB, { actor: user.sub, action: AUDIT.CHANGELOG_DELETE, target: id })
  return c.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// 站点配置（公告等运行期可调参数）
// ─────────────────────────────────────────────────────────────

/** 允许后台改的键。白名单而非黑名单：新增配置项默认不可从后台改 */
const EDITABLE_CONFIG = new Set([
  'announcements',
  'license_ttl_hours',
  'rebind_cooldown_hours',
  'offline_grace_days',
])

r.get('/config', requireCap(CAPS.SITE_CONFIGURE), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM site_config').all<{
    key: string
    value: string
  }>()
  return c.json({
    ok: true,
    config: Object.fromEntries(
      results
        .filter((row) => EDITABLE_CONFIG.has(row.key))
        .map((row) => [row.key, parseJson<unknown>(row.value, null, `site_config.${row.key}`)]),
    ),
  })
})

r.put('/config/:key', requireCap(CAPS.SITE_CONFIGURE), async (c) => {
  const user = c.get('user')!
  const key = c.req.param('key') ?? ''
  if (!EDITABLE_CONFIG.has(key)) return c.json({ ok: false, error: '该配置项不可修改' }, 400)

  const body = await c.req.json<{ value?: unknown }>().catch(() => ({}) as { value?: unknown })
  if (body.value === undefined) return c.json({ ok: false, error: '缺少 value' }, 400)

  await c.env.DB.prepare('INSERT OR REPLACE INTO site_config (key, value) VALUES (?, ?)')
    .bind(key, JSON.stringify(body.value))
    .run()

  await recordAudit(c.env.DB, {
    actor: user.sub,
    action: AUDIT.SITE_CONFIG_UPDATE,
    target: key,
    detail: body.value,
  })
  return c.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// 审计与用户（只读）
// ─────────────────────────────────────────────────────────────

r.get('/audit', requireCap(CAPS.AUDIT_VIEW), async (c) => {
  const { limit, offset } = parsePaging(c.req.query(), 100)
  const action = c.req.query('action')?.trim() ?? ''

  const where = action ? 'WHERE action LIKE ?' : ''
  const binds: unknown[] = action ? [`${action}%`] : []

  const { results } = await c.env.DB.prepare(
    `SELECT id, actor, action, target, detail, created_at FROM audit_log ${where}
      ORDER BY id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<{
      id: number
      actor: string | null
      action: string
      target: string | null
      detail: string | null
      created_at: string
    }>()

  return c.json({
    ok: true,
    items: results.map((a) => ({
      id: a.id,
      actor: a.actor,
      action: a.action,
      target: a.target,
      detail: a.detail ? parseJson<unknown>(a.detail, null, 'audit.detail') : null,
      createdAt: a.created_at,
    })),
  })
})

/**
 * 用户列表。**只读** —— 角色在 Prism 侧管理，这里只是让管理员能查到
 * 某人当前是什么身份、什么时候登录过，便于排查问题。
 */
r.get('/users', requireCap(CAPS.AUDIT_VIEW), async (c) => {
  const { limit, offset } = parsePaging(c.req.query())
  const q = c.req.query('q')?.trim() ?? ''

  const where = q ? 'WHERE u.username LIKE ? OR u.display_name LIKE ?' : ''
  const binds: unknown[] = q ? [`%${q}%`, `%${q}%`] : []

  const { results } = await c.env.DB.prepare(
    `SELECT u.sub, u.username, u.display_name, u.role_key, r.level,
            u.last_login_at, u.groups_synced_at, u.deleted_at
       FROM users u JOIN roles r ON r.role_key = u.role_key ${where}
      ORDER BY u.last_login_at DESC NULLS LAST LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<{
      sub: string
      username: string
      display_name: string
      role_key: string
      level: number
      last_login_at: string | null
      groups_synced_at: string | null
      deleted_at: string | null
    }>()

  return c.json({
    ok: true,
    items: results.map((u) => ({
      sub: u.sub,
      username: u.username,
      displayName: u.display_name,
      roleKey: u.role_key,
      level: u.level,
      lastLoginAt: u.last_login_at,
      groupsSyncedAt: u.groups_synced_at,
      deleted: !!u.deleted_at,
    })),
  })
})

/** 后台首页用的概览数字 */
r.get('/stats', requireCap(CAPS.AUDIT_VIEW), async (c) => {
  const [pendingWorkshop, openFeedback, users, licenseTtl] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM workshop_items WHERE status = 'pending'").first<{
      n: number
    }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'").first<{
      n: number
    }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL').first<{
      n: number
    }>(),
    getConfig<number>(c.env.DB, 'license_ttl_hours', 24),
  ])

  return c.json({
    ok: true,
    stats: {
      pendingWorkshop: pendingWorkshop?.n ?? 0,
      openFeedback: openFeedback?.n ?? 0,
      users: users?.n ?? 0,
      licenseTtlHours: licenseTtl,
    },
  })
})

export default r
