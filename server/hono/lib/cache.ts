/**
 * 边缘缓存访问。
 *
 * `caches.default` 是 Cloudflare 的扩展；在 Nitro 的 Node 开发环境里整个
 * `caches` 全局都不存在，直接访问会抛 ReferenceError 而不是返回 undefined。
 */
export function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches
  return c?.default ?? null
}
