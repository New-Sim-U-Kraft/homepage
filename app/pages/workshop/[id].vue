<script setup lang="ts">
import type { WorkshopItem } from '#shared/types'

const route = useRoute()

const { data, error } = await useFetch<{ item: WorkshopItem }>(
  () => `/api/workshop/${route.params.id}`,
)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: '作品不存在', fatal: true })
}

useHead({ title: () => `${data.value?.item.title ?? '作品'} · 创意工坊` })
</script>

<template>
  <div v-if="data?.item" class="mx-auto max-w-3xl px-6 py-12">
    <UBadge variant="subtle" size="sm">{{ data.item.category }}</UBadge>
    <h1 class="mt-3 text-2xl font-bold">{{ data.item.title }}</h1>
    <p class="mt-1 text-sm text-(--ui-text-dimmed)">由 {{ data.item.authorName }} 投稿</p>

    <p class="mt-6 whitespace-pre-line">{{ data.item.description }}</p>

    <!-- 3D 预览待 H7 实现：服务端解析 NBT 返回紧凑渲染数据，原始文件不出站 -->
    <div
      class="mt-8 flex h-64 items-center justify-center rounded-(--ui-radius) border border-dashed border-(--ui-border) text-sm text-(--ui-text-dimmed)"
    >
      3D 预览开发中
    </div>

    <section v-if="data.item.files.length" class="mt-8">
      <h2 class="mb-2 text-sm font-semibold">包含文件</h2>
      <ul class="space-y-1 text-sm text-(--ui-text-muted)">
        <li v-for="f in data.item.files" :key="f.name">
          {{ f.name }}
          <span v-if="f.size" class="text-(--ui-text-dimmed)">
            （{{ Math.round(f.size / 1024) }} KB）
          </span>
        </li>
      </ul>
    </section>

    <section class="mt-8">
      <h2 class="mb-2 text-sm font-semibold">下载</h2>
      <div v-if="data.item.externalLinks.length" class="flex flex-wrap gap-2">
        <UButton
          v-for="link in data.item.externalLinks"
          :key="link.url"
          :to="link.url"
          target="_blank"
          rel="noreferrer nofollow"
          variant="subtle"
          trailing-icon="i-lucide-external-link"
        >
          {{ link.label }}
        </UButton>
      </div>
      <p v-else class="text-sm text-(--ui-text-dimmed)">投稿者未提供下载链接。</p>
      <p class="mt-2 text-xs text-(--ui-text-dimmed)">
        下载由投稿者提供的站外地址提供，站内不提供结构文件下载。
      </p>
    </section>
  </div>
</template>
