// 从 NBT 结构提取渲染模型，并编码成紧凑二进制。
//
// 为什么不直接把解析结果当 JSON 发给前端（旧实现的做法）：
// 25000 个方块的 JSON 轻松上 1.5MB，而同样内容用二进制只要 200KB。
// 这条链路每个作品页都会走，差距会直接体现在加载时间上。
//
// 为什么解析放在服务端而不是客户端：原始 .nbt 文件不能出站
// （设计条目 W3/W5），客户端只能拿到解析后的方块数组，
// 拿不到可以直接导入游戏的文件。
import type { NbtValue } from './nbt'

/** 空气类方块不进渲染模型 */
const AIR = new Set(['air', 'cave_air', 'void_air', 'structure_void'])

/** 单个作品的方块上限。超出部分会被丢弃，但数量会如实上报给前端 */
export const RENDER_BLOCK_LIMIT = 60000

const MAGIC = 0x4e534b4d // "NSKM"
const VERSION = 1

export interface RenderModelMeta {
  size: [number, number, number]
  paletteSize: number
  totalBlocks: number
  renderedBlocks: number
  omittedBlocks: number
}

function normalizeName(v: unknown): string {
  return String(v ?? '').replace(/^minecraft:/, '')
}

function readSize(v: NbtValue | undefined): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null
  const out = v.slice(0, 3).map((n) => Math.max(0, Math.trunc(Number(n))))
  if (out.some((n) => !Number.isFinite(n) || n > 4096)) return null
  return out as [number, number, number]
}

function readPalette(root: Record<string, NbtValue>): string[] {
  const direct = root.palette
  if (Array.isArray(direct)) {
    return direct.map((e, i) => {
      const o = e as Record<string, NbtValue>
      return normalizeName(o?.Name ?? o?.name) || `palette:${i}`
    })
  }
  // 部分工具导出的是多套调色板，取第一套
  const multi = root.palettes
  if (Array.isArray(multi) && Array.isArray(multi[0])) {
    return (multi[0] as NbtValue[]).map((e, i) => {
      const o = e as Record<string, NbtValue>
      return normalizeName(o?.Name ?? o?.name) || `palette:${i}`
    })
  }
  return []
}

export interface EncodedModel {
  buffer: ArrayBuffer
  meta: RenderModelMeta
}

/**
 * 编码格式（小端）：
 *   magic  u32  "NSKM"
 *   ver    u8   = 1
 *   size   u16 × 3
 *   palN   u16          调色板项数
 *     每项 u8 长度 + UTF-8 名字
 *   blkN   u32          方块数
 *     每项 x/y/z/state 各 u16，共 8 字节
 */
export function encodeRenderModel(root: Record<string, NbtValue>): EncodedModel | null {
  const size = readSize(root.size)
  const palette = readPalette(root)
  const blocksRaw = root.blocks

  if (!size || palette.length === 0 || !Array.isArray(blocksRaw) || blocksRaw.length === 0) {
    return null
  }

  const airIndex = new Set<number>()
  palette.forEach((name, i) => {
    if (AIR.has(name)) airIndex.add(i)
  })

  const kept: { x: number; y: number; z: number; state: number }[] = []
  let solid = 0

  for (const raw of blocksRaw) {
    const o = raw as Record<string, NbtValue>
    const state = Math.trunc(Number(o?.state))
    const pos = readSize(o?.pos)
    if (!Number.isFinite(state) || state < 0 || state >= palette.length || !pos) continue
    if (airIndex.has(state)) continue
    solid++
    if (kept.length >= RENDER_BLOCK_LIMIT) continue
    kept.push({ x: pos[0], y: pos[1], z: pos[2], state })
  }

  if (kept.length === 0) return null

  const nameBytes = palette.map((n) => new TextEncoder().encode(n.slice(0, 255)))
  const paletteBytes = nameBytes.reduce((sum, b) => sum + 1 + b.length, 0)
  const total = 4 + 1 + 6 + 2 + paletteBytes + 4 + kept.length * 8

  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let off = 0

  view.setUint32(off, MAGIC, true)
  off += 4
  view.setUint8(off, VERSION)
  off += 1
  for (const s of size) {
    view.setUint16(off, Math.min(s, 65535), true)
    off += 2
  }

  view.setUint16(off, palette.length, true)
  off += 2
  for (const nb of nameBytes) {
    view.setUint8(off, nb.length)
    off += 1
    bytes.set(nb, off)
    off += nb.length
  }

  view.setUint32(off, kept.length, true)
  off += 4
  for (const b of kept) {
    view.setUint16(off, Math.min(b.x, 65535), true)
    view.setUint16(off + 2, Math.min(b.y, 65535), true)
    view.setUint16(off + 4, Math.min(b.z, 65535), true)
    view.setUint16(off + 6, b.state, true)
    off += 8
  }

  return {
    buffer: buf,
    meta: {
      size,
      paletteSize: palette.length,
      totalBlocks: blocksRaw.length,
      renderedBlocks: kept.length,
      omittedBlocks: Math.max(0, solid - kept.length),
    },
  }
}
