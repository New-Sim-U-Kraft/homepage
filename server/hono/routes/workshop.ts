// 创意工坊 —— 公开读部分。
//
// 关键约束（设计条目 W3/W5）：站内只提供预览，下载一律走投稿者填写的站外链接。
// 因此 files 只返回元信息（名称、类型、大小），**绝不返回可直接下载的 URL**。
// 结构文件本身在 R2 里没有公开访问路径。
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { nowIso, parseJson, parsePaging } from '../lib/db'
import { requireAuth } from '../lib/rbac'
import { rateLimit } from '../lib/ratelimit'
import { UploadError, deleteFiles, putFile, type UploadedFile } from '../lib/upload'
import { recordAudit } from '../lib/audit'
import { edgeCache } from '../lib/cache'
import { parseNbt } from '../lib/nbt'
import { encodeRenderModel } from '../lib/renderModel'
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
  review_reason: string
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

// ─────────────────────────────────────────────────────────────
// 3D 预览数据
// ─────────────────────────────────────────────────────────────

/**
 * 返回紧凑二进制的渲染模型（格式见 lib/renderModel.ts）。
 *
 * 原始 .nbt 永远不出站：客户端拿到的是解析后的方块坐标与调色板，
 * 丢掉了 blockstate 属性、tile entity 与实体，重建不出可用的原文件。
 */
r.get('/:id/preview', async (c) => {
  const id = c.req.param('id') ?? ''

  const cache = edgeCache()
  const cached = await cache?.match(c.req.raw)
  if (cached) return cached

  const row = await c.env.DB.prepare('SELECT files, status, author_sub FROM workshop_items WHERE id = ?')
    .bind(id)
    .first<{ files: string; status: string; author_sub: string | null }>()

  if (!row) return c.json({ ok: false, error: '作品不存在' }, 404)

  // 与详情接口保持一致：未发布的作品对匿名访客等同于不存在
  if (row.status !== 'published') {
    const user = c.get('user')
    if (!user || row.author_sub !== user.sub) {
      return c.json({ ok: false, error: '作品不存在' }, 404)
    }
  }

  const files = parseJson<{ items?: { name: string; kind: string; key?: string }[] }>(
    row.files,
    {},
    `workshop.${id}.files`,
  )
  const structure = files.items?.find((f) => f.kind === 'structure' && f.key)
  if (!structure?.key) return c.json({ ok: false, code: 'NO_STRUCTURE', error: '没有结构文件' }, 404)

  const obj = await c.env.R2.get(structure.key)
  if (!obj) return c.json({ ok: false, error: '结构文件已丢失' }, 404)

  let encoded
  try {
    encoded = encodeRenderModel(await parseNbt(await obj.arrayBuffer()))
  } catch (e) {
    console.warn('[workshop] NBT 解析失败', id, String(e))
    return c.json({ ok: false, code: 'PARSE_FAILED', error: '结构文件无法解析' }, 400)
  }
  if (!encoded) {
    return c.json({ ok: false, code: 'NOT_RENDERABLE', error: '文件里没有可渲染的方块数据' }, 400)
  }

  const res = new Response(encoded.buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      // 被截断时如实告知，前端要把这个数字显示出来
      'X-Model-Total': String(encoded.meta.totalBlocks),
      'X-Model-Rendered': String(encoded.meta.renderedBlocks),
      'X-Model-Omitted': String(encoded.meta.omittedBlocks),
    },
  })

  if (cache && row.status === 'published') {
    c.executionCtx?.waitUntil(cache.put(c.req.raw, res.clone()))
  }
  return res
})

// ─────────────────────────────────────────────────────────────
// 投稿
// ─────────────────────────────────────────────────────────────

const MAX_FILES = 8
const CATEGORIES = ['building', 'interior', 'landscape', 'other']

interface ExternalLink {
  label: string
  url: string
}

/** 只接受 https，且必须能被 URL 解析 —— 投稿的下载链接会直接给玩家点 */
function parseLinks(raw: string): ExternalLink[] {
  const list = parseJson<unknown[]>(raw, [], 'workshop.submit.links')
  const out: ExternalLink[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const url = String(o.url ?? '').trim()
    if (!url) continue
    try {
      if (new URL(url).protocol !== 'https:') continue
    } catch {
      continue
    }
    out.push({ label: String(o.label ?? '').trim().slice(0, 40) || '下载', url })
  }
  return out
}

