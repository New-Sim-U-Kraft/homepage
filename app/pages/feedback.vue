<script setup lang="ts">
useHead({ title: '反馈 · NSUK' })

const { user, configured, login } = useAuth()
const toast = useToast()

const CATEGORIES = [
  { value: 'bug', label: '程序问题' },
  { value: 'suggestion', label: '建议' },
  { value: 'link-dead', label: '作品下载链接失效' },
  { value: 'other', label: '其他' },
]

const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  resolved: '已处理',
  rejected: '已关闭',
}

const form = reactive({ category: 'bug', title: '', content: '', contact: '' })
const submitting = ref(false)

const { data: mine, refresh } = await useFetch<{
  items: {
    id: string
    category: string
    title: string
    status: string
    reply: string
    createdAt: string
  }[]
}>('/api/feedback/mine', { server: false, immediate: !!user.value })

async function submit() {
  if (!form.title.trim() || !form.content.trim()) {
    toast.add({ title: '标题与内容不能为空', color: 'error' })
    return
  }
  submitting.value = true
  try {
    await $fetch('/api/feedback', { method: 'POST', body: form })
    toast.add({ title: '已提交，感谢反馈', color: 'success' })
    form.title = ''
    form.content = ''
    form.contact = ''
    await refresh()
  } catch (e) {
    const err = e as { data?: { error?: string } }
    toast.add({ title: err.data?.error ?? '提交失败', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-12">
    <h1 class="text-2xl font-bold">反馈</h1>
    <p class="mt-2 text-sm text-(--ui-text-muted)">
      提交程序问题、建议，或上报失效的作品下载链接。
    </p>

    <!-- 未登录 -->
    <div
      v-if="!user"
      class="mt-8 rounded-(--ui-radius) border border-dashed border-(--ui-border) p-8 text-center"
    >
      <p class="text-sm text-(--ui-text-muted)">提交反馈需要先登录。</p>
      <UButton v-if="configured" class="mt-4" @click="login('/feedback')">登录</UButton>
      <p v-else class="mt-2 text-xs text-(--ui-text-dimmed)">登录尚未配置。</p>
    </div>

    <!-- 表单 -->
    <template v-else>
      <div class="mt-8 space-y-4">
        <UFormField label="类型">
          <USelect v-model="form.category" :items="CATEGORIES" value-key="value" class="w-56" />
        </UFormField>

        <UFormField label="标题">
          <UInput v-model="form.title" :maxlength="80" placeholder="一句话说明问题" />
        </UFormField>

        <UFormField label="详细描述">
          <UTextarea
            v-model="form.content"
            :maxlength="2000"
            :rows="6"
            placeholder="尽量写清复现步骤、游戏版本、模组版本"
          />
        </UFormField>

        <UFormField label="联系方式" hint="选填">
          <UInput v-model="form.contact" :maxlength="120" placeholder="QQ / 邮箱，便于回复" />
        </UFormField>

        <UButton :loading="submitting" @click="submit">提交</UButton>
      </div>

      <!-- 我的反馈 -->
      <section v-if="mine?.items?.length" class="mt-12">
        <h2 class="mb-4 text-lg font-semibold">我的反馈</h2>
        <div class="space-y-3">
          <article
            v-for="item in mine.items"
            :key="item.id"
            class="rounded-(--ui-radius) border border-(--ui-border) p-4"
          >
            <div class="flex items-center gap-2">
              <UBadge
                size="sm"
                variant="subtle"
                :color="item.status === 'resolved' ? 'success' : 'neutral'"
              >
                {{ STATUS_LABEL[item.status] ?? item.status }}
              </UBadge>
              <span class="text-sm font-medium">{{ item.title }}</span>
              <time class="ml-auto text-xs text-(--ui-text-dimmed)">
                {{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}
              </time>
            </div>
            <p v-if="item.reply" class="mt-2 border-l-2 border-(--ui-border-accented) pl-3 text-sm">
              {{ item.reply }}
            </p>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>
