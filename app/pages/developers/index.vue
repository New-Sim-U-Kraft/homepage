<script setup lang="ts">
import type { DeveloperSummary } from '#shared/types'

useHead({ title: '开发者 · NSUK' })

const { data } = await useFetch<{ developers: DeveloperSummary[] }>('/api/developers')
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-12">
    <h1 class="mb-8 text-2xl font-bold">开发者</h1>

    <div v-if="data?.developers?.length" class="grid gap-4 sm:grid-cols-3">
      <NuxtLink
        v-for="dev in data.developers"
        :key="dev.slug"
        :to="`/developers/${dev.slug}`"
        class="rounded-(--ui-radius) border border-(--ui-border) p-5 transition-colors hover:border-(--ui-border-accented)"
      >
        <p class="font-medium">{{ dev.name }}</p>
        <p class="text-xs text-(--ui-text-dimmed)">{{ dev.role }}</p>
        <p class="mt-2 text-sm text-(--ui-text-muted)">{{ dev.intro }}</p>
      </NuxtLink>
    </div>

    <p v-else class="text-sm text-(--ui-text-dimmed)">暂无内容。</p>
  </div>
</template>
