<script setup lang="ts">
const { user, configured, roleLabel, login, logout } = useAuth()

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
  <header class="sticky top-0 z-50 border-b border-(--ui-border) bg-(--ui-bg)/80 backdrop-blur">
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

      <div class="ml-auto flex items-center gap-3">
        <template v-if="user">
          <NuxtLink to="/account" class="flex items-center gap-2 text-sm">
            <span>{{ user.displayName }}</span>
            <UBadge v-if="user.level > 0" size="sm" variant="subtle">{{ roleLabel }}</UBadge>
          </NuxtLink>
          <UButton size="sm" variant="ghost" @click="logout">登出</UButton>
        </template>

        <UButton v-else-if="configured" size="sm" variant="soft" @click="login()">登录</UButton>

        <!-- Prism 未配置时不显示可点的登录按钮，避免点了什么也不发生 -->
        <span v-else class="text-sm text-(--ui-text-dimmed)">登录未配置</span>
      </div>
    </div>
  </header>
</template>
