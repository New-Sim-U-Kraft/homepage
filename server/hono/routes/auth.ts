// Prism OIDC 登录链路（设计条目 D 组）。
//
// 授权码 + PKCE，机密客户端。ID token 在 Worker 内本地 RS256 验签。
//
// 重要：非 NSUK 团队成员**也允许登录**，只是 role 为 guest，前端引导他们
// 去团队邀请链接注册页。挡在门外只会让人不知道自己该做什么。
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppBindings } from '../types'
import { cookieSecure, isPrismConfigured, prismConfig, siteUrl } from '../lib/config'
import {
  buildAuthUrl,
  exchangeCode,
  getDiscovery,
  isTeamMember,
  revokeToken,
  verifyIdToken,
} from '../lib/oidc'
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  getSession,
} from '../lib/session'
import { roleFromClaims, upsertUserFromClaims } from '../lib/users'
import { resolveUser } from '../lib/rbac'

const r = new Hono<AppBindings>()

const STATE_TTL_SEC = 600
const SESSION_TTL_SEC = 7 * 24 * 3600

/**
 * P1 落地前用聚合 scope。它会把用户**所有**团队的 membership claim 都带上，
 * 属于过度授权；Prism 侧提供只发 groups_in_team_<绑定id> 的窄 scope 后替换这里。
 */
const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'teams:read']

interface PendingAuth {
  nonce: string
  codeVerifier: string
  redirect: string
}

/** 防开放重定向：只接受站内绝对路径 */
function safeRedirect(input: string | undefined): string {
  if (!input) return '/'
  if (!input.startsWith('/') || input.startsWith('//')) return '/'
  return input
}

function redirectUriOf(env: AppBindings['Bindings']): string {
  return `${siteUrl(env)}/api/auth/callback`
}

// ─── 发起登录 ───

r.get('/login', async (c) => {
  if (!isPrismConfigured(c.env)) {
    return c.json({ ok: false, code: 'NOT_CONFIGURED', error: '登录尚未配置' }, 503)
  }

  const cfg = prismConfig(c.env)
  const discovery = await getDiscovery(c.env.KV, cfg)
  const auth = await buildAuthUrl(discovery, cfg, redirectUriOf(c.env), SCOPES)

  const pending: PendingAuth = {
    nonce: auth.nonce,
    codeVerifier: auth.codeVerifier,
    redirect: safeRedirect(c.req.query('redirect')),
  }
  await c.env.KV.put(`oidcstate:${auth.state}`, JSON.stringify(pending), {
    expirationTtl: STATE_TTL_SEC,
  })

  return c.redirect(auth.url, 302)
})

// ─── 回调 ───

r.get('/callback', async (c) => {
  const site = siteUrl(c.env)
  const fail = (reason: string) =>
    c.redirect(`${site}/account?error=${encodeURIComponent(reason)}`, 302)

  const error = c.req.query('error')
  if (error) return fail(error)

  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) return fail('missing_code')

  // state 一次性消费：读完立刻删，防止回调被重放
  const stateKey = `oidcstate:${state}`
  const pending = await c.env.KV.get<PendingAuth>(stateKey, 'json')
  await c.env.KV.delete(stateKey)
  if (!pending) return fail('invalid_state')

  try {
    const cfg = prismConfig(c.env)
    const discovery = await getDiscovery(c.env.KV, cfg)

    const tokens = await exchangeCode(
      discovery,
      cfg,
      code,
      redirectUriOf(c.env),
      pending.codeVerifier,
    )

    const claims = await verifyIdToken(c.env.KV, cfg, discovery, tokens.id_token, pending.nonce)

    // 非团队成员也建档，role 为 guest；前端据此引导去注册页
    const roleKey = await roleFromClaims(c.env.DB, claims, cfg.teamId)
    await upsertUserFromClaims(c.env.DB, claims, roleKey)

    const sessionToken = await createSession(c.env.KV, {
      sub: claims.sub,
      refreshToken: tokens.refresh_token,
      groupsSyncedAt: Date.now(),
    })

    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: cookieSecure(c.env),
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SEC,
    })

    console.log('[auth] 登录', claims.sub, 'role=', roleKey, 'member=', isTeamMember(claims, cfg.teamId))

    return c.redirect(`${site}${pending.redirect}`, 302)
  } catch (e) {
    console.error('[auth] 回调失败:', String(e))
    return fail('login_failed')
  }
})

// ─── 登出 ───

r.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE) ?? ''

  if (token) {
    const session = await getSession(c.env.KV, token)
    await destroySession(c.env.KV, token)

    // Prism 侧撤销失败不影响登出：本地会话已经没了
    if (session?.refreshToken && isPrismConfigured(c.env)) {
      const cfg = prismConfig(c.env)
      const discovery = await getDiscovery(c.env.KV, cfg).catch(() => null)
      if (discovery) await revokeToken(discovery, cfg, session.refreshToken)
    }
  }

  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

// ─── 当前用户 ───

r.get('/me', async (c) => {
  const user = await resolveUser(c)
  return c.json({
    ok: true,
    user,
    configured: isPrismConfigured(c.env),
    joinUrl: c.env.PRISM_JOIN_URL ?? '',
  })
})

export default r
