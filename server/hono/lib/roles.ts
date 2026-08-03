// 角色常量与纯判定函数。
//
// 刻意不依赖任何 IO —— 中间件在 rbac.ts，用户读写在 users.ts，
// 两者都依赖本文件；本文件依赖它们任何一个都会形成循环。
//
// 角色由 Prism 团队身份组派生（设计条目 C6），官网没有任何分配入口，
// 因此这里也不提供 canAssignRole 之类的函数。
import type { SessionUser } from '../types'

export const ROLE_KEYS = ['guest', 'sponsor', 'staff', 'developer', 'admin'] as const
export type RoleKey = (typeof ROLE_KEYS)[number]

/** Prism group slug → 官网 role_key */
export const GROUP_TO_ROLE: Record<string, RoleKey> = {
  sponsor: 'sponsor',
  staff: 'staff',
  developer: 'developer',
  admin: 'admin',
}

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

/** 模组授权门槛：赞助者及以上 */
export const MOD_MIN_LEVEL = 1

export function normalizeRoleKey(v: unknown): RoleKey {
  const r = String(v ?? '')
    .trim()
    .toLowerCase()
  return (ROLE_KEYS as readonly string[]).includes(r) ? (r as RoleKey) : 'guest'
}

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
