// 构建期生成方块纹理图集（设计条目 H7.4）。
//
// 为什么要图集：旧实现给每个方块面单独请求一张 PNG，一个中等结构就是几百个
// HTTP 请求；而且 Workers Assets 有文件数上限，上千张散图迟早撞上。
// 合成一张图后是一次请求，GPU 侧也能合批。
//
// 产物不入库（见 .gitignore），由 `pnpm build` 自动生成。
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import mcAssets from 'minecraft-assets'

const MC_VERSION = '1.21.8'
const TILE = 16 // 原始纹理边长
const PAD = 1 // 每格向外扩 1px，防止线性采样时渗到邻格
const CELL = TILE + PAD * 2

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'mc')

const assets = mcAssets(MC_VERSION)
const texDir = join(assets.directory, 'blocks')

/** `minecraft:block/oak_log` / `blocks/oak_log` → `oak_log` */
function normTexture(v) {
  return String(v ?? '')
    .replace(/^minecraft:/, '')
    .replace(/^(blocks?|textures\/blocks?)\//, '')
    .replace(/\.png$/, '')
}

function normModel(v) {
  return String(v ?? '')
    .replace(/^minecraft:/, '')
    .replace(/^(blocks?)\//, '')
    .replace(/\.json$/, '')
}

/**
 * 递归合并模型的 textures 表。
 * 子模型覆盖父模型，因此父的结果先展开、子的后展开。
 */
function resolveModelTextures(modelKey, seen = new Set()) {
  const key = normModel(modelKey)
  if (!key || seen.has(key)) return {}
  seen.add(key)
  const model = assets.blocksModels[key]
  if (!model) return {}
  const parent = model.parent ? resolveModelTextures(model.parent, seen) : {}
  return { ...parent, ...(model.textures ?? {}) }
}

/** 解析 `#side` 这类引用，最多跳 12 层防环 */
function deref(map, key, depth = 0) {
  if (depth > 12) return ''
  const v = map?.[key]
  if (!v) return ''
  const s = String(v)
  return s.startsWith('#') ? deref(map, s.slice(1), depth + 1) : normTexture(s)
}

/** 每个方块取三个面：上、下、侧。结构预览不需要区分四个侧面 */
function facesOf(blockName) {
  const entry = assets.blocks[blockName]
  const map = resolveModelTextures(entry?.model || blockName)
  const fallback = normTexture(entry?.texture) || blockName

  const pick = (...cands) => {
    for (const c of cands) {
      const t = deref(map, c)
      if (t) return t
    }
    return fallback
  }

  return {
    top: pick('top', 'up', 'end', 'all', 'texture', 'side', 'particle'),
    bottom: pick('bottom', 'down', 'end', 'all', 'texture', 'side', 'particle'),
    side: pick('side', 'north', 'all', 'texture', 'particle', 'end', 'top'),
  }
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 读一张纹理并扩边。
 * 动画纹理（水、岩浆等）是竖向多帧，只取第一帧，否则整块会被压扁。
 */
async function loadTile(name) {
  const file = join(texDir, `${name}.png`)
  if (!(await exists(file))) return null

  let img = sharp(await readFile(file))
  const meta = await img.metadata()
  if (!meta.width || !meta.height) return null

  if (meta.height > meta.width) {
    img = sharp(await readFile(file)).extract({
      left: 0,
      top: 0,
      width: meta.width,
      height: meta.width,
    })
  }

  return img
    .resize(TILE, TILE, { kernel: 'nearest' })
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' })
    .png()
    .toBuffer()
}

async function main() {
  const blockNames = Object.keys(assets.blocks)

  // 先算出每个方块要哪几张纹理，再按去重后的集合打图集
  const blockFaces = {}
  const needed = new Set()
  for (const name of blockNames) {
    const faces = facesOf(name)
    blockFaces[name] = faces
    for (const t of Object.values(faces)) needed.add(t)
  }

  const names = [...needed].sort()
  const tiles = []
  const missing = []

  for (const n of names) {
    const buf = await loadTile(n)
    if (buf) tiles.push({ name: n, buf })
    else missing.push(n)
  }

  // 尽量接近正方形，GPU 对极端长宽比的纹理不友好
  const cols = Math.ceil(Math.sqrt(tiles.length))
  const rows = Math.ceil(tiles.length / cols)
  const width = cols * CELL
  const height = rows * CELL

  const index = {}
  const composites = tiles.map((t, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    index[t.name] = [col, row]
    return { input: t.buf, left: col * CELL, top: row * CELL }
  })

  await mkdir(outDir, { recursive: true })

  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, 'atlas.png'))

  // 只保留能在图集里找到纹理的方块，避免客户端查到空 UV
  const blocks = {}
  for (const [name, faces] of Object.entries(blockFaces)) {
    if (!index[faces.top] && !index[faces.side] && !index[faces.bottom]) continue
    blocks[name] = [
      index[faces.top] ? faces.top : faces.side,
      index[faces.side] ? faces.side : faces.top,
      index[faces.bottom] ? faces.bottom : faces.side,
    ]
  }

  await writeFile(
    join(outDir, 'atlas.json'),
    JSON.stringify({ version: MC_VERSION, width, height, cell: CELL, pad: PAD, tile: TILE, index, blocks }),
  )

  const png = await sharp(join(outDir, 'atlas.png')).metadata()
  console.log(
    `[atlas] ${tiles.length} 张纹理 → ${width}x${height}，` +
      `${(png.size / 1024).toFixed(0)}KB，覆盖 ${Object.keys(blocks).length}/${blockNames.length} 个方块`,
  )
  if (missing.length) {
    console.log(`[atlas] ${missing.length} 张纹理在资源包中不存在，已跳过（多为非完整方块）`)
  }
}

main().catch((e) => {
  console.error('[atlas] 生成失败:', e)
  process.exit(1)
})
