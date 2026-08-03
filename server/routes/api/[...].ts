// 把 /api/** 全部交给 Hono 处理。
// Cloudflare 绑定只在请求生命周期内可用，因此在 handler 内部取，不放全局。
import { toWebRequest } from 'h3'
import app from '../../hono/app'

export default defineEventHandler(async (event) => {
  const cf = event.context.cloudflare
  return app.fetch(toWebRequest(event), cf?.env, cf?.context)
})
