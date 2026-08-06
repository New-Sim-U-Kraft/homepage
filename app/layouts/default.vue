<script setup lang="ts">
const { state } = useAuth()

/**
 * 登录态必须用 useFetch 取，不能用裸 $fetch。
 *
 * SSR 期间 Nitro 调用自己的接口走进程内派发：useFetch 内部经由
 * useRequestFetch() 会带上当前请求的 context（其中就有 Cloudflare 绑定），
 * 而裸 $fetch 不会 —— 服务端拿到的 env 是 undefined，表现为「登录显示未配置」
 * 或直接失败，但同一个接口用 curl 打却完全正常，极难联想到成因。
 */
const { data } = await useFetch<typeof state.value>('/api/auth/me')
if (data.value) state.value = data.value
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <AppHeader />
    <main class="flex-1">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
