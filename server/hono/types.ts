/// <reference types="@cloudflare/workers-types" />

/** Worker 绑定，与 wrangler.toml 一一对应 */
export interface Env {
  DB: D1Database
  KV: KVNamespace
  R2: R2Bucket
  ASSETS: Fetcher

  // secrets / vars（名称与 nuxt.config 的 runtimeConfig 映射一致）
  NUXT_PRISM_CLIENT_SECRET?: string
  NUXT_MOD_LICENSE_PRIVATE_KEY?: string
  NUXT_WEBHOOK_SECRET?: string
  NUXT_PUBLIC_SITE_URL?: string
}

/** 登录用户，由 D 组的会话中间件填充 */
export interface SessionUser {
  sub: string
  username: string
  displayName: string
  roleKey: string
  level: number
  permissions: string[]
}

export type AppBindings = {
  Bindings: Env
  Variables: {
    user: SessionUser | null
  }
}
