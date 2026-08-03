<script setup lang="ts">
interface Entry {
  id: number
  actor: string | null
  action: string
  target: string | null
  detail: unknown
  createdAt: string
}

const filter = ref('')

const { data, status } = await useFetch<{ items: Entry[] }>('/api/admin/audit', {
  query: { action: filter, limit: 100 },
  server: false,
})

function short(v: string | null) {
  if (!v) return '—'
  return v.length > 20 ? `${v.slice(0, 20)}…` : v
}
</script>

<template>
  <div>
    <UInput
      v-model="filter"
      placeholder="按 action 前缀过滤，例如 mod. 或 workshop."
      class="mb-4 w-80"
    />

    <p v-if="status === 'pending'" class="text-sm text-(--ui-text-dimmed)">加载中…</p>
    <p v-else-if="!data?.items?.length" class="text-sm text-(--ui-text-dimmed)">没有记录。</p>

    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-(--ui-text-dimmed)">
          <tr class="border-b border-(--ui-border)">
            <th class="py-2 pr-4 font-medium">时间</th>
            <th class="py-2 pr-4 font-medium">操作</th>
            <th class="py-2 pr-4 font-medium">执行者</th>
            <th class="py-2 pr-4 font-medium">目标</th>
            <th class="py-2 font-medium">详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in data.items" :key="e.id" class="border-b border-(--ui-border)/50">
            <td class="py-2 pr-4 whitespace-nowrap text-(--ui-text-dimmed)">
              {{ new Date(e.createdAt).toLocaleString('zh-CN') }}
            </td>
            <td class="py-2 pr-4 font-mono text-xs">{{ e.action }}</td>
            <td class="py-2 pr-4 font-mono text-xs">{{ short(e.actor) }}</td>
            <td class="py-2 pr-4 font-mono text-xs">{{ short(e.target) }}</td>
            <td class="py-2 font-mono text-xs text-(--ui-text-dimmed)">
              {{ e.detail ? JSON.stringify(e.detail) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
