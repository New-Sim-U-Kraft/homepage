// NSUK 官网 API —— Hono 应用，挂载在 Nitro 的 /api catch-all 下。
// 错误中间件沿用旧实现的设计：对外只回通用提示 + 错误码 ref，日志记完整信息（脱敏）。
import { Hono } from 'hono'
import type { AppBindings, Env } from './types'
import { clientIp, rateLimit } from './lib/ratelimit'
import modRoutes from './routes/mod'
import authRoutes from './routes/auth'
import publicRoutes from './routes/public'
import workshopRoutes from './routes/workshop'
import hookRoutes from './routes/hooks'
import feedbackRoutes from './routes/feedback'
import adminRoutes from './routes/admin'

const app = new Hono<AppBindings>().basePath('/api')

/** 屏蔽日志中的 secret 与邮箱 */
function maskSecrets(input: unknown, env: Env | undefined): string {
  let out = String(input ?? '')
  const keys: (keyof Env)[] = [
    'PRISM_CLIENT_SECRET',
    'MOD_LICENSE_PRIVATE_KEY',
    'WEBHOOK_SECRET',
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
  // 公开端点，加一道限流：它要查一次 D1，被刷会白白消耗配额
  const limit = await rateLimit(c.env.KV, `ping:${clientIp(c.req.raw.headers)}`, 30, 60)
  if (!limit.ok) return c.json({ ok: false, error: '请求过于频繁' }, 429)

  // 逐项状态只报布尔值，且**仅在尚未配置齐全时**返回。
  //
  // 部署阶段需要它定位缺哪一项（clientSecret 是 secret，不在 wrangler.toml 里，
  // 最容易漏）；而那个阶段站点本来就不可用，暴露这点信息没什么可失去的。
  // 一旦配齐就不再输出 —— 稳定运行的站点没有理由对外公开自己的配置矩阵，
  // 那只会告诉攻击者哪块功能尚未就绪、值得试探。
  const config = {
    PRISM_ISSUER: !!c.env?.PRISM_ISSUER,
    PRISM_CLIENT_ID: !!c.env?.PRISM_CLIENT_ID,
    PRISM_CLIENT_SECRET: !!c.env?.PRISM_CLIENT_SECRET,
    PRISM_TEAM_ID: !!c.env?.PRISM_TEAM_ID,
    PRISM_JOIN_URL: !!c.env?.PRISM_JOIN_URL,
    SITE_URL: !!c.env?.SITE_URL,
    MOD_LICENSE_PRIVATE_KEY: !!c.env?.MOD_LICENSE_PRIVATE_KEY,
    WEBHOOK_SECRET: !!c.env?.WEBHOOK_SECRET,
  }
  const allConfigured = Object.values(config).every(Boolean)

  const out: Record<string, unknown> = {
    bindings: { DB: !!c.env?.DB, KV: !!c.env?.KV, R2: !!c.env?.R2 },
    configured: allConfigured,
  }
  if (!allConfigured) out.config = config

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
app.route('/hooks', hookRoutes)
app.route('/feedback', feedbackRoutes)
app.route('/admin', adminRoutes)
app.route('/', publicRoutes)

app.all('*', (c) => c.json({ ok: false, error: 'Not Found' }, 404))

export default app
