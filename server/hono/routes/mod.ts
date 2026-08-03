// 模组授权（设计条目 F 组）—— 详见 docs/mod-authorization.md
//
// 端点、请求参数与失败时返回 200 靠 `valid` 判断的约定**都与旧实现一致**，
// 仅在响应上追加 license / expires_at / tier / code 等字段。
//
// 续期与吊销检查都复用 validate：模组本来就存着 token 与 fingerprint，
// 重新调一次即可，不需要额外端点。
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { requireLevel } from '../lib/rbac'
import { MOD_MIN_LEVEL } from '../lib/roles'
import { getConfig, nowIso } from '../lib/db'
import { clientIp, rateLimit } from '../lib/ratelimit'
import { AUDIT, recordAudit } from '../lib/audit'
import { revokeJti, signLicense, type LicenseClaims } from '../lib/license'
import { siteUrl } from '../lib/config'

const r = new Hono<AppBindings>()

interface TokenRow {
  token: string
  sub: string
  bound_fingerprint: string | null
  bound_at: string | null
  reset_at: string | null
  created_at: string
  device_name: string
  machine_hint: string | null
  last_seen_at: string | null
  current_jti: string | null
  revoked_at: string | null
  // JOIN 出来的
  display_name: string
  username: string
  role_key: string
  level: number
}

/** 失败响应：沿用旧契约的 200 + valid=false，附加机器可读的 code */
function invalid(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { valid: false as const, code, message, ...extra }
}

async function cooldownHours(db: D1Database): Promise<number> {
  return getConfig<number>(db, 'rebind_cooldown_hours', 24)
}

/** 距冷却结束的小时数，0 表示不在冷却中 */
function remainingCooldown(resetAt: string | null, hours: number): number {
  if (!resetAt) return 0
  const elapsed = Date.now() - new Date(resetAt).getTime()
  const total = hours * 3600 * 1000
  if (elapsed >= total) return 0
  return Math.ceil((total - elapsed) / (3600 * 1000))
}

// ─────────────────────────────────────────────────────────────
// 公开端点：模组校验
// ─────────────────────────────────────────────────────────────

interface ValidateBody {
  token?: string
  fingerprint?: string
  machine_hint?: string
  device_name?: string
}

r.post('/validate', async (c) => {
  const body = await c.req.json<ValidateBody>().catch((): ValidateBody => ({}))

  const token = String(body.token ?? '').trim()
  const fingerprint = String(body.fingerprint ?? '').trim()

  // 1. 限流。IP 与 token 各一道 —— 前者挡扫描，后者挡单账号刷
  const ip = clientIp(c.req.raw.headers)
  const ipLimit = await rateLimit(c.env.KV, `mod:ip:${ip}`, 30, 60)
  if (!ipLimit.ok) {
    return c.json(invalid('RATE_LIMITED', '请求过于频繁，请稍后再试'))
  }
  if (token) {
    const tokenLimit = await rateLimit(c.env.KV, `mod:tk:${token.slice(0, 24)}`, 10, 60)
    if (!tokenLimit.ok) {
      return c.json(invalid('RATE_LIMITED', '请求过于频繁，请稍后再试'))
    }
  }

  // 2. 参数
  if (!token || !fingerprint) {
    return c.json(invalid('BAD_REQUEST', '缺少 token 或 fingerprint'))
  }

  // 3. 令牌存在
  const row = await c.env.DB.prepare(
    `SELECT mt.*, u.display_name, u.username, u.role_key, r.level
       FROM mod_tokens mt
       JOIN users u ON u.sub = mt.sub
       JOIN roles r ON r.role_key = u.role_key
      WHERE mt.token = ?`,
  )
    .bind(token)
    .first<TokenRow>()

  if (!row) return c.json(invalid('TOKEN_NOT_FOUND', 'token 不存在'))

  // 4. 未被作废
  if (row.revoked_at) {
    return c.json(invalid('TOKEN_REVOKED', '此令牌已作废，请在网站重新生成'))
  }

  // 5. 身份组门槛。读的是本地 role_key，由 webhook 与静默复查保持新鲜
  if (Number(row.level) < MOD_MIN_LEVEL) {
    return c.json(
      invalid('NOT_SPONSOR', '权限不足，需要赞助者身份', {
        action_url: `${siteUrl(c.env)}/account`,
      }),
    )
  }

  const now = nowIso()
  const firstBind = !row.bound_fingerprint

  // 6. 设备绑定
  if (firstBind) {
    await c.env.DB.prepare(
      `UPDATE mod_tokens
          SET bound_fingerprint = ?, bound_at = ?, machine_hint = ?, device_name = ?
        WHERE token = ?`,
    )
      .bind(
        fingerprint,
        now,
        body.machine_hint ?? null,
        String(body.device_name ?? '').slice(0, 64),
        token,
      )
      .run()

    await recordAudit(c.env.DB, {
      actor: row.sub,
      action: AUDIT.MOD_DEVICE_BIND,
      target: fingerprint.slice(0, 16),
      detail: { deviceName: body.device_name ?? '' },
    })
  } else if (row.bound_fingerprint !== fingerprint) {
    return c.json(invalid('DEVICE_MISMATCH', '此 token 已绑定其他设备，请在网站重置绑定'))
  } else if (body.machine_hint && row.machine_hint && body.machine_hint !== row.machine_hint) {
    // 指纹相同但机器特征变了：多半是配置目录被拷贝分享。
    // 只告警不拦截 —— 换网卡、双系统的正常玩家也会命中。
    console.warn('[mod] machine_hint 变化', row.sub, fingerprint.slice(0, 8))
    await recordAudit(c.env.DB, {
      actor: row.sub,
      action: AUDIT.MOD_DEVICE_ANOMALY,
      target: fingerprint.slice(0, 16),
      detail: { from: row.machine_hint.slice(0, 16), to: body.machine_hint.slice(0, 16) },
    })
  }

  // 7. 签发 License
  const ttlHours = await getConfig<number>(c.env.DB, 'license_ttl_hours', 24)
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + ttlHours * 3600
  const jti = crypto.randomUUID()

  const claims: LicenseClaims = {
    iss: siteUrl(c.env),
    aud: 'nsuk-mod',
    sub: row.sub,
    jti,
    iat,
    exp,
    fp: fingerprint,
    tier: row.role_key,
    name: row.display_name || row.username,
  }

  let license: string
  try {
    license = await signLicense(c.env, claims)
  } catch (e) {
    console.error('[mod] License 签发失败:', String(e))
    return c.json(invalid('LICENSE_UNAVAILABLE', '授权服务暂时不可用，请稍后重试'))
  }

  await c.env.DB.prepare(
    'UPDATE mod_tokens SET current_jti = ?, last_seen_at = ? WHERE token = ?',
  )
    .bind(jti, now, token)
    .run()

  return c.json({
    valid: true,
    username: row.display_name || row.username,
    message: firstBind ? '首次激活成功' : '',
    license,
    expires_at: exp,
    tier: row.role_key,
  })
})

