// Prism OIDC 客户端。
//
// ID token 是 RS256（JWKS 公布公钥），因此在 Worker 内**本地验签**，
// 不必为每次登录多打一次 introspect。access token 是 ML-DSA-65，
// WebCrypto 验不了，需要它时只能走 introspect —— 但登录链路用不到。
import {
  base64UrlDecodeText,
  base64UrlDecode,
  encodeUtf8,
  randomToken,
  sha256Base64Url,
} from './crypto'
import type { PrismConfig } from './config'

const DISCOVERY_TTL = 3600
const JWKS_TTL = 3600

export interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  jwks_uri: string
  revocation_endpoint?: string
  introspection_endpoint?: string
}

export interface IdTokenClaims {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  iat: number
  nonce?: string
  name?: string
  preferred_username?: string
  picture?: string
  email?: string
  email_verified?: boolean
  /** 动态 claim：in_team_<id>、role_in_team_<id>、groups_in_team_<id> */
  [key: string]: unknown
}

export interface TokenSet {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  id_token: string
  scope?: string
}

export class OidcError extends Error {
  constructor(
    message: string,
    readonly code = 'OIDC_ERROR',
  ) {
    super(message)
    this.name = 'OidcError'
  }
}

// ─── Discovery ───

export async function getDiscovery(kv: KVNamespace, cfg: PrismConfig): Promise<Discovery> {
  const cacheKey = `oidc:discovery:${cfg.issuer}`
  const cached = await kv.get<Discovery>(cacheKey, 'json')
  if (cached) return cached

  const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`)
  if (!res.ok) throw new OidcError(`discovery 失败：HTTP ${res.status}`, 'DISCOVERY_FAILED')

  const doc = (await res.json()) as Discovery
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new OidcError('discovery 文档缺少必要端点', 'DISCOVERY_INVALID')
  }

  await kv.put(cacheKey, JSON.stringify(doc), { expirationTtl: DISCOVERY_TTL })
  return doc
}

// ─── JWKS ───

interface Jwk {
  kid?: string
  kty: string
  alg?: string
  use?: string
  n?: string
  e?: string
}

async function fetchJwks(kv: KVNamespace, jwksUri: string, force = false): Promise<Jwk[]> {
  const cacheKey = `oidc:jwks:${jwksUri}`
  if (!force) {
    const cached = await kv.get<{ keys: Jwk[] }>(cacheKey, 'json')
    if (cached?.keys) return cached.keys
  }

  const res = await fetch(jwksUri)
  if (!res.ok) throw new OidcError(`JWKS 拉取失败：HTTP ${res.status}`, 'JWKS_FAILED')

  const doc = (await res.json()) as { keys?: Jwk[] }
  const keys = doc.keys ?? []
  await kv.put(cacheKey, JSON.stringify({ keys }), { expirationTtl: JWKS_TTL })
  return keys
}

/**
 * 按 kid 找公钥。缓存里没有时强制刷新一次 —— 密钥轮换后新 kid 会立即出现，
 * 若不刷新，所有登录都会失败直到缓存自然过期。
 */
async function findKey(kv: KVNamespace, jwksUri: string, kid: string): Promise<Jwk> {
  let keys = await fetchJwks(kv, jwksUri)
  let key = keys.find((k) => k.kid === kid && k.kty === 'RSA')
  if (!key) {
    keys = await fetchJwks(kv, jwksUri, true)
    key = keys.find((k) => k.kid === kid && k.kty === 'RSA')
  }
  if (!key) throw new OidcError(`JWKS 中找不到 kid=${kid}`, 'KEY_NOT_FOUND')
  return key
}

// ─── ID token 验签 ───

interface JwtHeader {
  alg: string
  kid?: string
  typ?: string
}

/** 允许的时钟偏移（秒）。用户机器与服务端时间不同步是常态 */
const CLOCK_SKEW = 300

export async function verifyIdToken(
  kv: KVNamespace,
  cfg: PrismConfig,
  discovery: Discovery,
  idToken: string,
  expectedNonce?: string,
): Promise<IdTokenClaims> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new OidcError('ID token 格式错误', 'MALFORMED')

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string]

  let header: JwtHeader
  let claims: IdTokenClaims
  try {
    header = JSON.parse(base64UrlDecodeText(headerB64)) as JwtHeader
    claims = JSON.parse(base64UrlDecodeText(payloadB64)) as IdTokenClaims
  } catch {
    throw new OidcError('ID token 解析失败', 'MALFORMED')
  }

  // 只接受 RS256。放行其他算法（尤其 none）是 JWT 最经典的漏洞。
  if (header.alg !== 'RS256') {
    throw new OidcError(`不支持的签名算法：${header.alg}`, 'BAD_ALG')
  }
  if (!header.kid) throw new OidcError('ID token 缺少 kid', 'NO_KID')

  const jwk = await findKey(kv, discovery.jwks_uri, header.kid)
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(sigB64),
    encodeUtf8(`${headerB64}.${payloadB64}`),
  )
  if (!ok) throw new OidcError('ID token 签名无效', 'BAD_SIGNATURE')

  // ─── 声明校验 ───
  const now = Math.floor(Date.now() / 1000)

  if (claims.iss !== discovery.issuer && claims.iss !== cfg.issuer) {
    throw new OidcError('ID token 签发者不匹配', 'BAD_ISSUER')
  }

  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(cfg.clientId)) {
    throw new OidcError('ID token 受众不匹配', 'BAD_AUDIENCE')
  }

  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW < now) {
    throw new OidcError('ID token 已过期', 'EXPIRED')
  }
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW > now) {
    throw new OidcError('ID token 签发时间在未来', 'BAD_IAT')
  }

  if (expectedNonce && claims.nonce !== expectedNonce) {
    throw new OidcError('nonce 不匹配', 'BAD_NONCE')
  }

  if (!claims.sub) throw new OidcError('ID token 缺少 sub', 'NO_SUB')

  return claims
}

// ─── 授权码流程 ───

export interface AuthRequest {
  url: string
  state: string
  nonce: string
  codeVerifier: string
}

export async function buildAuthUrl(
  discovery: Discovery,
  cfg: PrismConfig,
  redirectUri: string,
  scopes: string[],
): Promise<AuthRequest> {
  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = randomToken(48)
  const codeChallenge = await sha256Base64Url(codeVerifier)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return {
    url: `${discovery.authorization_endpoint}?${params.toString()}`,
    state,
    nonce,
    codeVerifier,
  }
}

export async function exchangeCode(
  discovery: Discovery,
  cfg: PrismConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenSet> {
  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: codeVerifier,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new OidcError(`令牌交换失败：HTTP ${res.status} ${detail.slice(0, 200)}`, 'TOKEN_FAILED')
  }
  return (await res.json()) as TokenSet
}

export async function refreshTokens(
  discovery: Discovery,
  cfg: PrismConfig,
  refreshToken: string,
): Promise<TokenSet> {
  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  })

  if (!res.ok) {
    throw new OidcError(`刷新令牌失败：HTTP ${res.status}`, 'REFRESH_FAILED')
  }
  return (await res.json()) as TokenSet
}

export async function revokeToken(
  discovery: Discovery,
  cfg: PrismConfig,
  token: string,
): Promise<void> {
  if (!discovery.revocation_endpoint) return
  await fetch(discovery.revocation_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  }).catch(() => {
    // 撤销失败不阻塞登出：本地会话已经清掉，Prism 侧令牌会自然过期
  })
}

// ─── 身份组 claim ───

/**
 * 从 claim 中取出 NSUK 团队的身份组 slug 列表。
 *
 * 缺失是正常路径（普通成员没有任何组），返回空数组。
 * 注意与 `in_team_<id>` 区分：后者表示是否为团队成员，前者表示持有哪些标签。
 */
export function groupsOfTeam(claims: IdTokenClaims, teamId: string): string[] {
  const raw = claims[`groups_in_team_${teamId}`]
  if (!Array.isArray(raw)) return []
  return raw.filter((g): g is string => typeof g === 'string')
}

/** 是否为 NSUK 团队成员 */
export function isTeamMember(claims: IdTokenClaims, teamId: string): boolean {
  return claims[`in_team_${teamId}`] === true
}
