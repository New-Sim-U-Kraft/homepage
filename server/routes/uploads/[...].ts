// /uploads/** 走独立的 Hono 应用（见 server/hono/routes/uploads.ts）。
// 与 /api 分开挂载，因为对象 URL 直接对外暴露，不该带 /api 前缀。
import { toWebRequest } from 'h3'
import uploads from '../../hono/routes/uploads'

export default defineEventHandler(async (event) => {
  const cf = event.context.cloudflare
  return uploads.fetch(toWebRequest(event), cf?.env, cf?.context)
})
