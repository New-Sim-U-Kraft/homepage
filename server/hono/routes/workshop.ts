// 创意工坊 —— 公开读部分。
//
// 关键约束（设计条目 W3/W5）：站内只提供预览，下载一律走投稿者填写的站外链接。
// 因此 files 只返回元信息（名称、类型、大小），**绝不返回可直接下载的 URL**。
// 结构文件本身在 R2 里没有公开访问路径。
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { parseJson, parsePaging } from '../lib/db'
import type { WorkshopItem, WorkshopItemSummary } from '../../../shared/types'

const r = new Hono<AppBindings>()

interface WorkshopRow {
  id: string
  title: string
  category: string
  description: string
  files: string
  external_links: string
  author_sub: string | null
  author_display_name: string
  status: string
  created_at: string
  updated_at: string
  published_at: string | null
}

/** 从 files blob 里挑出封面图，没有则 null */
function pickCover(files: unknown): string | null {
  if (!files || typeof files !== 'object') return null
  const cover = (files as Record<string, unknown>).cover
  return typeof cover === 'string' && cover ? cover : null
}

type FileMeta = WorkshopItem['files'][number]

/** 只暴露元信息，不含下载地址 */
function shapeFiles(files: unknown): FileMeta[] {
  if (!files || typeof files !== 'object') return []
  const list = (files as Record<string, unknown>).items
  if (!Array.isArray(list)) return []
  return list
    .map((f): FileMeta | null => {
      if (!f || typeof f !== 'object') return null
      const o = f as Record<string, unknown>
      if (typeof o.name !== 'string') return null
      return {
        name: o.name,
        kind: typeof o.kind === 'string' ? o.kind : 'file',
        size: typeof o.size === 'number' ? o.size : undefined,
      }
    })
    .filter((f): f is FileMeta => f !== null)
}

function toSummary(row: WorkshopRow): WorkshopItemSummary {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    authorName: row.author_display_name || '已注销用户',
    authorSub: row.author_sub,
    cover: pickCover(parseJson(row.files, {}, `workshop.${row.id}.files`)),
    publishedAt: row.published_at,
  }
}

/** 已发布作品列表 */
r.get('/', async (c) => {
  const { limit, offset } = parsePaging(c.req.query())
  const category = c.req.query('category')?.trim() || ''

  const where = category ? 'WHERE status = ? AND category = ?' : 'WHERE status = ?'
  const binds: unknown[] = category ? ['published', category] : ['published']

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM workshop_items ${where}
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<WorkshopRow>()

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM workshop_items ${where}`)
    .bind(...binds)
    .first<{ n: number }>()

  return c.json({
    ok: true,
    items: results.map(toSummary),
    total: total?.n ?? 0,
    limit,
    offset,
  })
})

/** 作品详情。未发布的作品只有作者本人与审核员能看 —— 后者待 D 组会话接入 */
r.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM workshop_items WHERE id = ?')
    .bind(c.req.param('id'))
    .first<WorkshopRow>()

  if (!row) return c.json({ ok: false, error: '作品不存在' }, 404)

  if (row.status !== 'published') {
    const user = c.get('user')
    const isAuthor = user && row.author_sub === user.sub
    // TODO(D组): 审核员（workshop.review）也应可见
    if (!isAuthor) return c.json({ ok: false, error: '作品不存在' }, 404)
  }

  const files = parseJson<Record<string, unknown>>(row.files, {}, `workshop.${row.id}.files`)

  const item: WorkshopItem = {
    ...toSummary(row),
    externalLinks: parseJson(row.external_links, [], `workshop.${row.id}.links`),
    files: shapeFiles(files),
    status: row.status as WorkshopItem['status'],
    updatedAt: row.updated_at,
  }

  return c.json({ ok: true, item })
})

export default r
