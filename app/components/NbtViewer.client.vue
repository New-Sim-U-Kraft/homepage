<script setup lang="ts">
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const props = defineProps<{ workshopId: string }>()

interface Model {
  size: [number, number, number]
  palette: string[]
  blocks: Int32Array
  count: number
}

const canvas = ref<HTMLCanvasElement>()
const state = ref<'loading' | 'ready' | 'empty' | 'error'>('loading')
const message = ref('')
const omitted = ref(0)
const stats = ref<{ name: string; count: number }[]>([])

/** Y 轴切片：只显示不高于该层的方块，用于看内部结构 */
const sliceY = ref(0)
const maxY = ref(0)

let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let model: Model | null = null
let meshes: THREE.InstancedMesh[] = []
let scene: THREE.Scene | null = null
let raf = 0

// ─── 二进制解码，格式见 server/hono/lib/renderModel.ts ───
function decode(buf: ArrayBuffer): Model | null {
  const view = new DataView(buf)
  let off = 0
  if (view.getUint32(off, true) !== 0x4e534b4d) return null
  off += 4
  if (view.getUint8(off) !== 1) return null
  off += 1

  const size: [number, number, number] = [
    view.getUint16(off, true),
    view.getUint16(off + 2, true),
    view.getUint16(off + 4, true),
  ]
  off += 6

  const palCount = view.getUint16(off, true)
  off += 2
  const decoder = new TextDecoder()
  const palette: string[] = []
  for (let i = 0; i < palCount; i++) {
    const len = view.getUint8(off)
    off += 1
    palette.push(decoder.decode(new Uint8Array(buf, off, len)))
    off += len
  }

  const count = view.getUint32(off, true)
  off += 4
  const blocks = new Int32Array(count * 4)
  for (let i = 0; i < count; i++) {
    blocks[i * 4] = view.getUint16(off, true)
    blocks[i * 4 + 1] = view.getUint16(off + 2, true)
    blocks[i * 4 + 2] = view.getUint16(off + 4, true)
    blocks[i * 4 + 3] = view.getUint16(off + 6, true)
    off += 8
  }

  return { size, palette, blocks, count }
}

// ─── 方块配色 ───
// 纹理图集（设计条目 H7.4）尚未接入，先按方块名归类取色。
// 同类方块用同一基色 + 名称哈希的轻微明度扰动，避免整片纯色看不出结构。
const PRESETS: [string[], number][] = [
  [['grass', 'slime', 'emerald', 'lime', 'moss', 'leaves', 'vine', 'bamboo', 'cactus'], 0x4f9b49],
  [['water', 'ice', 'prismarine'], 0x4b83d1],
  [['lava', 'magma', 'fire'], 0xd76a25],
  [['sand', 'birch', 'end_stone', 'bone'], 0xd7c27d],
  [['oak', 'spruce', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'planks', 'log', 'wood'], 0x8b5a34],
  [['deepslate', 'basalt', 'blackstone', 'obsidian', 'coal'], 0x3e434d],
  [['stone', 'cobblestone', 'andesite', 'diorite', 'granite', 'tuff', 'gravel'], 0x8b8f97],
  [['brick', 'terracotta', 'nether'], 0xb85f45],
  [['quartz', 'calcite', 'snow', 'white'], 0xe5e7eb],
  [['glass', 'lantern', 'glowstone', 'shroomlight'], 0xe2d6a8],
  [['copper'], 0xc27a46],
  [['gold'], 0xd9b646],
  [['diamond'], 0x52d4d8],
  [['amethyst', 'purpur'], 0x986bc7],
]

function colorOf(name: string): THREE.Color {
  const key = name.toLowerCase()
  let base = 0x7f8a96
  for (const [needles, color] of PRESETS) {
    if (needles.some((n) => key.includes(n))) {
      base = color
      break
    }
  }
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  const c = new THREE.Color(base)
  c.offsetHSL(0, 0, ((hash % 19) - 9) / 120)
  return c
}

