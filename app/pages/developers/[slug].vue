<script setup lang="ts">
import type { Developer } from '#shared/types'

const route = useRoute()

const { data, error } = await useFetch<{ developer: Developer }>(
  () => `/api/developers/${route.params.slug}`,
)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: '开发者不存在', fatal: true })
}

useHead({ title: () => `${data.value?.developer.name ?? '开发者'} · NSUK` })
</script>

<template>
  <div v-if="data?.developer" class="mx-auto max-w-3xl px-6 py-12">
    <h1 class="text-2xl font-bold">{{ data.developer.name }}</h1>
    <p class="mt-1 text-sm text-(--ui-text-dimmed)">{{ data.developer.role }}</p>
    <p class="mt-4 text-(--ui-text-muted)">{{ data.developer.intro }}</p>

    <div v-if="data.developer.body" class="mt-8 whitespace-pre-line">
      {{ data.developer.body }}
    </div>

    <div v-if="data.developer.links?.length" class="mt-8 flex flex-wrap gap-2">
      <UButton
        v-for="link in data.developer.links"
        :key="link.url"
        :to="link.url"
        target="_blank"
        rel="noreferrer nofollow"
        variant="subtle"
        size="sm"
      >
        {{ link.label }}
      </UButton>
    </div>
  </div>
</template>
