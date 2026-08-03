<script setup lang="ts">
const route = useRoute()

const { data, error } = await useFetch<{
  user: {
    username: string
    displayName: string
    avatar: string
    intro: string
    cover: string
    developerSlug: string
    roleName: string
    level: number
    joinedAt: string
  }
  works: { id: string; title: string; category: string; cover: string | null }[]
}>(() => `/api/users/${route.params.username}`)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: '用户不存在', fatal: true })
}

useHead({ title: () => `${data.value?.user.displayName ?? '用户'} · NSUK` })
</script>

<template>
  <div v-if="data?.user" class="mx-auto max-w-3xl px-6 py-12">
    <div class="flex items-center gap-4">
      <img
        v-if="data.user.avatar"
        :src="data.user.avatar"
        :alt="data.user.displayName"
        class="size-16 rounded-full object-cover"
      >
      <div
        v-else
        class="flex size-16 items-center justify-center rounded-full bg-(--ui-bg-elevated) text-xl"
      >
        {{ data.user.displayName.slice(0, 1) }}
      </div>

      <div>
        <h1 class="text-xl font-bold">{{ data.user.displayName }}</h1>
        <div class="mt-1 flex items-center gap-2">
          <span class="text-sm text-(--ui-text-dimmed)">@{{ data.user.username }}</span>
          <UBadge v-if="data.user.level > 0" size="sm" variant="subtle">
            {{ data.user.roleName }}
          </UBadge>
        </div>
      </div>
    </div>

    <p v-if="data.user.intro" class="mt-6 text-(--ui-text-muted)">{{ data.user.intro }}</p>

    <NuxtLink
      v-if="data.user.developerSlug"
      :to="`/developers/${data.user.developerSlug}`"
      class="mt-4 inline-block text-sm text-(--ui-primary) underline"
    >
      查看开发者主页
    </NuxtLink>

    <section v-if="data.works.length" class="mt-10">
      <h2 class="mb-4 text-lg font-semibold">投稿作品</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <NuxtLink
          v-for="w in data.works"
          :key="w.id"
          :to="`/workshop/${w.id}`"
          class="rounded-(--ui-radius) border border-(--ui-border) p-4 transition-colors hover:border-(--ui-border-accented)"
        >
          <UBadge size="sm" variant="subtle">{{ w.category }}</UBadge>
          <p class="mt-2 font-medium">{{ w.title }}</p>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