const TRANSPARENT = /(glass|ice|leaves|water|pane|vine)/i

// ─── 纹理图集 ───
// 由 scripts/build-atlas.mjs 在构建期生成。加载失败时整体回退到纯色渲染，
// 不让预览直接不可用。
interface Atlas {
  width: number
  height: number
  cell: number
  pad: number
  tile: number
  index: Record<string, [number, number]>
  /** 方块名 → [上, 侧, 下] 三个纹理名 */
  blocks: Record<string, [string, string, string]>
}

let atlas: Atlas | null = null
let atlasTexture: THREE.Texture | null = null

async function loadAtlas(): Promise<void> {
  try {
    const [meta, texture] = await Promise.all([
      $fetch<Atlas>('/mc/atlas.json'),
      new Promise<THREE.Texture>((resolve, reject) => {
        new THREE.TextureLoader().load('/mc/atlas.png', resolve, undefined, reject)
      }),
    ])
    // 像素风：不做插值也不生成 mipmap，后者会在缩小时把邻格颜色混进来
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    atlas = meta
    atlasTexture = texture
  } catch {
    atlas = null
    atlasTexture = null
  }
}

/**
 * 把图集坐标烘焙进 BoxGeometry 的 uv 属性。
 *
 * 这样六个面各用各的纹理，却仍然只需要一个材质 —— 换成材质数组的话
 * three.js 会按 group 拆成六次绘制。
 *
 * BoxGeometry 的面序：+X −X +Y −Y +Z −Z，每面 4 个顶点。
 */
function bakeUv(geometry: THREE.BoxGeometry, name: string): boolean {
  if (!atlas) return false
  const faces = atlas.blocks[name]
  if (!faces) return false

  const [top, side, bottom] = faces
  const perFace = [side, side, top, bottom, side, side]
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  const { cell, pad, tile, width, height } = atlas

  for (let f = 0; f < 6; f++) {
    const at = atlas.index[perFace[f]!]
    if (!at) return false
    const [col, row] = at
    const u0 = (col * cell + pad) / width
    const u1 = (col * cell + pad + tile) / width
    // 图片行自上而下，UV 原点在左下，v 要翻转
    const v1 = 1 - (row * cell + pad) / height
    const v0 = 1 - (row * cell + pad + tile) / height

    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i
      const lu = uv.getX(idx)
      const lv = uv.getY(idx)
      uv.setXY(idx, u0 + lu * (u1 - u0), v0 + lv * (v1 - v0))
    }
  }
  uv.needsUpdate = true
  return true
}

