<script setup lang="ts">
import type { Announcement, ChangelogEntry, ExternalMod } from '#shared/types'

useHead({ title: 'NSUK · 新模拟大都市' })

// 三个公开接口彼此独立，并行取，任一失败不拖垮整页
const [{ data: announcements }, { data: changelog }, { data: mods }] = await Promise.all([
  useFetch<{ announcements: Announcement[] }>('/api/announcements'),
  useFetch<{ entries: ChangelogEntry[] }>('/api/changelog', { query: { limit: 5 } }),
  useFetch<{ mods: ExternalMod[] }>('/api/external-mods'),
])

const levelColor = {
  info: 'neutral',
  warning: 'warning',
  important: 'error',
} as const
</script>

<template>
  <div class="mx-auto max-w-5xl px-6">
    <section class="py-20">
      <h1 class="text-4xl font-bold tracking-tight">新模拟大都市</h1>
      <p class="mt-3 max-w-xl text-(--ui-text-muted)">
        一个 Minecraft 模组项目。创意工坊、开发者主页与内测授权都在这里。
      </p>
      <div class="mt-6 flex gap-3">
        <UButton to="/workshop">浏览创意工坊</UButton>
        <UButton to="/developers" variant="subtle">认识开发者</UButton>
      </div>
    </section>

    <section v-if="announcements?.announcements?.length" class="space-y-3 pb-12">
      <UAlert
        v-for="a in announcements.announcements"
        :key="a.id"
        :color="levelColor[a.level] ?? 'neutral'"
        variant="subtle"
        :title="a.title"
        :description="a.body"
      />
    </section>

    <section class="grid gap-10 pb-12 md:grid-cols-2">
      <div>
        <h2 class="mb-4 text-lg font-semibold">最近更新</h2>
        <div v-if="changelog?.entries?.length" class="space-y-4">
          <article
            v-for="entry in changelog.entries"
            :key="entry.id"
            class="border-l-2 border-(--ui-border-accented) pl-4"
          >
            <div class="flex items-baseline gap-2">
              <UBadge variant="subtle" size="sm">{{ entry.version }}</UBadge>
              <time class="text-xs text-(--ui-text-dimmed)">
                {{ new Date(entry.publishedAt).toLocaleDateString('zh-CN') }}
              </time>
            </div>
            <h3 class="mt-1 font-medium">{{ entry.title }}</h3>
            <p class="mt-1 text-sm text-(--ui-text-muted)">{{ entry.body }}</p>
          </article>
        </div>
        <p v-else class="text-sm text-(--ui-text-dimmed)">暂无更新记录。</p>
      </div>

      <div>
        <h2 class="mb-4 text-lg font-semibold">相关模组</h2>
        <div v-if="mods?.mods?.length" class="space-y-3">
          <a
            v-for="mod in mods.mods"
            :key="mod.id"
            :href="mod.url"
            target="_blank"
            rel="noreferrer nofollow"
            class="block rounded-(--ui-radius) border border-(--ui-border) p-4 transition-colors hover:border-(--ui-border-accented)"
          >
            <p class="font-medium">{{ mod.name }}</p>
            <p class="mt-1 text-sm text-(--ui-text-muted)">{{ mod.description }}</p>
          </a>
        </div>
        <p v-else class="text-sm text-(--ui-text-dimmed)">暂无内容。</p>
      </div>
    </section>
  </div>
</template>
