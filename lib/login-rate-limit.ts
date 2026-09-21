import 'server-only'

import { createHmac } from 'node:crypto'

type ServiceClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { code?: string; message?: string } | null
  }>
}

type LimitResult = {
  allowed: boolean
  retryAfterSeconds: number
}

function digestLoginIdentifier(scope: string, value: string): string {
  // Reuse the server-only service key as an HMAC secret so the rate-limit
  // table never contains raw IP addresses or usernames and needs no new env.
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createHmac('sha256', secret)
    .update(`${scope}\0${value.trim().toLowerCase()}`)
    .digest('hex')
}

function identifiers(ip: string, username: string) {
  const normalizedIp = ip.trim() || 'unknown'
  const normalizedUsername = username.trim().toLowerCase()
  return {
    ipHash: digestLoginIdentifier('ip', normalizedIp),
    usernameHash: digestLoginIdentifier('ip-username', `${normalizedIp}\0${normalizedUsername}`),
  }
}

export async function consumeLoginRateLimit(
  service: ServiceClient,
  ip: string,
  username: string
): Promise<LimitResult> {
  const { ipHash, usernameHash } = identifiers(ip, username)
  const { data, error } = await service.rpc('consume_login_rate_limit', {
    p_ip_hash: ipHash,
    p_username_hash: usernameHash,
  })
  if (error) throw new Error(`Login rate limit failed (${error.code ?? 'unknown'})`)

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') throw new Error('Login rate limit returned no result')
  const result = row as { allowed?: unknown; retry_after_seconds?: unknown }
  return {
    allowed: result.allowed === true,
    retryAfterSeconds: Math.max(0, Number(result.retry_after_seconds) || 0),
  }
}

export async function clearSuccessfulLoginLimit(
  service: ServiceClient,
  ip: string,
  username: string
): Promise<void> {
  const { usernameHash } = identifiers(ip, username)
  const { error } = await service.rpc('clear_successful_login_rate_limit', {
    p_username_hash: usernameHash,
  })
  if (error) throw new Error(`Unable to clear successful login limit (${error.code ?? 'unknown'})`)
}
