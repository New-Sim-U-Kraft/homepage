<script setup lang="ts">
useHead({ title: '投稿 · 创意工坊' })

const { user, configured, login } = useAuth()
const toast = useToast()
const router = useRouter()

const CATEGORIES = [
  { value: 'building', label: '建筑' },
  { value: 'interior', label: '室内' },
  { value: 'landscape', label: '景观' },
  { value: 'other', label: '其他' },
]

const form = reactive({ title: '', category: 'building', description: '' })
const links = ref<{ label: string; url: string }[]>([{ label: '', url: '' }])
const files = ref<File[]>([])
const submitting = ref(false)

function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  files.value = Array.from(input.files ?? [])
}

async function submit() {
  const validLinks = links.value.filter((l) => l.url.trim().startsWith('https://'))
  if (validLinks.length === 0) {
    toast.add({ title: '请至少填写一个 https 下载链接', color: 'error' })
    return
  }
  if (files.value.length === 0) {
    toast.add({ title: '请至少上传一个文件', color: 'error' })
    return
  }

  const fd = new FormData()
  fd.append('title', form.title)
  fd.append('category', form.category)
  fd.append('description', form.description)
  fd.append('externalLinks', JSON.stringify(validLinks))
  for (const f of files.value) fd.append('files', f)

  submitting.value = true
  try {
    const res = await $fetch<{ id: string }>('/api/workshop/submit', { method: 'POST', body: fd })
    toast.add({ title: '投稿已提交，等待审核', color: 'success' })
    router.push(`/workshop/${res.id}`)
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
    <h1 class="text-2xl font-bold">投稿作品</h1>

    <div
      v-if="!user"
      class="mt-8 rounded-(--ui-radius) border border-dashed border-(--ui-border) p-8 text-center"
    >
      <p class="text-sm text-(--ui-text-muted)">投稿需要先登录。</p>
      <UButton v-if="configured" class="mt-4" @click="login('/workshop/submit')">登录</UButton>
    </div>

    <div v-else class="mt-8 space-y-5">
      <UFormField label="标题">
        <UInput v-model="form.title" :maxlength="80" />
      </UFormField>

      <UFormField label="分类">
        <USelect v-model="form.category" :items="CATEGORIES" value-key="value" class="w-56" />
      </UFormField>

      <UFormField label="描述">
        <UTextarea v-model="form.description" :rows="5" :maxlength="2000" />
      </UFormField>

      <UFormField label="文件" hint="截图 + 结构文件">
        <input
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.nbt,.schem,.schematic,.litematic"
          class="block w-full text-sm"
          @change="onFiles"
        >
        <p class="mt-1 text-xs text-(--ui-text-dimmed)">
          图片单个不超过 5MB，结构文件不超过 20MB，最多 8 个。
        </p>
      </UFormField>

      <UFormField label="站外下载链接" hint="必填">
        <div class="space-y-2">
          <div v-for="(link, i) in links" :key="i" class="flex gap-2">
            <UInput v-model="link.label" placeholder="名称，如 蓝奏云" class="w-40" />
            <UInput v-model="link.url" placeholder="https://…" class="flex-1" />
            <UButton
              v-if="links.length > 1"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              @click="links.splice(i, 1)"
            />
          </div>
          <UButton size="sm" variant="ghost" @click="links.push({ label: '', url: '' })">
            添加链接
          </UButton>
        </div>
      </UFormField>

      <!--
        这条规则要在投稿时就说清楚：上传的结构文件只用于站内预览，
        玩家实际下载走的是上面这些链接。链接失效等于作品不可用。
      -->
      <UAlert
        color="neutral"
        variant="subtle"
        title="关于下载"
        description="上传的结构文件仅用于站内 3D 预览，不提供下载。玩家通过你填写的站外链接获取文件，请确保链接长期有效。"
      />

      <UButton :loading="submitting" @click="submit">提交审核</UButton>
    </div>
  </div>
</template>
