// 捕获每个真实请求携带的 Cloudflare 绑定，供 SSR 期间的进程内调用回退使用。
// 详见 server/hono/lib/runtimeEnv.ts 的说明。
import type { Env } from '../hono/types'
import { rememberEnv } from '../hono/lib/runtimeEnv'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    rememberEnv((event.context.cloudflare as { env?: Env } | undefined)?.env)
  })
})
