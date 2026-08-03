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

/**
 * 公开个人主页。
 *
 * 注意不要链到 Prism 的 /u/<username>：NSUK 用户绝大多数是通过团队邀请
 * 链接注册的受限账号，其 profile:public 能力默认关闭，那个页面会返回 404。
 * 展示位只能是本站自建的这个。
 */
r.get('/users/:username', async (c) => {
  const username = c.req.param('username') ?? ''

  const row = await c.env.DB.prepare(
    `SELECT u.sub, u.username, u.display_name, u.avatar_override, u.intro, u.cover,
            u.developer_slug, u.role_key, u.created_at, r.name AS role_name, r.level
       FROM users u JOIN roles r ON r.role_key = u.role_key
      WHERE u.username = ? AND u.deleted_at IS NULL`,
  )
    .bind(username)
    .first<{
      sub: string
      username: string
      display_name: string
      avatar_override: string
      intro: string
      cover: string
      developer_slug: string
      role_key: string
      role_name: string
      level: number
      created_at: string
    }>()

  if (!row) return c.json({ ok: false, error: '用户不存在' }, 404)

  const { results: works } = await c.env.DB.prepare(
    `SELECT id, title, category, files FROM workshop_items
      WHERE author_sub = ? AND status = 'published'
      ORDER BY published_at DESC LIMIT 12`,
  )
    .bind(row.sub)
    .all<{ id: string; title: string; category: string; files: string }>()

  return c.json({
    ok: true,
    user: {
      username: row.username,
      displayName: row.display_name || row.username,
      avatar: row.avatar_override,
      intro: row.intro,
      cover: row.cover,
      developerSlug: row.developer_slug,
      roleKey: row.role_key,
      roleName: row.role_name,
      level: row.level,
      joinedAt: row.created_at,
    },
    works: works.map((w) => ({
      id: w.id,
      title: w.title,
      category: w.category,
      cover:
        parseJson<{ cover?: string | null }>(w.files, {}, `workshop.${w.id}.files`).cover ?? null,
    })),
  })
})

/**
 * 画廊：已发布作品的图片汇总。
 *
 * 不另建表 —— 画廊本质上就是工坊作品的图片视图，两份数据会不同步。
 */
r.get('/gallery', async (c) => {
  const { limit, offset } = parsePaging(c.req.query(), 60)

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, files FROM workshop_items
      WHERE status = 'published'
      ORDER BY published_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<{ id: string; title: string; files: string }>()

  const images: { url: string; title: string; workshopId: string }[] = []
  for (const row of results) {
    const files = parseJson<{ images?: { url: string }[] }>(
      row.files,
      {},
      `workshop.${row.id}.files`,
    )
    for (const img of files.images ?? []) {
      if (typeof img?.url === 'string' && img.url) {
        images.push({ url: img.url, title: row.title, workshopId: row.id })
      }
    }
  }

  return c.json({ ok: true, images })
})

export default r
