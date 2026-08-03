<script setup lang="ts">
useHead({ title: '账号 · NSUK' })

const { user, configured, joinUrl, needsJoin, roleLabel, level, login } = useAuth()
const route = useRoute()

/** 回调失败时会带 ?error= 回来 */
const loginError = computed(() => {
  const e = route.query.error
  return typeof e === 'string' ? e : ''
})

const ERROR_TEXT: Record<string, string> = {
  invalid_state: '登录状态已过期，请重新登录。',
  missing_code: '授权未完成。',
  login_failed: '登录失败，请稍后重试。',
  access_denied: '你取消了授权。',
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-12">
    <h1 class="text-2xl font-bold">账号</h1>

    <UAlert
      v-if="loginError"
      class="mt-6"
      color="error"
      variant="subtle"
      :description="ERROR_TEXT[loginError] ?? `登录失败：${loginError}`"
    />

    <!-- 未登录 -->
    <template v-if="!user">
      <p class="mt-2 text-sm text-(--ui-text-muted)">
        本站账号由 Prism 提供，模组令牌与设备绑定也在这里管理。
      </p>
      <UButton v-if="configured" class="mt-6" @click="login('/account')">使用 Prism 登录</UButton>
      <div
        v-else
        class="mt-6 rounded-(--ui-radius) border border-dashed border-(--ui-border) p-8 text-sm text-(--ui-text-dimmed)"
      >
        登录尚未配置（等待 Prism 侧提供应用凭据）。
      </div>
    </template>

    <!-- 已登录 -->
    <template v-else>
      <div class="mt-6 flex items-center gap-3">
        <span class="text-lg">{{ user.displayName }}</span>
        <UBadge variant="subtle">{{ roleLabel }}</UBadge>
      </div>
      <p class="mt-1 text-sm text-(--ui-text-dimmed)">@{{ user.username }}</p>

      <!--
        已登录但没有任何身份组：说明还没通过 NSUK 通道加入团队。
        引导去邀请链接注册页，带 continue 回跳。
      -->
      <UAlert
        v-if="needsJoin"
        class="mt-6"
        color="warning"
        variant="subtle"
        title="尚未加入 NSUK"
        description="你的 Prism 账号还不属于 NSUK 团队，暂时只能浏览公开内容。"
      >
        <template #actions>
          <UButton v-if="joinUrl" :to="joinUrl" external size="sm">前往加入</UButton>
        </template>
      </UAlert>

      <section class="mt-10">
        <h2 class="text-lg font-semibold">模组授权</h2>
        <p class="mt-1 mb-4 text-sm text-(--ui-text-muted)">
          赞助者及以上可生成令牌，填入模组后即可使用。
        </p>

        <ModTokenPanel v-if="level >= 1" />
        <div
          v-else
          class="rounded-(--ui-radius) border border-dashed border-(--ui-border) p-6 text-sm text-(--ui-text-dimmed)"
        >
          模组授权面向赞助者及以上开放。
        </div>
      </section>
    </template>
  </div>
</template>
