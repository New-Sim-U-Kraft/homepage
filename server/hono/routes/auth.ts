// Prism OIDC 登录链路（设计条目 D 组）——待 Prism 侧适配完成后实现。
// 端点形状先定下来，前端可以照此对接。
import { Hono } from 'hono'
import type { AppBindings } from '../types'

const r = new Hono<AppBindings>()

const NOT_IMPLEMENTED = { ok: false, error: '认证链路尚未实现（D 组）' } as const

/** 跳转到 Prism 授权页（授权码 + PKCE） */
r.get('/login', (c) => c.json(NOT_IMPLEMENTED, 501))

/** Prism 回调：换 token、本地 RS256 验 ID token、建会话 */
r.get('/callback', (c) => c.json(NOT_IMPLEMENTED, 501))

/** 登出：清本地会话 + 调 Prism revoke */
r.post('/logout', (c) => c.json(NOT_IMPLEMENTED, 501))

/** 当前登录用户 */
r.get('/me', (c) => c.json(NOT_IMPLEMENTED, 501))

export default r
