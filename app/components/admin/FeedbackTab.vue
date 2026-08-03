<script setup lang="ts">
interface Item {
  id: string
  category: string
  title: string
  content: string
  contact: string
  status: string
  reply: string
  authorName: string
  createdAt: string
}

const toast = useToast()
const status = ref('open')

const { data, refresh, status: fetchStatus } = await useFetch<{ items: Item[]; total: number }>(
  '/api/admin/feedback',
  { query: { status }, server: false },
)

const replies = reactive<Record<string, string>>({})
const busy = ref('')

const CATEGORY_LABEL: Record<string, string> = {
  bug: '程序问题',
  suggestion: '建议',
  'link-dead': '链接失效',
  other: '其他',
}

async function handle(id: string, next: string) {
  busy.value = id
  try {
    await $fetch(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      body: { status: next, reply: replies[id] ?? '' },
    })
    toast.add({ title: '已更新', color: 'success' })
    await refresh()
  } catch (e) {
    const err = e as { data?: { error?: string } }
    toast.add({ title: err.data?.error ?? '操作失败', color: 'error' })
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center gap-2">
      <UButton
        v-for="s in ['open', 'resolved', 'rejected']"
        :key="s"
        size="sm"
        :variant="status === s ? 'solid' : 'ghost'"
        @click="status = s"
      >
        {{ { open: '待处理', resolved: '已处理', rejected: '已关闭' }[s] }}
      </UButton>
      <span class="ml-auto text-sm text-(--ui-text-dimmed)">共 {{ data?.total ?? 0 }} 条</span>
    </div>

    <p v-if="fetchStatus === 'pending'" class="text-sm text-(--ui-text-dimmed)">加载中…</p>
    <p v-else-if="!data?.items?.length" class="text-sm text-(--ui-text-dimmed)">没有记录。</p>

    <div v-else class="space-y-4">
      <article
        v-for="item in data.items"
        :key="item.id"
        class="rounded-(--ui-radius) border border-(--ui-border) p-4"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UBadge size="sm" variant="subtle">{{ CATEGORY_LABEL[item.category] ?? item.category }}</UBadge>
          <span class="font-medium">{{ item.title }}</span>
          <span class="text-xs text-(--ui-text-dimmed)">{{ item.authorName }}</span>
          <time class="ml-auto text-xs text-(--ui-text-dimmed)">
            {{ new Date(item.createdAt).toLocaleString('zh-CN') }}
          </time>
        </div>

        <p class="mt-2 whitespace-pre-line text-sm text-(--ui-text-muted)">{{ item.content }}</p>
        <p v-if="item.contact" class="mt-1 text-xs text-(--ui-text-dimmed)">
          联系方式：{{ item.contact }}
        </p>

        <p v-if="item.reply" class="mt-2 border-l-2 border-(--ui-border-accented) pl-3 text-sm">
          {{ item.reply }}
        </p>

        <div v-if="item.status === 'open'" class="mt-3 space-y-2">
          <UTextarea
            v-model="replies[item.id]"
            :rows="2"
            placeholder="回复内容（可选）"
            class="w-full"
          />
          <div class="flex gap-2">
            <UButton size="sm" :loading="busy === item.id" @click="handle(item.id, 'resolved')">
              标记已处理
            </UButton>
            <UButton
              size="sm"
              variant="ghost"
              :loading="busy === item.id"
              @click="handle(item.id, 'rejected')"
            >
              关闭
            </UButton>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
