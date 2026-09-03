import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const ALLOWED_PORTS = new Set(['', '80', '443'])

function isBlockedIPv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = octets
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

function isBlockedIPv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (normalized === '::' || normalized === '::1') return true
  if (/^f[cd]/.test(normalized)) return true
  if (/^fe[89ab]/.test(normalized)) return true
  if (normalized.startsWith('ff')) return true
  if (normalized.startsWith('2001:db8:')) return true
  const mapped = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isBlockedIPv4(mapped[1]) : false
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isBlockedIPv4(address)
  if (family === 6) return isBlockedIPv6(address)
  return true
}

export async function assertSafeRemoteUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('URL 格式不正确')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许 HTTP 或 HTTPS URL')
  if (url.username || url.password) throw new Error('URL 不可包含账号信息')
  if (!ALLOWED_PORTS.has(url.port)) throw new Error('只允许标准 HTTP/HTTPS 端口')

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('不允许访问本机或内部地址')
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('不允许访问私有、保留或内部网络地址')
  }
  return url
}

// Resolve and validate every redirect hop; otherwise a public URL could
// redirect a server-side request into the private network.
export async function fetchPublicUrl(
  input: string,
  init: RequestInit = {},
  maxRedirects = 3
): Promise<Response> {
  let current = await assertSafeRemoteUrl(input)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location || hop === maxRedirects) throw new Error('目标地址重定向次数过多')
    await response.body?.cancel()
    current = await assertSafeRemoteUrl(new URL(location, current).href)
  }
  throw new Error('目标地址重定向次数过多')
}
