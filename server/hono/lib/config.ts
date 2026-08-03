// 配置读取。
//
// Hono 直接从 Worker 的 env 读，不走 Nitro 的 runtimeConfig —— 后者依赖
// unctx 的异步上下文，在 Hono handler 里取不稳定，而 env 本来就是每个
// 请求都带着的。变量与 secret 都在 wrangler.toml 里声明。
import type { Env } from '../types'

export interface PrismConfig {
  issuer: string
  clientId: string
  clientSecret: string
  teamId: string
  joinUrl: string
}

export class ConfigError extends Error {
  constructor(key: string) {
    super(`缺少配置：${key}`)
    this.name = 'ConfigError'
  }
}

function required(env: Env, key: keyof Env): string {
  const v = env[key]
  if (typeof v !== 'string' || v === '') throw new ConfigError(String(key))
  return v
}

export function prismConfig(env: Env): PrismConfig {
  return {
    issuer: required(env, 'PRISM_ISSUER').replace(/\/+$/, ''),
    clientId: required(env, 'PRISM_CLIENT_ID'),
    clientSecret: required(env, 'PRISM_CLIENT_SECRET'),
    teamId: required(env, 'PRISM_TEAM_ID'),
    joinUrl: env.PRISM_JOIN_URL ?? '',
  }
}

/** 配置是否齐备。用于在未接入 Prism 时让登录入口优雅降级而不是 500 */
export function isPrismConfigured(env: Env): boolean {
  try {
    prismConfig(env)
    return true
  } catch {
    return false
  }
}

export function siteUrl(env: Env): string {
  return (env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

/** cookie 是否加 Secure。本地 http 开发时必须关掉，否则浏览器不会存 */
export function cookieSecure(env: Env): boolean {
  return siteUrl(env).startsWith('https://')
}