// ─────────────────────────────────────────────────────────────
// 网页端：令牌管理
// ─────────────────────────────────────────────────────────────

r.get('/token', requireLevel(MOD_MIN_LEVEL), async (c) => {
  const user = c.get('user')!
  const hours = await cooldownHours(c.env.DB)

  const row = await c.env.DB.prepare(
    `SELECT token, bound_fingerprint, bound_at, reset_at, created_at,
            device_name, last_seen_at
       FROM mod_tokens WHERE sub = ?`,
  )
    .bind(user.sub)
    .first<TokenRow>()

  if (!row) return c.json({ ok: true, token: null, cooldownHours: hours })

  return c.json({
    ok: true,
    token: {
      token: row.token,
      hasBound: !!row.bound_fingerprint,
      boundAt: row.bound_at,
      resetAt: row.reset_at,
      createdAt: row.created_at,
      deviceName: row.device_name,
      lastSeenAt: row.last_seen_at,
      // 前端不要再把冷却时长写死，一律以这里为准
      cooldownHours: hours,
      remainingCooldownHours: remainingCooldown(row.reset_at, hours),
    },
  })
})

/**
 * 生成令牌。已有令牌时重新生成并作废旧的。
 *
 * 重新生成会清除设备绑定，等价于一次 reset，因此**受同一冷却约束** ——
 * 否则玩家可以靠反复生成新令牌在多台设备间来回切换，冷却形同虚设。
 */
r.post('/token/generate', requireLevel(MOD_MIN_LEVEL), async (c) => {
  const user = c.get('user')!
  const hours = await cooldownHours(c.env.DB)

  const existing = await c.env.DB.prepare(
    'SELECT token, reset_at, current_jti FROM mod_tokens WHERE sub = ?',
  )
    .bind(user.sub)
    .first<TokenRow>()

  if (existing) {
    const remaining = remainingCooldown(existing.reset_at, hours)
    if (remaining > 0) {
      return c.json(
        { ok: false, code: 'REBIND_COOLDOWN', error: `冷却中，还需等待 ${remaining} 小时` },
        429,
      )
    }
    // 旧 License 立即失效，否则原设备还能用满整个有效期
    if (existing.current_jti) {
      await revokeJti(c.env.KV, existing.current_jti, Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
    }
    await c.env.DB.prepare('DELETE FROM mod_tokens WHERE sub = ?').bind(user.sub).run()
  }

  const token = crypto.randomUUID()
  const now = nowIso()

  await c.env.DB.prepare(
    `INSERT INTO mod_tokens (token, sub, created_at, reset_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(token, user.sub, now, existing ? now : null)
    .run()

  await recordAudit(c.env.DB, {
    actor: user.sub,
    action: AUDIT.MOD_TOKEN_GENERATE,
    detail: { regenerated: !!existing },
  })

  return c.json({ ok: true, token })
})

/** 重置设备绑定。冷却限制的是重置频率，重置后可立即绑定新设备 */
r.post('/token/reset', requireLevel(MOD_MIN_LEVEL), async (c) => {
  const user = c.get('user')!
  const hours = await cooldownHours(c.env.DB)

  const row = await c.env.DB.prepare(
    'SELECT token, reset_at, current_jti FROM mod_tokens WHERE sub = ?',
  )
    .bind(user.sub)
    .first<TokenRow>()

  if (!row) return c.json({ ok: false, code: 'NO_TOKEN', error: '未找到令牌' }, 404)

  const remaining = remainingCooldown(row.reset_at, hours)
  if (remaining > 0) {
    return c.json(
      { ok: false, code: 'REBIND_COOLDOWN', error: `重置冷却中，还需等待 ${remaining} 小时` },
      429,
    )
  }

  // 吊销当前 License，否则原设备在有效期内仍可正常使用，重置就没有意义
  if (row.current_jti) {
    await revokeJti(c.env.KV, row.current_jti, Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
  }

  const now = nowIso()
  await c.env.DB.prepare(
    `UPDATE mod_tokens
        SET bound_fingerprint = NULL, bound_at = NULL, machine_hint = NULL,
            device_name = '', current_jti = NULL, reset_at = ?
      WHERE token = ?`,
  )
    .bind(now, row.token)
    .run()

  await recordAudit(c.env.DB, {
    actor: user.sub,
    action: AUDIT.MOD_TOKEN_RESET,
    target: row.token.slice(0, 8),
  })

  return c.json({ ok: true, message: '设备绑定已重置' })
})

export default r
