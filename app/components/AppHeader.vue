<script setup lang="ts">
const nav = [
  { label: '首页', to: '/' },
  { label: '创意工坊', to: '/workshop' },
  { label: '开发者', to: '/developers' },
  { label: '反馈', to: '/feedback' },
]

const route = useRoute()
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))
</script>

<template>
  <header
    class="sticky top-0 z-50 border-b border-(--ui-border) bg-(--ui-bg)/80 backdrop-blur"
  >
    <div class="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
      <NuxtLink to="/" class="font-semibold tracking-tight">NSUK</NuxtLink>

      <nav class="flex items-center gap-4 text-sm">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="transition-colors hover:text-(--ui-text-highlighted)"
          :class="isActive(item.to) ? 'text-(--ui-text-highlighted)' : 'text-(--ui-text-muted)'"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="ml-auto">
        <!-- TODO(D组): 接入 Prism 登录态后替换为用户菜单 -->
        <UButton to="/account" size="sm" variant="soft">账号</UButton>
      </div>
    </div>
  </header>
</template>
