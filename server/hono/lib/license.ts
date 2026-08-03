// License JWT 签发与吊销。详见 docs/mod-authorization.md
//
// 算法固定 RS256：模组端用 JDK 内置的 SHA256withRSA 即可验签，
// 不必为了 ML-DSA 之类的算法去打包额外依赖。
import { base64UrlEncode, encodeUtf8 } from './crypto'
import type { Env } from '../types'

export interface LicenseClaims {
  iss: string
  aud: 'nsuk-mod'
  sub: string
  jti: string
  iat: number
  exp: number
  /** 绑定的设备指纹，模组必须与本机比对 */
  fp: string
  tier: string
  name: string
}

export class LicenseError extends Error {
  constructor(
    message: string,
    readonly code = 'LICENSE_ERROR',
  ) {
    super(message)
    this.name = 'LicenseError'
  }
}

/** PEM → CryptoKey。私钥格式为 PKCS#8 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')

  if (!body) throw new LicenseError('签名私钥为空', 'NO_KEY')

  const binary = atob(body)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

export async function signLicense(env: Env, claims: LicenseClaims): Promise<string> {
  const pem = env.MOD_LICENSE_PRIVATE_KEY
  if (!pem) throw new LicenseError('未配置 License 签名私钥', 'NOT_CONFIGURED')

  const key = await importPrivateKey(pem)

  const header = base64UrlEncode(encodeUtf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64UrlEncode(encodeUtf8(JSON.stringify(claims)))
  const signingInput = `${header}.${payload}`

  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encodeUtf8(signingInput))
  return `${signingInput}.${base64UrlEncode(sig)}`
}

// ─── 吊销名单 ───

/**
 * 把 jti 加入吊销名单。TTL 设为 License 的剩余寿命 ——
 * 令牌自然过期之后名单里再留着它没有意义，白占 KV。
 */
export async function revokeJti(kv: KVNamespace, jti: string, expiresAt: number): Promise<void> {
  const ttl = Math.max(60, expiresAt - Math.floor(Date.now() / 1000))
  await kv.put(`license:revoked:${jti}`, '1', { expirationTtl: ttl })
}

export async function isJtiRevoked(kv: KVNamespace, jti: string): Promise<boolean> {
  return (await kv.get(`license:revoked:${jti}`)) !== null
}
