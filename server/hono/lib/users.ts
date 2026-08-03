// 用户档案的读写与身份组同步。
//
// 档案表只存「此人在 NSUK 是什么」，身份（账号、邮箱、2FA）全在 Prism。
// role_key 是派生字段，官网没有任何手动修改它的入口。
import type { SessionUser } from '../types'
import { nowIso, parseJson } from './db'
import { GROUP_TO_ROLE, type RoleKey } from './roles'
import type { IdTokenClaims } from './oidc'
import { groupsOfTeam } from './oidc'

interface UserRow {
  sub: string
  username: string
  display_name: string
  avatar_override: string
  role_key: string
  qq: string
  intro: string
  cover: string
  wall_type: string
  developer_slug: string
  deleted_at: string | null
  level: number
  role_name: string
  permissions: string
}

const SELECT_USER = `
  SELECT u.*, r.level AS level, r.name AS role_name, r.permissions AS permissions
    FROM users u JOIN roles r ON r.role_key = u.role_key
   WHERE u.sub = ?`

export function shapeSessionUser(row: UserRow): SessionUser {
  return {
    sub: row.sub,
    username: row.username,
    displayName: row.display_name || row.username,
    roleKey: row.role_key,
    level: Number(row.level ?? 0),
    permissions: parseJson<string[]>(row.permissions, [], `roles.${row.role_key}`),
  }
}

export async function loadUser(db: D1Database, sub: string): Promise<SessionUser | null> {
  const row = await db.prepare(SELECT_USER).bind(sub).first<UserRow>()
  if (!row || row.deleted_at) return null
  return shapeSessionUser(row)
}

/** 各身份组的 level，用于「持有多个组时取最高」 */
async function levelMap(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db.prepare('SELECT role_key, level FROM roles').all<{
    role_key: string
    level: number
  }>()
  return Object.fromEntries(results.map((r) => [r.role_key, Number(r.level)]))
}

/**
 * 把 Prism 身份组 claim 映射成 role_key。
 *
 * claim 缺失返回 guest —— 这是正常路径而非异常，绝大多数用户就是没有任何组。
 * 未识别的 slug 记 warn 后忽略，不阻断登录。
 */
export async function roleFromClaims(
  db: D1Database,
  claims: IdTokenClaims,
  teamId: string,
): Promise<RoleKey> {
  const slugs = groupsOfTeam(claims, teamId)
  if (slugs.length === 0) return 'guest'

  const levels = await levelMap(db)
  let best: RoleKey = 'guest'
  for (const slug of slugs) {
    const mapped = GROUP_TO_ROLE[slug.trim().toLowerCase()]
    if (!mapped) {
      console.warn('[users] 未识别的身份组 slug:', slug)
      continue
    }
    if ((levels[mapped] ?? 0) > (levels[best] ?? 0)) best = mapped
  }
  return best
}

/** 用户名冲突时退让：Prism 的 preferred_username 可能与本地已有记录撞车 */
async function resolveUsername(db: D1Database, sub: string, preferred: string): Promise<string> {
  const base = (preferred || sub).trim().slice(0, 32) || sub
  const clash = await db
    .prepare('SELECT sub FROM users WHERE username = ? AND sub != ?')
    .bind(base, sub)
    .first<{ sub: string }>()
  if (!clash) return base
  return `${base}-${sub.slice(0, 6)}`
}

/**
 * 登录时建档 / 更新档案。
 *
 * 只写 Prism 侧字段与派生的 role_key，站内属性（intro、cover、qq 等）
 * 由用户自己在账号中心维护，这里绝不覆盖。
 */
export async function upsertUserFromClaims(
  db: D1Database,
  claims: IdTokenClaims,
  roleKey: RoleKey,
): Promise<SessionUser> {
  const now = nowIso()
  const username = await resolveUsername(
    db,
    claims.sub,
    String(claims.preferred_username ?? '').trim(),
  )
  const displayName = String(claims.name ?? '').trim() || username

  await db
    .prepare(
      `INSERT INTO users (sub, username, display_name, role_key, groups_synced_at,
                          created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET
         username         = excluded.username,
         display_name     = excluded.display_name,
         role_key         = excluded.role_key,
         groups_synced_at = excluded.groups_synced_at,
         updated_at       = excluded.updated_at,
         last_login_at    = excluded.last_login_at,
         deleted_at       = NULL`,
    )
    .bind(claims.sub, username, displayName, roleKey, now, now, now, now)
    .run()

  const user = await loadUser(db, claims.sub)
  if (!user) throw new Error('建档后读取用户失败')
  return user
}

/** 仅更新身份组（静默复查与 webhook 回查用），不动登录时间 */
export async function syncRole(db: D1Database, sub: string, roleKey: RoleKey): Promise<boolean> {
  const before = await db
    .prepare('SELECT role_key FROM users WHERE sub = ?')
    .bind(sub)
    .first<{ role_key: string }>()
  if (!before) return false

  const changed = before.role_key !== roleKey
  const now = nowIso()
  await db
    .prepare('UPDATE users SET role_key = ?, groups_synced_at = ?, updated_at = ? WHERE sub = ?')
    .bind(roleKey, now, now, sub)
    .run()

  return changed
}

/** 账号在 Prism 侧被注销。保留行，否则工坊作品与审计会指向空 */
export async function markUserDeleted(db: D1Database, sub: string): Promise<void> {
  const now = nowIso()
  await db
    .prepare(
      `UPDATE users SET deleted_at = ?, role_key = 'guest', updated_at = ? WHERE sub = ? AND deleted_at IS NULL`,
    )
    .bind(now, now, sub)
    .run()
}
