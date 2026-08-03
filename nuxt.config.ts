// NSUK 官网 —— Nuxt 4 + Nitro (cloudflare_module)
// 部署形态见 wrangler.toml：静态资源走 Workers Assets，其余进 Worker。
export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',

  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
    // 让 `nuxt dev` 也能拿到 D1/KV/R2 绑定（底层是 miniflare）
    'nitro-cloudflare-dev',
  ],

  css: ['~/assets/css/main.css'],

  // 图标本地打包，不走 iconify 的远程 API：
  // 线上多一次外部请求既慢又多一个依赖点，网络不畅时图标直接不显示。
  // provider 必须是 'server'（'iconify' 恰恰是走远程的那个选项）。
  icon: {
    provider: 'server',
    serverBundle: { collections: ['lucide'] },
    clientBundle: { scan: true },
  },

  devtools: { enabled: true },

  nitro: {
    preset: 'cloudflare_module',
  },

  // 服务端配置全部由 Hono 直接从 Worker env 读取（见 server/hono/lib/config.ts），
  // 不走 runtimeConfig —— 后者依赖 unctx 异步上下文，在 Hono handler 里取不稳定。
  // 这里只保留前端需要的公开值。
  runtimeConfig: {
    public: {
      siteUrl: '',
    },
  },

  eslint: {
    config: {
      stylistic: false,
    },
  },
})
