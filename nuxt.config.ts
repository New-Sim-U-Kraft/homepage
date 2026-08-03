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

  devtools: { enabled: true },

  nitro: {
    preset: 'cloudflare_module',
  },

  // 服务端配置由 wrangler 的 [vars] / secret 注入，此处只声明形状与默认值。
  // 命名对应环境变量 NUXT_PRISM_ISSUER、NUXT_PUBLIC_SITE_URL 等。
  runtimeConfig: {
    // ─── Prism OIDC（D 组，待 Prism 侧适配完成后填充）───
    prism: {
      issuer: '',
      clientId: '',
      clientSecret: '',
      // NSUK 团队 ID，用于读取 groups_in_team_<id> claim
      teamId: '',
      // 团队邀请链接注册入口
      joinUrl: '',
    },

    // ─── 模组授权（F 组）───
    mod: {
      // License 签名私钥（PKCS#8 PEM），wrangler secret put NUXT_MOD_LICENSE_PRIVATE_KEY
      licensePrivateKey: '',
      // License 有效期（小时）。内测 24，正式 168
      licenseTtlHours: 24,
      // 设备换绑冷却（小时）
      rebindCooldownHours: 24,
    },

    // ─── Prism webhook 接收 ───
    webhook: {
      // 自定义 header 中的共享密钥（Prism 的 audit webhook 无 HMAC 签名）
      secret: '',
    },

    public: {
      siteUrl: 'https://nsuk.example',
    },
  },

  eslint: {
    config: {
      stylistic: false,
    },
  },
})
