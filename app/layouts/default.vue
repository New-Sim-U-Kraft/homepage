<script setup lang="ts">
const { state, load } = useAuth()

// SSR 期间取一次登录态，客户端复用，避免每个页面各查一遍
if (!state.value) {
  const { data } = await useAsyncData('auth:me', () => load())
  if (data.value) state.value = data.value
}
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
