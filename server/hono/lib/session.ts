// 会话存储。
//
// KV key 用 SHA-256(token) 而不是明文 token：token 本身是 32 字节密码学随机值，
// 哈希不可逆，因此 KV 被读到也无法反推出可用的 cookie 值。这比 HMAC 少一个
// 需要保管的 secret，安全性等价（高熵输入不存在字典攻击面）。
import { randomToken, base64UrlEncode, sha256 } from './crypto'

export const SESSION_COOKIE = 'sid'
const SESSION_TTL_SEC = 7 * 24 * 3600

/** 身份组复查间隔：超过这个时长就用 refresh token 静默拉一次新的 ID token */
export const GROUPS_REFRESH_INTERVAL_MS = 15 * 60 * 1000

export interface SessionData {
  sub: string
  /**
   * 用于静默复查身份组（设计条目 D6）。掉赞助的用户不会主动来网页，
   * 没有它就只能等 License 自然过期。
   */
  refreshToken?: string
  /** 上次从 Prism 同步身份组的时间戳 */
  groupsSyncedAt: number
  createdAt: number
}

async function keyOf(token: string): Promise<string> {
  return base64UrlEncode(await sha256(token))
}

export async function createSession(
  kv: KVNamespace,
  data: Omit<SessionData, 'createdAt'>,
): Promise<string> {
  const token = randomToken()
  const h = await keyOf(token)
  const payload: SessionData = { ...data, createdAt: Date.now() }

  await kv.put(`session:${h}`, JSON.stringify(payload), { expirationTtl: SESSION_TTL_SEC })
  // 按用户建二级索引，用于「掉组即踢下线」的批量失效
  await kv.put(`usess:${data.sub}:${h}`, '1', { expirationTtl: SESSION_TTL_SEC })

  return token
}

export async function getSession(kv: KVNamespace, token: string): Promise<SessionData | null> {
  if (!token) return null
  return kv.get<SessionData>(`session:${await keyOf(token)}`, 'json')
}

export async function touchSession(
  kv: KVNamespace,
  token: string,
  patch: Partial<SessionData>,
): Promise<void> {
  const h = await keyOf(token)
  const current = await kv.get<SessionData>(`session:${h}`, 'json')
  if (!current) return
  await kv.put(`session:${h}`, JSON.stringify({ ...current, ...patch }), {
    expirationTtl: SESSION_TTL_SEC,
  })
}

export async function destroySession(kv: KVNamespace, token: string): Promise<void> {
  if (!token) return
  const h = await keyOf(token)
  const data = await kv.get<SessionData>(`session:${h}`, 'json')
  await kv.delete(`session:${h}`)
  if (data?.sub) await kv.delete(`usess:${data.sub}:${h}`)
}

/**
 * 取该用户任一可用的 refresh token。
 *
 * webhook 回查时用：Prism 的 audit webhook 无签名且不可重试，payload 不能
 * 直接信，拿到 refresh token 才能主动向 Prism 核实真实身份组。
 * 用户从未登录过网页（或会话已过期）时返回 null，此时只能退而信任 payload。
 */
export async function anyRefreshToken(kv: KVNamespace, sub: string): Promise<string | null> {
  const listed = await kv.list({ prefix: `usess:${sub}:`, limit: 10 })
  for (const k of listed.keys) {
    const h = k.name.slice(`usess:${sub}:`.length)
    const data = await kv.get<SessionData>(`session:${h}`, 'json')
    if (data?.refreshToken) return data.refreshToken
  }
  return null
}

/** 踢掉某用户的全部会话。掉组、账号注销、管理员操作时调用 */
export async function destroySessionsForUser(kv: KVNamespace, sub: string): Promise<void> {
  let cursor: string | undefined
  do {
    const listed = await kv.list({ prefix: `usess:${sub}:`, cursor })
    for (const k of listed.keys) {
      const h = k.name.slice(`usess:${sub}:`.length)
      await kv.delete(`session:${h}`)
      await kv.delete(k.name)
    }
    cursor = listed.list_complete ? undefined : listed.cursor
  } while (cursor)
}
