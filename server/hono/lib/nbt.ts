// NBT 解析器。自旧实现（src/lib/nbt.js）移植。
//
// 保留手写而不用 prismarine-nbt：后者依赖 eval，在 Workers 上跑不了，
// 而且我们只需要读，写不着一整个协议库。
//
// 两个上限是必要的：结构文件由用户上传，恶意构造的长度字段或深层嵌套
// 会直接把 Worker 打爆。
const MAX_ARRAY_ELEMENTS = 4_194_304
const MAX_NBT_DEPTH = 512

const DECODER = new TextDecoder()

export type NbtValue =
  | number
  | bigint
  | string
  | NbtValue[]
  | { [key: string]: NbtValue }

class Reader {
  private d: DataView
  private o = 0

  constructor(u8: Uint8Array) {
    this.d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  }

  u8() {
    return this.d.getUint8(this.o++)
  }
  i8() {
    return this.d.getInt8(this.o++)
  }
  i16() {
    const v = this.d.getInt16(this.o)
    this.o += 2
    return v
  }
  u16() {
    const v = this.d.getUint16(this.o)
    this.o += 2
    return v
  }
  i32() {
    const v = this.d.getInt32(this.o)
    this.o += 4
    return v
  }
  i64() {
    const v = this.d.getBigInt64(this.o)
    this.o += 8
    return v
  }
  f32() {
    const v = this.d.getFloat32(this.o)
    this.o += 4
    return v
  }
  f64() {
    const v = this.d.getFloat64(this.o)
    this.o += 8
    return v
  }
  str() {
    const len = this.u16()
    const bytes = new Uint8Array(this.d.buffer, this.d.byteOffset + this.o, len)
    this.o += len
    return DECODER.decode(bytes)
  }

  arrayLen() {
    const n = this.i32()
    if (n < 0 || n > MAX_ARRAY_ELEMENTS) throw new Error('nbt array length out of range')
    return n
  }
}

function readPayload(r: Reader, type: number, depth = 0): NbtValue {
  if (depth > MAX_NBT_DEPTH) throw new Error('nbt nesting too deep')
  switch (type) {
    case 1:
      return r.i8()
    case 2:
      return r.i16()
    case 3:
      return r.i32()
    case 4:
      return r.i64()
    case 5:
      return r.f32()
    case 6:
      return r.f64()
    case 7: {
      const n = r.arrayLen()
      const a: number[] = new Array(n)
      for (let i = 0; i < n; i++) a[i] = r.i8()
      return a
    }
    case 8:
      return r.str()
    case 9: {
      const it = r.u8()
      const n = r.arrayLen()
      const a: NbtValue[] = new Array(n)
      for (let i = 0; i < n; i++) a[i] = readPayload(r, it, depth + 1)
      return a
    }
    case 10: {
      const o: Record<string, NbtValue> = {}
      for (;;) {
        const t = r.u8()
        if (t === 0) break
        const name = r.str()
        o[name] = readPayload(r, t, depth + 1)
      }
      return o
    }
    case 11: {
      const n = r.arrayLen()
      const a: number[] = new Array(n)
      for (let i = 0; i < n; i++) a[i] = r.i32()
      return a
    }
    case 12: {
      const n = r.arrayLen()
      const a: bigint[] = new Array(n)
      for (let i = 0; i < n; i++) a[i] = r.i64()
      return a
    }
    default:
      throw new Error(`unknown nbt tag ${type}`)
  }
}

async function gunzip(buffer: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Response(buffer).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 入口：自动识别 gzip，返回简化后的 NBT 树 */
export async function parseNbt(buffer: ArrayBuffer): Promise<Record<string, NbtValue>> {
  // 显式放宽泛型：gunzip 的结果来自 Response.arrayBuffer()，其 buffer 类型
  // 被推断为 ArrayBufferLike，与 new Uint8Array(ArrayBuffer) 的窄类型不兼容
  let u8: Uint8Array<ArrayBufferLike> = new Uint8Array(buffer)
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) u8 = await gunzip(buffer)

  const r = new Reader(u8)
  if (r.u8() !== 10) throw new Error('nbt root is not a compound')
  r.str() // 根名
  return readPayload(r, 10) as Record<string, NbtValue>
}
