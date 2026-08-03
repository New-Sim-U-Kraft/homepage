// 审计日志。
//
// actor 刻意不设外键：账号在 Prism 侧被注销后，审计历史必须仍然可查，
// 否则出了问题连「谁做的」都追溯不到。
import { nowIso } from './db'

export interface AuditInput {
  actor?: string | null
  action: string
  target?: string | null
  detail?: unknown
}

export async function recordAudit(db: D1Database, input: AuditInput): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO audit_log (actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        input.actor ?? null,
        input.action,
        input.target ?? null,
        input.detail === undefined ? null : JSON.stringify(input.detail),
        nowIso(),
      )
      .run()
  } catch (e) {
    // 审计失败不该让业务操作回滚 —— 记日志即可
    console.error('[audit] 写入失败', input.action, String(e))
  }
}

export const AUDIT = {
  MOD_TOKEN_GENERATE: 'mod.token.generate',
  MOD_TOKEN_RESET: 'mod.token.reset',
  MOD_DEVICE_BIND: 'mod.device.bind',
  MOD_LICENSE_ISSUE: 'mod.license.issue',
  MOD_LICENSE_REVOKE: 'mod.license.revoke',
  MOD_DEVICE_ANOMALY: 'mod.device.anomaly',
  USER_ROLE_SYNC: 'user.role.sync',
  USER_DELETED: 'user.deleted',
} as const
