// NSUK 官网 API —— Hono 应用，挂载在 Nitro 的 /api catch-all 下。
// 错误中间件沿用旧实现的设计：对外只回通用提示 + 错误码 ref，日志记完整信息（脱敏）。
import { Hono } from 'hono'
import type { AppBindings, Env } from './types'
import modRoutes from './routes/mod'
import authRoutes from './routes/auth'
import publicRoutes from './routes/public'
import workshopRoutes from './routes/workshop'

const app = new Hono<AppBindings>().basePath('/api')

/** 屏蔽日志中的 secret 与邮箱 */
function maskSecrets(input: unknown, env: Env | undefined): string {
  let out = String(input ?? '')
  const keys: (keyof Env)[] = [
    'NUXT_PRISM_CLIENT_SECRET',
    'NUXT_MOD_LICENSE_PRIVATE_KEY',
    'NUXT_WEBHOOK_SECRET',
  ]
  for (const k of keys) {
    const v = env?.[k]
    if (typeof v === 'string' && v) out = out.split(v).join('***')
  }
  return out.replace(/[\w.+-]+@[\w.-]+\.\w+/g, '***@***')
}

app.onError((err, c) => {
  let ref = 'ERR'
  try {
    ref = crypto.randomUUID().slice(0, 8)
  } catch {
    // crypto 不可用时保留默认 ref
  }

  const meta = {
    ref,
    method: c.req.method,
    path: (() => {
      try {
        return new URL(c.req.url).pathname
      } catch {
        return ''
      }
    })(),
    ip: c.req.header('CF-Connecting-IP') || '',
    user: c.get('user')?.sub || '',
    ts: new Date().toISOString(),
  }

  console.error('[error]', JSON.stringify(meta), maskSecrets(err?.stack || err, c.env))
  return c.json({ ok: false, error: '服务器开小差了，请稍后重试', ref }, 500)
})

// ─── 健康检查与绑定自检 ───

app.get('/healthz', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

app.get('/_ping', async (c) => {
  const out: Record<string, unknown> = {
    bindings: { DB: !!c.env?.DB, KV: !!c.env?.KV, R2: !!c.env?.R2 },
  }
  try {
    const r = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM roles').first<{ n: number }>()
    out.roles = r?.n ?? 0
  } catch (e) {
    console.error('[_ping] DB error:', String(e))
    out.dbError = true
  }
  return c.json(out)
})

// ─── 业务路由 ───

// 更具体的前缀先挂，公开内容路由挂在 /api 根上
app.route('/auth', authRoutes)
app.route('/mod', modRoutes)
app.route('/workshop', workshopRoutes)
app.route('/', publicRoutes)

app.all('*', (c) => c.json({ ok: false, error: 'Not Found' }, 404))

export default app