// ─── 构建场景 ───
function build(m: Model) {
  if (!scene) return
  for (const mesh of meshes) {
    scene.remove(mesh)
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  }
  meshes = []

  const byState = new Map<number, number[]>()
  for (let i = 0; i < m.count; i++) {
    const y = m.blocks[i * 4 + 1]!
    if (y > sliceY.value) continue
    const state = m.blocks[i * 4 + 3]!
    const list = byState.get(state)
    if (list) list.push(i)
    else byState.set(state, [i])
  }

  const [sx, sy, sz] = m.size
  const ox = -(sx - 1) / 2
  const oy = -(sy - 1) / 2
  const oz = -(sz - 1) / 2
  const matrix = new THREE.Matrix4()

  for (const [state, indices] of byState) {
    const name = m.palette[state] ?? 'unknown'
    const transparent = TRANSPARENT.test(name)

    // 每种方块一份几何体：UV 烘焙是逐方块的，不能共用
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const textured = bakeUv(geometry, name)

    const material = new THREE.MeshStandardMaterial({
      // 图集缺这个方块时回退到纯色，总比空白强
      ...(textured && atlasTexture
        ? { map: atlasTexture, alphaTest: transparent ? 0.5 : 0 }
        : { color: colorOf(name) }),
      roughness: 1,
      metalness: 0,
      transparent,
      opacity: transparent && !textured ? 0.55 : 1,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, indices.length)
    indices.forEach((idx, n) => {
      matrix.makeTranslation(
        m.blocks[idx * 4]! + ox,
        m.blocks[idx * 4 + 1]! + oy,
        m.blocks[idx * 4 + 2]! + oz,
      )
      mesh.setMatrixAt(n, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)
    meshes.push(mesh)
  }
}

function computeStats(m: Model) {
  const counts = new Map<number, number>()
  for (let i = 0; i < m.count; i++) {
    const s = m.blocks[i * 4 + 3]!
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  stats.value = [...counts.entries()]
    .map(([s, count]) => ({ name: m.palette[s] ?? 'unknown', count }))
    .sort((a, b) => b.count - a.count)
}

async function init() {
  // 图集与模型并行取，图集失败不阻塞渲染（回退纯色）
  const [res] = await Promise.all([
    fetch(`/api/workshop/${props.workshopId}/preview`),
    loadAtlas(),
  ])
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    state.value = res.status === 404 ? 'empty' : 'error'
    message.value = body.error ?? '预览加载失败'
    return
  }

  omitted.value = Number(res.headers.get('X-Model-Omitted') ?? 0)
  const decoded = decode(await res.arrayBuffer())
  if (!decoded) {
    state.value = 'error'
    message.value = '预览数据格式不正确'
    return
  }

  model = decoded
  maxY.value = decoded.size[1]
  sliceY.value = decoded.size[1]
  computeStats(decoded)
  state.value = 'ready'

  await nextTick()
  if (!canvas.value) return

  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
  const maxDim = Math.max(...decoded.size, 4)
  camera.position.set(maxDim * 1.2, maxDim * 1.1, maxDim * 1.4)

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 1.2))
  const key = new THREE.DirectionalLight(0xffffff, 1.35)
  key.position.set(1.5, 2.4, 1.8)
  scene.add(key)

  controls = new OrbitControls(camera, canvas.value)
  controls.enableDamping = true
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.6

  build(decoded)

  const loop = () => {
    raf = requestAnimationFrame(loop)
    const el = canvas.value
    if (!el || !renderer || !scene) return
    const w = el.clientWidth || 1
    const h = el.clientHeight || 1
    if (el.width !== w || el.height !== h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    controls?.update()
    renderer.render(scene, camera)
  }
  loop()
}

watch(sliceY, () => {
  if (model) build(model)
})

onMounted(init)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  controls?.dispose()
  for (const mesh of meshes) {
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  }
  renderer?.dispose()
})
</script>

<template>
  <div>
    <div
      class="relative h-96 overflow-hidden rounded-(--ui-radius) border border-(--ui-border) bg-(--ui-bg-elevated)"
    >
      <canvas v-show="state === 'ready'" ref="canvas" class="h-full w-full" />

      <div
        v-if="state !== 'ready'"
        class="flex h-full items-center justify-center text-sm text-(--ui-text-dimmed)"
      >
        {{
          state === 'loading' ? '加载预览…' : state === 'empty' ? '该作品没有可预览的结构文件' : message
        }}
      </div>
    </div>

    <template v-if="state === 'ready'">
      <div class="mt-3 flex items-center gap-3 text-sm">
        <label class="text-(--ui-text-muted)">层高</label>
        <input v-model.number="sliceY" type="range" :min="0" :max="maxY" class="flex-1" >
        <span class="w-16 text-right text-(--ui-text-dimmed)">{{ sliceY }} / {{ maxY }}</span>
      </div>

      <p v-if="omitted > 0" class="mt-2 text-xs text-(--ui-text-dimmed)">
        结构过大，已省略 {{ omitted }} 个方块未渲染。
      </p>

      <details class="mt-3">
        <summary class="cursor-pointer text-sm text-(--ui-text-muted)">用料统计</summary>
        <ul class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <li v-for="s in stats" :key="s.name" class="flex justify-between gap-2">
            <span class="truncate text-(--ui-text-muted)">{{ s.name }}</span>
            <span class="tabular-nums">{{ s.count }}</span>
          </li>
        </ul>
      </details>
    </template>
  </div>
</template>
