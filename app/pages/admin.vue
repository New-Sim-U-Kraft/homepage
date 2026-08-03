<script setup lang="ts">
useHead({ title: '后台 · NSUK' })

const { user, level } = useAuth()

// 前端只做体验上的隐藏，真正的权限判定在每个接口的 requireCap 里
const allowed = computed(() => level.value >= 2)

const { data: stats } = await useFetch<{
  stats: { pendingWorkshop: number; openFeedback: number; users: number; licenseTtlHours: number }
}>('/api/admin/stats', { server: false, immediate: allowed.value })

const tabs = [
  { key: 'feedback', label: '反馈' },
  { key: 'workshop', label: '工坊审核' },
  { key: 'audit', label: '审计' },
]
const active = ref('feedback')
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-12">
    <h1 class="text-2xl font-bold">后台</h1>

    <div
      v-if="!user || !allowed"
      class="mt-8 rounded-(--ui-radius) border border-dashed border-(--ui-border) p-8 text-sm text-(--ui-text-dimmed)"
    >
      需要客服及以上权限。
    </div>

    <template v-else>
      <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-(--ui-radius) border border-(--ui-border) p-4">
          <p class="text-xs text-(--ui-text-dimmed)">待审作品</p>
          <p class="mt-1 text-2xl font-semibold">{{ stats?.stats.pendingWorkshop ?? '—' }}</p>
        </div>
        <div class="rounded-(--ui-radius) border border-(--ui-border) p-4">
          <p class="text-xs text-(--ui-text-dimmed)">待处理反馈</p>
          <p class="mt-1 text-2xl font-semibold">{{ stats?.stats.openFeedback ?? '—' }}</p>
        </div>
        <div class="rounded-(--ui-radius) border border-(--ui-border) p-4">
          <p class="text-xs text-(--ui-text-dimmed)">注册用户</p>
          <p class="mt-1 text-2xl font-semibold">{{ stats?.stats.users ?? '—' }}</p>
        </div>
        <div class="rounded-(--ui-radius) border border-(--ui-border) p-4">
          <p class="text-xs text-(--ui-text-dimmed)">License 有效期</p>
          <p class="mt-1 text-2xl font-semibold">{{ stats?.stats.licenseTtlHours ?? '—' }}h</p>
        </div>
      </div>

      <nav class="mt-8 flex gap-2 border-b border-(--ui-border)">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="border-b-2 px-3 py-2 text-sm transition-colors"
          :class="
            active === t.key
              ? 'border-(--ui-primary) text-(--ui-text-highlighted)'
              : 'border-transparent text-(--ui-text-muted)'
          "
          @click="active = t.key"
        >
          {{ t.label }}
        </button>
      </nav>

      <div class="mt-6">
        <AdminFeedbackTab v-if="active === 'feedback'" />
        <AdminWorkshopTab v-else-if="active === 'workshop'" />
        <AdminAuditTab v-else-if="active === 'audit'" />
      </div>

      <p class="mt-10 text-xs text-(--ui-text-dimmed)">
        用户角色由 Prism 团队身份组决定，本站不提供修改入口。需要调整权限请到 Prism 的团队页面操作。
      </p>
    </template>
  </div>
</template>
