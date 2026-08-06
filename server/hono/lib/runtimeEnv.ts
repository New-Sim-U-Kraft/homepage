// Cloudflare 绑定的兜底来源。
//
// SSR 期间 Nitro 调用自己的接口走的是进程内派发，不经过 Worker 的 fetch 入口，
// 因此 `event.context.cloudflare` 是空的 —— Hono 拿到的 env 会是 undefined，
// 表现为「页面渲染出来的数据全是空的 / 登录显示未配置」，而直接 curl 同一个
// 接口却完全正常。这个差异极难联想到成因，所以在此显式兜底。
//
// 缓存 env 对象本身是安全的：它在同一个 isolate 内始终是同一个引用，且只含
// 绑定与配置。**不要**用同样的方式缓存 executionCtx —— 那个是请求级的，
// 跨请求使用会抛错。
import type { Env } from '../types'

let captured: Env | undefined

/** 由 Nitro 插件在每个真实请求上调用 */
export function rememberEnv(env: Env | undefined): void {
  if (env) captured = env
}

/** 供进程内调用回退使用；Worker 尚未处理过任何真实请求时为 undefined */
export function rememberedEnv(): Env | undefined {
  return captured
}
