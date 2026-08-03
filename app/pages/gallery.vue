<script setup lang="ts">
useHead({ title: '画廊 · NSUK' })

const { data } = await useFetch<{
  images: { url: string; title: string; workshopId: string }[]
}>('/api/gallery')
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-12">
    <h1 class="text-2xl font-bold">画廊</h1>
    <p class="mt-2 text-sm text-(--ui-text-muted)">来自创意工坊已发布作品的截图。</p>

    <div v-if="data?.images?.length" class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <NuxtLink
        v-for="(img, i) in data.images"
        :key="`${img.workshopId}-${i}`"
        :to="`/workshop/${img.workshopId}`"
        class="group relative overflow-hidden rounded-(--ui-radius) border border-(--ui-border)"
      >
        <img
          :src="img.url"
          :alt="img.title"
          loading="lazy"
          class="aspect-video w-full object-cover transition-transform group-hover:scale-105"
        >
        <span
          class="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          {{ img.title }}
        </span>
      </NuxtLink>
    </div>

    <p v-else class="mt-8 text-sm text-(--ui-text-dimmed)">还没有图片。</p>
  </div>
</template>
