// 会话解析与路由守卫。
//
// 身份组的「静默复查」也在这里触发：会话超过 15 分钟未同步时，
// 用 refresh token 拉一次新的 ID token 重新映射 role_key。
// 这是掉赞助后失效的主要路径之一 —— 玩家可能长期不访问网页，
// 不能指望他们主动登录来触发同步。
import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppBindings, SessionUser } from '../types'
import { hasPerm, levelOf, type Capability } from './roles'
import {
  GROUPS_REFRESH_INTERVAL_MS,
  SESSION_COOKIE,
  destroySessionsForUser,
  getSession,
  touchSession,
} from './session'
import { loadUser, roleFromClaims, syncRole } from './users'
import { isPrismConfigured, prismConfig } from './config'
import { getDiscovery, refreshTokens, verifyIdToken } from './oidc'

/**
 * 后台复查身份组。失败一律吞掉 —— 这是尽力而为的加速路径，
 * 真正的兜底是 License 的短有效期与 webhook。
 */
async function refreshGroups(c: Context<AppBindings>, token: string, refreshToken: string) {
  try {
    const cfg = prismConfig(c.env)
    const discovery = await getDiscovery(c.env.KV, cfg)
    const tokens = await refreshTokens(discovery, cfg, refreshToken)
    const claims = await verifyIdToken(c.env.KV, cfg, discovery, tokens.id_token)

    const roleKey = await roleFromClaims(c.env.DB, claims, cfg.teamId)
    const changed = await syncRole(c.env.DB, claims.sub, roleKey)

    await touchSession(c.env.KV, token, {
      groupsSyncedAt: Date.now(),
      refreshToken: tokens.refresh_token ?? refreshToken,
    })

    if (changed) {
      console.log('[rbac] 身份组变更', claims.sub, '→', roleKey)
      // 降级时立即踢掉所有会话，让下一次请求重新走登录拿到正确权限
      if (roleKey === 'guest') await destroySessionsForUser(c.env.KV, claims.sub)
    }
  } catch (e) {
    console.warn('[rbac] 身份组复查失败:', String(e))
  }
}

/**
 * 解析当前会话用户。无会话返回 null，不抛错 ——
 * 公开页面也会走这里，用于决定是否展示登录态相关内容。
 */
export async function resolveUser(c: Context<AppBindings>): Promise<SessionUser | null> {
  const cached = c.get('user')
  if (cached !== undefined) return cached

  const token = getCookie(c, SESSION_COOKIE) ?? ''
  if (!token) {
    c.set('user', null)
    return null
  }

  const session = await getSession(c.env.KV, token)
  if (!session) {
    c.set('user', null)
    return null
  }

  const user = await loadUser(c.env.DB, session.sub)
  c.set('user', user)

  // 到期则后台复查，不阻塞本次请求
  const stale = Date.now() - session.groupsSyncedAt > GROUPS_REFRESH_INTERVAL_MS
  if (stale && session.refreshToken && isPrismConfigured(c.env)) {
    c.executionCtx?.waitUntil(refreshGroups(c, token, session.refreshToken))
  }

  return user
}

export function requireAuth() {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = await resolveUser(c)
    if (!user) return c.json({ ok: false, code: 'UNAUTHORIZED', error: '请先登录' }, 401)
    await next()
  }
}

export function requireLevel(min: number) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = await resolveUser(c)
    if (!user) return c.json({ ok: false, code: 'UNAUTHORIZED', error: '请先登录' }, 401)
    if (levelOf(user) < min) {
      return c.json({ ok: false, code: 'FORBIDDEN', error: '权限不足', level: levelOf(user) }, 403)
    }
    await next()
  }
}

export function requireCap(cap: Capability) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = await resolveUser(c)
    if (!user) return c.json({ ok: false, code: 'UNAUTHORIZED', error: '请先登录' }, 401)
    if (!hasPerm(user, cap)) {
      return c.json({ ok: false, code: 'FORBIDDEN', error: '权限不足' }, 403)
    }
    await next()
  }
}

export * from './roles'
