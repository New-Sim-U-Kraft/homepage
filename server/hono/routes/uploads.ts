// R2 对象读取。
//
// 采用**白名单**而非黑名单（设计条目 W5）：只有明确列出的路径可以公开访问，
// 其余一律 403。旧实现是黑名单（只拦 workshop/*/nbt/），新增一种结构文件
// 格式或换个子目录就会漏出去。
import { Hono } from 'hono'
import type { AppBindings } from '../types'

// 挂在 /uploads 而非 /api 下：R2 对象的 URL 直接对外，路径要稳定好看
const r = new Hono<AppBindings>().basePath('/uploads')

/** 可公开访问的 key 形态 */
const PUBLIC_PATTERNS = [
  /^uploads\/workshop\/[^/]+\/images\/[^/]+$/,
  /^uploads\/developers\/[^/]+\/[^/]+$/,
  /^uploads\/site\/[^/]+$/,
]

function isPublic(key: string): boolean {
  return PUBLIC_PATTERNS.some((re) => re.test(key))
}

/**
 * 边缘缓存。`caches.default` 是 Cloudflare 扩展，在 Nitro 的 Node 开发环境里
 * 整个 `caches` 全局都不存在，直接访问会抛 ReferenceError。
 */
function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches
  return c?.default ?? null
}

r.get('/*', async (c) => {
  const path = new URL(c.req.url).pathname
  // 逐段 decode 后再判定：先判定后 decode 会被 %2e%2e 之类绕过
  const key = path
    .replace(/^\/+/, '')
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    .join('/')

  if (!key.startsWith('uploads/') || key.includes('..')) return c.notFound()

  if (!isPublic(key)) {
    // 结构文件只能在站内预览，下载请走作品的站外链接
    return c.json(
      { ok: false, code: 'NOT_PUBLIC', error: '该文件不提供直接下载，请使用作品页的站外链接' },
      403,
    )
  }

  const cache = edgeCache()
  const cached = await cache?.match(c.req.raw)
  if (cached) return cached

  const obj = await c.env.R2.get(key)
  if (!obj) return c.notFound()

  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream')
  headers.set('Cache-Control', 'public, max-age=86400')
  headers.set('X-Content-Type-Options', 'nosniff')
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag)

  const res = new Response(obj.body, { headers })
  if (cache) c.executionCtx?.waitUntil(cache.put(c.req.raw, res.clone()))
  return res
})

export default r