r.post('/submit', requireAuth(), async (c) => {
  const user = c.get('user')!

  const limit = await rateLimit(c.env.KV, `ws:${user.sub}`, 5, 3600)
  if (!limit.ok) {
    return c.json({ ok: false, code: 'RATE_LIMITED', error: '投稿过于频繁，请稍后再试' }, 429)
  }

  const form = await c.req.parseBody({ all: true }).catch(() => null)
  if (!form) return c.json({ ok: false, code: 'BAD_REQUEST', error: '表单解析失败' }, 400)

  const title = String(form.title ?? '').trim().slice(0, 80)
  const category = String(form.category ?? '').trim()
  const description = String(form.description ?? '').trim().slice(0, 2000)

  if (!title || !description) {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: '标题与描述不能为空' }, 400)
  }
  if (!CATEGORIES.includes(category)) {
    return c.json({ ok: false, code: 'BAD_CATEGORY', error: '请选择作品分类' }, 400)
  }

  // 站内不提供结构文件下载，站外链接是玩家唯一的获取途径，因此必填
  const links = parseLinks(String(form.externalLinks ?? '[]'))
  if (links.length === 0) {
    return c.json(
      { ok: false, code: 'NO_LINK', error: '请至少提供一个 https 站外下载链接' },
      400,
    )
  }

  const raw = form['files'] ?? form['files[]']
  const incoming = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File)
  if (incoming.length === 0) {
    return c.json({ ok: false, code: 'NO_FILE', error: '请至少上传一个文件' }, 400)
  }
  if (incoming.length > MAX_FILES) {
    return c.json({ ok: false, code: 'TOO_MANY', error: `最多上传 ${MAX_FILES} 个文件` }, 400)
  }

  const id = crypto.randomUUID()
  const uploaded: UploadedFile[] = []

  try {
    for (const file of incoming) {
      uploaded.push(await putFile(c.env.R2, `uploads/workshop/${id}`, file))
    }
  } catch (e) {
    // 部分写入后失败会在 R2 留下孤儿对象，必须回滚
    await deleteFiles(
      c.env.R2,
      uploaded.map((u) => u.key),
    )
    if (e instanceof UploadError) {
      return c.json({ ok: false, code: e.code, error: e.message }, 400)
    }
    throw e
  }

  const images = uploaded.filter((u) => u.kind === 'image')
  const structures = uploaded.filter((u) => u.kind === 'structure')

  const files = {
    // 封面取第一张图，仅图片有公开 URL
    cover: images[0] ? `/${images[0].key}` : null,
    images: images.map((i) => ({ name: i.name, url: `/${i.key}`, size: i.size })),
    // 结构文件只记 key 与元信息，对外接口不会返回 key
    items: uploaded.map((u) => ({ name: u.name, kind: u.kind, size: u.size, key: u.key })),
  }

  const now = nowIso()
  await c.env.DB.prepare(
    `INSERT INTO workshop_items
       (id, title, category, description, files, external_links,
        author_sub, author_display_name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(
      id,
      title,
      category,
      description,
      JSON.stringify(files),
      JSON.stringify(links),
      user.sub,
      user.displayName,
      now,
      now,
    )
    .run()

  await recordAudit(c.env.DB, {
    actor: user.sub,
    action: 'workshop.submit',
    target: id,
    detail: { title, images: images.length, structures: structures.length },
  })

  return c.json({ ok: true, id, status: 'pending' })
})

/** 我的投稿，含未过审的 */
r.get('/mine/list', requireAuth(), async (c) => {
  const user = c.get('user')!
  const { limit, offset } = parsePaging(c.req.query())

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM workshop_items WHERE author_sub = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(user.sub, limit, offset)
    .all<WorkshopRow>()

  return c.json({
    ok: true,
    items: results.map((row) => ({
      ...toSummary(row),
      status: row.status,
      reviewReason: row.review_reason,
    })),
  })
})

export default r
