// 基于 KV 的软限流。
//
// KV 是最终一致的，读-改-写在并发下会少计数，因此这**不是**精确配额，
// 而是用来削峰、抬高滥用成本。需要硬边界的地方（例如令牌绑定）另有
// 数据库层的唯一性约束兜底。
export interface RateLimitResult {
  ok: boolean
  /** 超限时距窗口结束的秒数 */
  retryAfter: number
}

export async function rateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec)
  const k = `rl:${key}:${bucket}`

  const current = Number((await kv.get(k)) ?? 0)
  if (current >= limit) {
    const elapsed = Math.floor(Date.now() / 1000) % windowSec
    return { ok: false, retryAfter: windowSec - elapsed }
  }

  // TTL 给两个窗口，避免边界处提前失效
  await kv.put(k, String(current + 1), { expirationTtl: windowSec * 2 })
  return { ok: true, retryAfter: 0 }
}

/** 取客户端 IP，Cloudflare always 提供 CF-Connecting-IP */
export function clientIp(headers: Headers): string {
  return headers.get('CF-Connecting-IP') || headers.get('X-Forwarded-For')?.split(',')[0] || 'unknown'
}
