// 基础密码学工具。全部基于 WebCrypto，Workers 原生支持，无第三方依赖。

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const b of arr) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 显式基于 ArrayBuffer 构造：WebCrypto 的 BufferSource 不接受
// Uint8Array<ArrayBufferLike>（可能是 SharedArrayBuffer）。
export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** 同上，供需要传给 WebCrypto 的文本使用 */
export function encodeUtf8(input: string): Uint8Array<ArrayBuffer> {
  const src = encoder.encode(input)
  const out = new Uint8Array(new ArrayBuffer(src.length))
  out.set(src)
  return out
}

export function base64UrlDecodeText(input: string): string {
  return decoder.decode(base64UrlDecode(input))
}

/** 密码学随机串，用于 state / nonce / code_verifier / 会话令牌 */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64UrlEncode(buf)
}

export async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(input))
}

export async function sha256Base64Url(input: string): Promise<string> {
  return base64UrlEncode(await sha256(input))
}

/**
 * 常数时间比较。用于 webhook 共享密钥等场景 ——
 * 普通的 === 会在第一个不同字节处返回，泄露前缀信息。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a)
  const bb = encoder.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!
  return diff === 0
}
