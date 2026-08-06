interface SessionUser {
  sub: string
  username: string
  displayName: string
  roleKey: string
  level: number
  permissions: string[]
}

interface MeResponse {
  ok: boolean
  user: SessionUser | null
  /** Prism 尚未配置时为 false，登录入口应降级而不是报错 */
  configured: boolean
  /** 团队邀请链接注册页，用于引导非成员 */
  joinUrl: string
}

const ROLE_LABEL: Record<string, string> = {
  guest: '游客',
  sponsor: '赞助者',
  staff: '客服',
  developer: '开发者',
  admin: '管理员',
}

export function useAuth() {
  const state = useState<MeResponse | null>('auth:state', () => null)
  /**
   * 接口取不到时不能与「未配置」混为一谈：两者都会让 configured 为 false，
   * 但一个要用户去配 secret，另一个是服务端出错，指错方向会白白浪费排查时间。
   */
  const failed = useState<boolean>('auth:failed', () => false)

  async function load() {
    try {
      const data = await $fetch<MeResponse>('/api/auth/me')
      state.value = data
      failed.value = false
      return data
    } catch (e) {
      console.error('[auth] 获取登录态失败', e)
      failed.value = true
      return null
    }
  }

  const user = computed(() => state.value?.user ?? null)
  const configured = computed(() => state.value?.configured ?? false)
  const joinUrl = computed(() => state.value?.joinUrl ?? '')
  const level = computed(() => user.value?.level ?? 0)
  const roleLabel = computed(() => ROLE_LABEL[user.value?.roleKey ?? 'guest'] ?? '游客')

  /** 登录后是否还需要走 NSUK 团队注册。level 0 即尚未拿到任何身份组 */
  const needsJoin = computed(() => !!user.value && level.value === 0)

  function login(redirect?: string) {
    const target = redirect ?? useRoute().fullPath
    return navigateTo(`/api/auth/login?redirect=${encodeURIComponent(target)}`, {
      external: true,
    })
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    state.value = null
    await navigateTo('/')
    reloadNuxtApp()
  }

  return {
    state,
    failed,
    user,
    configured,
    joinUrl,
    level,
    roleLabel,
    needsJoin,
    load,
    login,
    logout,
  }
}
