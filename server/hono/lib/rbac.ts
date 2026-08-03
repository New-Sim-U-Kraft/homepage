// 鉴权 / 角色中心。
//
// 身份来源是 Prism 团队身份组，本文件只负责「这个等级能做什么」。
// 等级：guest 0 / sponsor 1 / staff 2 / developer 3 / admin 4。
// 规则：level = L 只能管理「等级严格 < L」的对象。
//
// 注意：角色分配不在官网进行 —— role_key 由 Prism 身份组派生（设计条目 C6），
// 官网没有任何修改角色的入口，因此这里不提供 canAssignRole 之类的函数。
import type { Context, Next } from 'hono'
import type { AppBindings, SessionUser } from '../types'

export const ROLE_KEYS = ['guest', 'sponsor', 'staff', 'developer', 'admin'] as const
export type RoleKey = (typeof ROLE_KEYS)[number]

/** Prism group slug → 官网 role_key。同名映射，未识别的 slug 忽略。 */
export const GROUP_TO_ROLE: Record<string, RoleKey> = {
  sponsor: 'sponsor',
  staff: 'staff',
  developer: 'developer',
  admin: 'admin',
}

/** 权限目录 */
export const CAPS = {
  WORKSHOP_REVIEW: 'workshop.review',
  FEEDBACK_MANAGE: 'feedback.manage',
  CHANGELOG_MANAGE: 'changelog.manage',
  MODS_MANAGE: 'mods.manage',
  DEVELOPERS_MANAGE: 'developers.manage',
  AUDIT_VIEW: 'audit.view',
  SITE_CONFIGURE: 'site.configure',
} as const

export type Capability = (typeof CAPS)[keyof typeof CAPS]

export function normalizeRoleKey(v: unknown): RoleKey {
  const r = String(v ?? '')
    .trim()
    .toLowerCase()
  return (ROLE_KEYS as readonly string[]).includes(r) ? (r as RoleKey) : 'guest'
}

/**
 * 从 ID token 的 groups claim 解析出 role_key。
 *
 * claim 缺失是正常路径（普通用户就是没有任何组），映射为 guest —— 不是异常。
 * 持有多个组时取 level 最高者。
 */
export function roleFromGroups(groups: unknown, levelOfRole: (r: RoleKey) => number): RoleKey {
  if (!Array.isArray(groups) || groups.length === 0) return 'guest'
  let best: RoleKey = 'guest'
  for (const g of groups) {
    const mapped = GROUP_TO_ROLE[String(g).trim().toLowerCase()]
    if (!mapped) continue // 未识别的 slug 忽略，不阻断登录
    if (levelOfRole(mapped) > levelOfRole(best)) best = mapped
  }
  return best
}

// ─── 权限判定 ───

export function effectivePerms(user: Pick<SessionUser, 'permissions'> | null): 'ALL' | Set<string> {
  const p = user?.permissions ?? []
  return p.includes('*') ? 'ALL' : new Set(p)
}

export function hasPerm(user: SessionUser | null, cap: Capability): boolean {
  const e = effectivePerms(user)
  return e === 'ALL' || e.has(cap)
}

export function levelOf(user: SessionUser | null): number {
  return Number(user?.level ?? 0)
}

/** 能否管理某等级（严格高于） */
export function canManageLevel(actor: SessionUser | null, targetLevel: number): boolean {
  return levelOf(actor) > Number(targetLevel)
}

// ─── 中间件 ───
//
// 会话解析属于 D 组（Prism OIDC），此处先留桩：resolveUser 由 D 组实现后接入。
// 中间件签名保持稳定，业务路由可以现在就按最终形态编写。

export async function resolveUser(c: Context<AppBindings>): Promise<SessionUser | null> {
  // TODO(D组): 读 sid cookie → KV 查 sub → D1 查档案 → 组装 SessionUser
  const existing = c.get('user')
  if (existing) return existing
  c.set('user', null)
  return null
}

export function requireAuth() {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = await resolveUser(c)
    if (!user) return c.json({ ok: false, error: '未登录' }, 401)
    await next()
  }
}

export function requireLevel(min: number) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = await resolveUser(c)
    if (!user) return c.json({ ok: false, error: '未登录' }, 401)
    if (levelOf(user) < min) return c.json({ ok: false, error: '权限不足', level: levelOf(user) }, 403)
    await next()
  }
}

export function requireCap(cap: Capability) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = await resolveUser(c)
    if (!user) return c.json({ ok: false, error: '未登录' }, 401)
    if (!hasPerm(user, cap)) return c.json({ ok: false, error: '权限不足' }, 403)
    await next()
  }
}
