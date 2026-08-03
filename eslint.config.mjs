// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    // 服务端代码大量使用 D1 返回的动态形状，逐个建模收益不高
    '@typescript-eslint/no-explicit-any': 'warn',
    'vue/multi-word-component-names': 'off',
  },
  ignores: ['.output/**', '.nuxt/**', '.wrangler/**', 'migrations/**'],
})
