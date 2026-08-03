<script setup lang="ts">
// M0 脚手架占位页。真实首页在 M2 实现。
const { data: health } = await useFetch('/api/_ping')
</script>

<template>
  <div class="mx-auto max-w-2xl px-6 py-24">
    <h1 class="text-3xl font-bold">NSUK</h1>
    <p class="mt-2 text-(--ui-text-muted)">官网重构脚手架已就绪。</p>

    <UCard class="mt-8">
      <template #header>绑定自检</template>
      <pre class="overflow-x-auto text-sm">{{ health }}</pre>
    </UCard>
  </div>
</template>
