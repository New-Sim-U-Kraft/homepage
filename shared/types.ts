// 前后端共享类型。Nuxt 4 会自动从 shared/ 导入。
//
// 这些是**接口返回的形状**，不是数据库行的形状 —— D1 里存的是 snake_case
// 与 JSON blob，序列化层负责转换，前端不应该感知存储细节。

export interface Announcement {
  id: string
  title: string
  body: string
  level: 'info' | 'warning' | 'important'
  publishedAt: string
}

export interface ChangelogEntry {
  id: string
  version: string
  title: string
  body: string
  publishedAt: string
}

export interface ExternalMod {
  id: string
  name: string
  description: string
  url: string
  author?: string
  icon?: string
}

export interface DeveloperSummary {
  slug: string
  name: string
  role: string
  avatar: string
  intro: string
}

export interface Developer extends DeveloperSummary {
  cover?: string
  links?: { label: string; url: string }[]
  body?: string
}

export type WorkshopStatus = 'pending' | 'published' | 'rejected'

export interface WorkshopItemSummary {
  id: string
  title: string
  category: string
  description: string
  authorName: string
  authorSub: string | null
  cover: string | null
  publishedAt: string | null
}

export interface WorkshopItem extends WorkshopItemSummary {
  /** 站内只做预览，下载一律走这些站外链接 */
  externalLinks: { label: string; url: string }[]
  /** 结构文件的元信息。注意：不含可直接下载的 URL */
  files: { name: string; kind: string; size?: number }[]
  status: WorkshopStatus
  updatedAt: string
}

/** 统一的失败响应形状 */
export interface ApiError {
  ok: false
  error: string
  code?: string
  ref?: string
}
