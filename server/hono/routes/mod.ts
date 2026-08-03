// 模组授权（设计条目 F 组）—— 详见 docs/mod-authorization.md
//
// 端点与请求参数**与旧实现完全一致**，仅在响应上做向后兼容的扩展：
//   validate 额外返回 license / expires_at / tier / code
//
// 实现留到 M4：它依赖 D 组的会话（token/generate、token/reset 需要登录）
// 与身份组同步（validate 要读 role_key）。
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { requireLevel } from '../lib/rbac'

const r = new Hono<AppBindings>()

const NOT_IMPLEMENTED = { ok: false, error: '模组授权尚未实现（F 组）' } as const

/**
 * 公开端点：模组校验令牌与设备指纹，首次调用自动绑定。
 * 成功时返回 License JWT，模组本地验签后即可离线使用。
 *
 * 注意：沿用旧契约，失败也返回 200，由 `valid` 字段判断。
 */
r.post('/validate', (c) =>
  c.json({ valid: false, code: 'NOT_IMPLEMENTED', message: '模组授权尚未实现' }),
)

/** 查询当前令牌与绑定状态 */
r.get('/token', requireLevel(1), (c) => c.json(NOT_IMPLEMENTED, 501))

/** 生成令牌；已存在时重新生成并作废旧令牌 */
r.post('/token/generate', requireLevel(1), (c) => c.json(NOT_IMPLEMENTED, 501))

/** 重置设备绑定，受冷却约束 */
r.post('/token/reset', requireLevel(1), (c) => c.json(NOT_IMPLEMENTED, 501))

export default r
