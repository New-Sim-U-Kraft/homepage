<script setup lang="ts">
interface Item {
  id: string
  title: string
  category: string
  description: string
  externalLinks: { label: string; url: string }[]
  authorName: string
  status: string
  reviewReason: string
  createdAt: string
}

const toast = useToast()
const status = ref('pending')

const { data, refresh, status: fetchStatus } = await useFetch<{ items: Item[] }>(
  '/api/admin/workshop',
  { query: { status }, server: false },
)

const reasons = reactive<Record<string, string>>({})
const busy = ref('')

async function review(id: string, next: string) {
  if (next === 'rejected' && !reasons[id]?.trim()) {
    toast.add({ title: '驳回需要填写原因', color: 'error' })
    return
  }
  busy.value = id
  try {
    await $fetch(`/api/admin/workshop/${id}`, {
      method: 'PATCH',
      body: { status: next, reason: reasons[id] ?? '' },
    })
    toast.add({ title: next === 'published' ? '已发布' : '已驳回', color: 'success' })
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
        v-for="s in ['pending', 'published', 'rejected']"
        :key="s"
        size="sm"
        :variant="status === s ? 'solid' : 'ghost'"
        @click="status = s"
      >
        {{ { pending: '待审核', published: '已发布', rejected: '已驳回' }[s] }}
      </UButton>
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
          <UBadge size="sm" variant="subtle">{{ item.category }}</UBadge>
          <span class="font-medium">{{ item.title }}</span>
          <span class="text-xs text-(--ui-text-dimmed)">{{ item.authorName }}</span>
        </div>

        <p class="mt-2 whitespace-pre-line text-sm text-(--ui-text-muted)">{{ item.description }}</p>

        <!-- 审核要点：核对站外链接指向的文件与投稿是否一致 -->
        <div v-if="item.externalLinks?.length" class="mt-3">
          <p class="text-xs text-(--ui-text-dimmed)">站外下载链接（需人工核对）</p>
          <ul class="mt-1 space-y-1">
            <li v-for="link in item.externalLinks" :key="link.url" class="text-sm">
              <a
                :href="link.url"
                target="_blank"
                rel="noreferrer nofollow"
                class="text-(--ui-primary) underline"
              >
                {{ link.label || link.url }}
              </a>
            </li>
          </ul>
        </div>
        <p v-else class="mt-3 text-sm text-(--ui-text-warning)">未提供下载链接</p>

        <p v-if="item.reviewReason" class="mt-2 text-sm text-(--ui-text-dimmed)">
          审核意见：{{ item.reviewReason }}
        </p>

        <div v-if="item.status === 'pending'" class="mt-3 space-y-2">
          <UInput v-model="reasons[item.id]" placeholder="驳回原因（驳回时必填）" class="w-full" />
          <div class="flex gap-2">
            <UButton size="sm" :loading="busy === item.id" @click="review(item.id, 'published')">
              通过并发布
            </UButton>
            <UButton
              size="sm"
              color="error"
              variant="ghost"
              :loading="busy === item.id"
              @click="review(item.id, 'rejected')"
            >
              驳回
            </UButton>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
