<script setup lang="ts">
import type { WorkshopItemSummary } from '#shared/types'

useHead({ title: '创意工坊 · NSUK' })

const { data } = await useFetch<{
  items: WorkshopItemSummary[]
  total: number
}>('/api/workshop')
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-12">
    <header class="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">创意工坊</h1>
        <p class="mt-2 text-sm text-(--ui-text-muted)">
          站内提供在线预览，下载请使用作品页提供的站外链接。
        </p>
      </div>
      <UButton to="/workshop/submit" variant="subtle">投稿</UButton>
    </header>

    <div v-if="data?.items?.length" class="grid gap-4 sm:grid-cols-2">
      <NuxtLink
        v-for="item in data.items"
        :key="item.id"
        :to="`/workshop/${item.id}`"
        class="rounded-(--ui-radius) border border-(--ui-border) p-5 transition-colors hover:border-(--ui-border-accented)"
      >
        <div class="flex items-center gap-2">
          <UBadge variant="subtle" size="sm">{{ item.category }}</UBadge>
          <span class="text-xs text-(--ui-text-dimmed)">{{ item.authorName }}</span>
        </div>
        <h2 class="mt-2 font-medium">{{ item.title }}</h2>
        <p class="mt-1 line-clamp-2 text-sm text-(--ui-text-muted)">{{ item.description }}</p>
      </NuxtLink>
    </div>

    <p v-else class="text-sm text-(--ui-text-dimmed)">还没有已发布的作品。</p>
  </div>
</template>
