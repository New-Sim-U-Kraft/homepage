// D1 辅助。
//
// 内容表里保留 JSON blob 的那几张（external_mods / developers / site_config）
// 需要统一的容错解析：一条坏数据不该让整个列表接口 500。
export function nowIso(): string {
  return new Date().toISOString()
}

/** 宽容解析 JSON blob，失败时返回兜底值并记日志 */
export function parseJson<T>(raw: unknown, fallback: T, context = ''): T {
  if (typeof raw !== 'string' || raw === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    console.error('[db] malformed JSON', context, String(raw).slice(0, 120))
    return fallback
  }
}

/**
 * 读站点配置。运行期可调参数（License 有效期、换绑冷却等）都放这儿，
 * 避免改一个数字就要重新部署。
 */
export async function getConfig<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db
    .prepare('SELECT value FROM site_config WHERE key = ?')
    .bind(key)
    .first<{ value: string }>()
  if (!row) return fallback
  return parseJson<T>(row.value, fallback, `site_config.${key}`)
}

/** 分页参数解析，上限写死避免被要求一次拉全表 */
export function parsePaging(query: Record<string, string | undefined>, maxLimit = 50) {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), maxLimit)
  const offset = Math.max(Number(query.offset) || 0, 0)
  return { limit, offset }
}
