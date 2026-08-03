// 上传校验与 R2 写入。
//
// key 结构决定了可见性（见 routes/uploads.ts 的白名单）：
//   workshop/<id>/images/<uuid>.<ext>   公开，作为作品预览图
//   workshop/<id>/files/<uuid>.<ext>    私有，仅审核员可取
//   developers/<slug>/<uuid>.<ext>      公开
//
// 结构文件永远不给公开 URL —— 站内只做预览，下载走投稿者的站外链接。
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp'])
const STRUCTURE_EXT = new Set(['nbt', 'schem', 'schematic', 'litematic'])

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_STRUCTURE_BYTES = 20 * 1024 * 1024

export type UploadKind = 'image' | 'structure'

export interface UploadedFile {
  key: string
  name: string
  kind: UploadKind
  size: number
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function classify(name: string): UploadKind {
  const ext = extOf(name)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (STRUCTURE_EXT.has(ext)) return 'structure'
  throw new UploadError(`不支持的文件类型：.${ext || '未知'}`, 'BAD_TYPE')
}

const CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/**
 * 校验并写入 R2。
 *
 * 结构文件一律以 application/octet-stream 存储：即便将来某条路径漏了白名单，
 * 浏览器也不会把它当作可内联渲染的内容。
 */
export async function putFile(
  r2: R2Bucket,
  prefix: string,
  file: File,
): Promise<UploadedFile> {
  const name = file.name.trim().slice(0, 120)
  if (!name) throw new UploadError('文件名为空', 'BAD_NAME')

  const kind = classify(name)
  const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_STRUCTURE_BYTES
  if (file.size > limit) {
    throw new UploadError(
      `${kind === 'image' ? '图片' : '结构文件'}不能超过 ${Math.round(limit / 1024 / 1024)}MB`,
      'TOO_LARGE',
    )
  }
  if (file.size === 0) throw new UploadError('文件为空', 'EMPTY')

  const ext = extOf(name)
  const key = `${prefix}/${kind === 'image' ? 'images' : 'files'}/${crypto.randomUUID()}.${ext}`

  await r2.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: kind === 'image' ? (CONTENT_TYPE[ext] ?? 'image/png') : 'application/octet-stream',
    },
    customMetadata: { originalName: name },
  })

  return { key, name, kind, size: file.size }
}

/** 投稿失败时回滚已写入的对象，避免 R2 里堆积孤儿文件 */
export async function deleteFiles(r2: R2Bucket, keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => r2.delete(k).catch(() => {})))
}
