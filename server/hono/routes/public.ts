// 公开内容接口 —— 无需登录，可被边缘缓存。
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { getConfig, parseJson, parsePaging } from '../lib/db'
import type {
  Announcement,
  ChangelogEntry,
  Developer,
  DeveloperSummary,
  ExternalMod,
} from '../../../shared/types'

const r = new Hono<AppBindings>()

/** 首页公告，存在 site_config 里由后台编辑 */
r.get('/announcements', async (c) => {
  const list = await getConfig<Announcement[]>(c.env.DB, 'announcements', [])
  return c.json({ ok: true, announcements: list })
})

/** 更新日志，按发布时间倒序 */
r.get('/changelog', async (c) => {
  const { limit, offset } = parsePaging(c.req.query())
  const { results } = await c.env.DB.prepare(
    `SELECT id, version, title, body, published_at
       FROM changelog
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<{
      id: string
      version: string
      title: string
      body: string
      published_at: string
    }>()

  const entries: ChangelogEntry[] = results.map((row) => ({
    id: row.id,
    version: row.version,
    title: row.title,
    body: row.body,
    publishedAt: row.published_at,
  }))

  return c.json({ ok: true, entries })
})

/** 外部模组列表 */
r.get('/external-mods', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, data FROM external_mods').all<{
    id: string
    data: string
  }>()

  const mods = results
    .map((row): ExternalMod | null => {
      const d = parseJson<Partial<ExternalMod>>(row.data, {}, `external_mods.${row.id}`)
      if (!d.name || !d.url) return null
      return {
        id: row.id,
        name: d.name,
        description: d.description ?? '',
        url: d.url,
        author: d.author,
        icon: d.icon,
      }
    })
    .filter((m): m is ExternalMod => m !== null)

  return c.json({ ok: true, mods })
})

/** 开发者列表 */
r.get('/developers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT slug, data FROM developers').all<{
    slug: string
    data: string
  }>()

  const developers = results
    .map((row): DeveloperSummary | null => {
      const d = parseJson<Partial<Developer>>(row.data, {}, `developers.${row.slug}`)
      if (!d.name) return null
      return {
        slug: row.slug,
        name: d.name,
        role: d.role ?? '',
        avatar: d.avatar ?? '',
        intro: d.intro ?? '',
      }
    })
    .filter((d): d is DeveloperSummary => d !== null)

  return c.json({ ok: true, developers })
})

/** 开发者详情 */
r.get('/developers/:slug', async (c) => {
  const slug = c.req.param('slug')
  const row = await c.env.DB.prepare('SELECT slug, data FROM developers WHERE slug = ?')
    .bind(slug)
    .first<{ slug: string; data: string }>()

  if (!row) return c.json({ ok: false, error: '开发者不存在' }, 404)

  const d = parseJson<Partial<Developer>>(row.data, {}, `developers.${slug}`)
  if (!d.name) return c.json({ ok: false, error: '开发者资料损坏' }, 404)

  return c.json({
    ok: true,
    developer: {
      slug: row.slug,
      name: d.name,
      role: d.role ?? '',
      avatar: d.avatar ?? '',
      intro: d.intro ?? '',
      cover: d.cover,
      links: d.links ?? [],
      body: d.body ?? '',
    } satisfies Developer,
  })
})

export default r
