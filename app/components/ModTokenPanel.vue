<script setup lang="ts">
interface ModToken {
  token: string
  hasBound: boolean
  boundAt: string | null
  resetAt: string | null
  createdAt: string
  deviceName: string
  lastSeenAt: string | null
  cooldownHours: number
  remainingCooldownHours: number
}

interface TokenResponse {
  ok: boolean
  token: ModToken | null
  cooldownHours?: number
}

const toast = useToast()

const { data, refresh, status } = await useFetch<TokenResponse>('/api/mod/token', {
  // 令牌是敏感值，不进 SSR 载荷，登录后由客户端单独取
  server: false,
})

const token = computed(() => data.value?.token ?? null)
const busy = ref(false)
const copied = ref(false)

/** 冷却剩余时长由后端下发，前端不再写死 24 小时 */
const cooldown = computed(() => token.value?.remainingCooldownHours ?? 0)

async function call(path: string, okMessage: string) {
  busy.value = true
  try {
    await $fetch(path, { method: 'POST' })
    toast.add({ title: okMessage, color: 'success' })
    await refresh()
  } catch (e) {
    const err = e as { data?: { error?: string } }
    toast.add({ title: err.data?.error ?? '操作失败', color: 'error' })
  } finally {
    busy.value = false
  }
}

async function generate() {
  if (token.value && !confirm('重新生成会作废当前令牌并解除设备绑定，确定继续？')) return
  await call('/api/mod/token/generate', '令牌已生成')
}

async function reset() {
  if (!confirm('重置后原设备将立即失效，需要在新设备上重新验证。确定继续？')) return
  await call('/api/mod/token/reset', '设备绑定已重置')
}

async function copy() {
  if (!token.value) return
  await navigator.clipboard.writeText(token.value.token)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('zh-CN') : '—'
}
</script>

<template>
  <div v-if="status === 'pending'" class="text-sm text-(--ui-text-dimmed)">加载中…</div>

  <!-- 尚未生成 -->
  <div v-else-if="!token" class="space-y-4">
    <p class="text-sm text-(--ui-text-muted)">
      你还没有模组令牌。生成后填入模组即可使用，首次启动会自动绑定当前设备。
    </p>
    <UButton :loading="busy" @click="generate">生成令牌</UButton>
  </div>

  <!-- 已有令牌 -->
  <div v-else class="space-y-5">
    <div>
      <label class="text-sm font-medium">令牌</label>
      <div class="mt-1 flex gap-2">
        <UInput :model-value="token.token" readonly class="flex-1 font-mono" />
        <UButton variant="subtle" @click="copy">{{ copied ? '已复制' : '复制' }}</UButton>
      </div>
    </div>

    <div class="rounded-(--ui-radius) border border-(--ui-border) p-4 text-sm">
      <div class="flex items-center gap-2">
        <UBadge :color="token.hasBound ? 'success' : 'warning'" variant="subtle" size="sm">
          {{ token.hasBound ? '已绑定设备' : '未绑定' }}
        </UBadge>
        <span v-if="token.deviceName" class="text-(--ui-text-muted)">{{ token.deviceName }}</span>
      </div>
      <dl class="mt-3 grid grid-cols-2 gap-y-1 text-(--ui-text-muted)">
        <dt>绑定时间</dt>
        <dd>{{ fmt(token.boundAt) }}</dd>
        <dt>最近使用</dt>
        <dd>{{ fmt(token.lastSeenAt) }}</dd>
      </dl>
      <p v-if="!token.hasBound" class="mt-3 text-xs text-(--ui-text-dimmed)">
        首次在模组中验证时会自动绑定该设备。
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <UButton variant="subtle" :disabled="cooldown > 0" :loading="busy" @click="reset">
        重置设备绑定
      </UButton>
      <UButton variant="ghost" :disabled="cooldown > 0" :loading="busy" @click="generate">
        重新生成令牌
      </UButton>
      <span v-if="cooldown > 0" class="text-sm text-(--ui-text-dimmed)">
        冷却中，还需等待 {{ cooldown }} 小时
      </span>
    </div>

    <p class="text-xs text-(--ui-text-dimmed)">
      一个账号同时只能绑定一台设备，重置与重新生成共用
      {{ token.cooldownHours }} 小时冷却。删除模组配置目录会产生新的设备标识，同样需要重置。
    </p>
  </div>
</template>
