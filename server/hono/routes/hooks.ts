// Prism audit webhook 接收（设计条目 G 组）。
//
// Prism 的 audit webhook 是 best-effort 投递：**无重试、无 HMAC 签名**。
// 因此这里的定位是「加速信号」而非可信数据源 ——
//   · 防伪只能靠自定义 header 里的共享密钥（常数时间比对）
//   · 收到后优先向 Prism 主动核实，核实不了才退而按 payload 推算
//   · 真正的兜底是 License 的短有效期与登录时的静默复查
//
// Prism 侧需要把 general 类型 webhook 的 body 模板配成：
//   {"event":"{event}","resource_id":"{resource_id}","scope_id":"{scope_id}",
//    "metadata":{metadata},"timestamp":"{timestamp}"}
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { timingSafeEqual } from '../lib/crypto'
import { clientIp, rateLimit } from '../lib/ratelimit'
import { reconcileUser } from '../lib/prismSync'
import { markUserDeleted } from '../lib/users'
import { destroySessionsForUser } from '../lib/session'
import { AUDIT, recordAudit } from '../lib/audit'
import { GROUP_TO_ROLE } from '../lib/roles'

const r = new Hono<AppBindings>()

const SECRET_HEADER = 'X-NSUK-Webhook-Secret'

/** group.delete 单次展开的用户数上限，超出部分记日志而不是静默丢弃 */
const MAX_FANOUT = 100

interface WebhookPayload {
  /** Prism 的模板变量叫 `{action}`，`event` 只是本站模板里的别名 */
  action?: string
  event?: string
  scope?: string
  scope_id?: string
  resource_type?: string
  resource_id?: string
  actor_id?: string
  metadata?: Record<string, unknown>
  timestamp?: string
}

/**
 * Prism 的 `interpolate` 对未知占位符是原样保留的，所以模板里写错变量名
 * （例如把 `{action}` 写成 `{event}`）不会报错，只会让本站收到字面量
 * `"{event}"` 然后当作未知事件忽略掉 —— 链路静默失效且两边都返回 200。
 * 这里显式识别出这种情况并报错。
 */
function looksUninterpolated(v: string): boolean {
  return /^\{\w+\}$/.test(v)
}

