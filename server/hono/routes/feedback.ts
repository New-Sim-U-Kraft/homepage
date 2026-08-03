// 反馈。
//
// 提交需要登录：站点没有接入验证码，匿名开放必然招来垃圾内容。
// 既然账号体系已经在 Prism 上，登录门槛本身就是最省事的反垃圾手段。
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { requireAuth } from '../lib/rbac'
import { nowIso, parsePaging } from '../lib/db'
import { rateLimit } from '../lib/ratelimit'

const r = new Hono<AppBindings>()

const CATEGORIES = ['bug', 'suggestion', 'link-dead', 'other'] as const
type Category = (typeof CATEGORIES)[number]

const MAX_TITLE = 80
const MAX_CONTENT = 2000
const MAX_CONTACT = 120

interface FeedbackBody {
  category?: string
  title?: string
  content?: string
  contact?: string
}

interface FeedbackRow {
  id: string
  category: string
  title: string
  content: string
  status: string
  reply: string
  created_at: string
  handled_at: string | null
}

r.post('/', requireAuth(), async (c) => {
  const user = c.get('user')!

  // 每人每小时 5 条，足够正常使用，也挡住了刷屏
  const limit = await rateLimit(c.env.KV, `fb:${user.sub}`, 5, 3600)
  if (!limit.ok) {
    return c.json(
      { ok: false, code: 'RATE_LIMITED', error: '提交过于频繁，请稍后再试' },
      429,
    )
  }

  const body = await c.req.json<FeedbackBody>().catch((): FeedbackBody => ({}))

  const category = String(body.category ?? '').trim() as Category
  if (!CATEGORIES.includes(category)) {
    return c.json({ ok: false, code: 'BAD_CATEGORY', error: '请选择反馈类型' }, 400)
  }

  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE)
  const content = String(body.content ?? '').trim().slice(0, MAX_CONTENT)
  if (!title || !content) {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: '标题与内容不能为空' }, 400)
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO feedback (id, author_sub, category, title, content, contact, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
  )
    .bind(
      id,
      user.sub,
      category,
      title,
      content,
      String(body.contact ?? '').trim().slice(0, MAX_CONTACT),
      nowIso(),
    )
    .run()

  return c.json({ ok: true, id })
})

/** 我提交过的反馈。看不到别人的，也看不到处理人 */
r.get('/mine', requireAuth(), async (c) => {
  const user = c.get('user')!
  const { limit, offset } = parsePaging(c.req.query())

  const { results } = await c.env.DB.prepare(
    `SELECT id, category, title, content, status, reply, created_at, handled_at
       FROM feedback WHERE author_sub = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(user.sub, limit, offset)
    .all<FeedbackRow>()

  return c.json({
    ok: true,
    items: results.map((row) => ({
      id: row.id,
      category: row.category,
      title: row.title,
      content: row.content,
      status: row.status,
      reply: row.reply,
      createdAt: row.created_at,
      handledAt: row.handled_at,
    })),
  })
})

export default r
