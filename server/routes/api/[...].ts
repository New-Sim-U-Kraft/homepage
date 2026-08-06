// 把 /api/** 全部交给 Hono 处理。
//
// env 优先取本次请求携带的绑定；SSR 期间的进程内调用没有这层 context，
// 回退到插件捕获的那份（见 server/hono/lib/runtimeEnv.ts）。
// executionCtx 不做回退 —— 它是请求级的，跨请求使用会抛错，
// Hono 侧一律以 `c.executionCtx?.` 可选调用。
import { toWebRequest } from 'h3'
import app from '../../hono/app'
import { rememberedEnv } from '../../hono/lib/runtimeEnv'

export default defineEventHandler(async (event) => {
  const cf = event.context.cloudflare
  return app.fetch(toWebRequest(event), cf?.env ?? rememberedEnv(), cf?.context)
})