r.post('/prism/audit', async (c) => {
  // 限流：无签名端点，先挡住无脑刷
  const limit = await rateLimit(c.env.KV, `hook:${clientIp(c.req.raw.headers)}`, 120, 60)
  if (!limit.ok) return c.json({ ok: false, error: 'rate limited' }, 429)

  const expected = c.env.WEBHOOK_SECRET
  if (!expected) {
    console.error('[hooks] WEBHOOK_SECRET 未配置，拒绝所有投递')
    return c.json({ ok: false, error: 'not configured' }, 503)
  }

  const provided = c.req.header(SECRET_HEADER) ?? ''
  if (!timingSafeEqual(provided, expected)) {
    console.warn('[hooks] 密钥校验失败', clientIp(c.req.raw.headers))
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  const payload = await c.req.json<WebhookPayload>().catch((): WebhookPayload => ({}))
  const event = String(payload.action ?? payload.event ?? '')
  const teamId = c.env.PRISM_TEAM_ID ?? ''

  if (looksUninterpolated(event)) {
    console.error(
      `[hooks] webhook body 模板里的占位符未被替换：收到 "${event}"。` +
        `Prism 的事件名变量是 {action}，不是 {event}`,
    )
    return c.json({ ok: false, code: 'BAD_TEMPLATE', error: 'body 模板占位符未替换' }, 400)
  }

  // 只处理 NSUK 团队的事件。scope_id 缺失时放行 —— 旧模板可能不带这个字段
  if (payload.scope_id && teamId && payload.scope_id !== teamId) {
    return c.json({ ok: true, ignored: 'other_team' })
  }

  const sub = String(payload.resource_id ?? '').trim()

  switch (event) {
    // ── 成员身份组变更 ──
    case 'team.member.groups_change': {
      if (!sub) return c.json({ ok: true, ignored: 'no_resource' })

      // payload 里的 removed/added 只作为核实失败时的兜底依据
      const removed = Array.isArray(payload.metadata?.removed)
        ? (payload.metadata.removed as unknown[]).map(String)
        : []
      const added = Array.isArray(payload.metadata?.added)
        ? (payload.metadata.added as unknown[]).map(String)
        : []

      // 有新增组时，按新增里等级最高的推算；否则认为已无组
      const fallback =
        added.map((s) => GROUP_TO_ROLE[s.trim().toLowerCase()]).find(Boolean) ?? 'guest'

      const result = await reconcileUser(c.env, sub, fallback, 'webhook.groups_change')
      console.log('[hooks] groups_change', sub, 'removed=', removed, '→', result?.role)
      return c.json({ ok: true, applied: result?.changed ?? false })
    }

    // ── 离开团队 ──
    // 被移出（remove）与主动退出（leave）是两个事件，都要处理；
    // 它们又与 groups_change 独立，只订身份组变更的话，退团的人不会掉权限。
    case 'team.member.remove':
    case 'team.member.leave': {
      if (!sub) return c.json({ ok: true, ignored: 'no_resource' })
      const result = await reconcileUser(c.env, sub, 'guest', `webhook.${event}`)
      console.log('[hooks]', event, sub, '→', result?.role)
      return c.json({ ok: true, applied: result?.changed ?? false })
    }

    // ── 身份组定义被删除 ──
    // Prism 不会为每个受影响成员各发一条，需要自己展开
    case 'team.group.delete': {
      const slug = String(payload.metadata?.slug ?? '').trim().toLowerCase()
      const role = GROUP_TO_ROLE[slug]
      if (!role) return c.json({ ok: true, ignored: 'unknown_group' })

      const { results } = await c.env.DB.prepare(
        'SELECT sub FROM users WHERE role_key = ? AND deleted_at IS NULL LIMIT ?',
      )
        .bind(role, MAX_FANOUT + 1)
        .all<{ sub: string }>()

      const overflow = results.length > MAX_FANOUT
      const targets = results.slice(0, MAX_FANOUT)
      if (overflow) {
        console.warn(
          `[hooks] group.delete 受影响用户超过 ${MAX_FANOUT}，本次只处理前 ${MAX_FANOUT} 个，` +
            `其余依赖登录时的静默复查`,
        )
      }

      // 核实不了的一律降为游客：身份组被删是罕见的管理操作，
      // 宁可让用户重新登录一次，也不能让失效的权限继续生效
      c.executionCtx?.waitUntil(
        (async () => {
          for (const t of targets) {
            await reconcileUser(c.env, t.sub, 'guest', 'webhook.group_delete')
          }
        })(),
      )

      await recordAudit(c.env.DB, {
        actor: 'system',
        action: AUDIT.USER_ROLE_SYNC,
        target: slug,
        detail: { event, affected: targets.length, overflow },
      })

      return c.json({ ok: true, affected: targets.length, overflow })
    }

    // ── 账号注销 ──
    // 保留本地档案行，否则工坊作品与审计会指向不存在的用户。
    //
    // `team.member.account_deleted` 是团队作用域的事件，也是这里真正收得到的
    // 那个 —— 本站的 webhook 建在团队下，用户作用域的 `user.account.deleted`
    // 未必会投递过来。后两个留作兼容。
    case 'team.member.account_deleted':
    case 'user.account.deleted':
    case 'admin.user.delete': {
      if (!sub) return c.json({ ok: true, ignored: 'no_resource' })
      await markUserDeleted(c.env.DB, sub)
      await destroySessionsForUser(c.env.KV, sub)
      await recordAudit(c.env.DB, { actor: 'system', action: AUDIT.USER_DELETED, target: sub })
      console.log('[hooks] account_deleted', sub)
      return c.json({ ok: true })
    }

    // ── 团队进入解散流程 ──
    // Prism 侧是两段式：先停用全部受限账号，宽限期（默认 7 天）后才真正删号。
    // 这里只告警不处置 —— 期间管理员可以取消解散，提前把用户数据动了反而糟。
    // 那些账号的会话会因为 Prism 侧 is_active=0 而在下次静默复查时自然失效。
    case 'admin.team.dissolve_started': {
      console.error('[hooks] ⚠ NSUK 团队进入解散流程，宽限期结束后全部受限账号将被删除')
      await recordAudit(c.env.DB, {
        actor: 'system',
        action: 'team.dissolve.started',
        target: payload.scope_id ?? teamId,
        detail: payload.metadata ?? null,
      })
      return c.json({ ok: true, warned: true })
    }

    default:
      return c.json({ ok: true, ignored: 'unhandled_event', event })
  }
})

export default r
