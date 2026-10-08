import { createHmac, timingSafeEqual } from 'node:crypto'

export const DAILY_LOGIN_COOKIE_NAME = 'qixin_daily_login_v1'

const COOKIE_VERSION = 1
const KUALA_LUMPUR_OFFSET_MS = 8 * 60 * 60 * 1000
const SECRET_DERIVATION_CONTEXT = 'qixin-daily-login-cookie:v1'

type DailyLoginPayload = {
  v: typeof COOKIE_VERSION
  userId: string
  date: string
}

function normalizedUserId(userId: string): string {
  const normalized = userId.trim()
  if (!normalized) throw new Error('Daily login cookie requires a user id')
  return normalized
}

function kualaLumpurDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Daily login cookie requires a valid date')
  return new Date(now.getTime() + KUALA_LUMPUR_OFFSET_MS).toISOString().slice(0, 10)
}

function signingKey(): string | Buffer {
  const dedicatedSecret = process.env.DAILY_LOGIN_SECRET?.trim()
  if (dedicatedSecret) return dedicatedSecret

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!serviceRoleKey) {
    throw new Error('DAILY_LOGIN_SECRET or SUPABASE_SERVICE_ROLE_KEY is not configured')
  }

  // Domain-separate this key from other uses of the Supabase service-role key.
  return createHmac('sha256', serviceRoleKey)
    .update(SECRET_DERIVATION_CONTEXT)
    .digest()
}

function signature(payload: string): Buffer {
  return createHmac('sha256', signingKey()).update(payload).digest()
}

function isDailyLoginPayload(value: unknown): value is DailyLoginPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<DailyLoginPayload>
  return (
    payload.v === COOKIE_VERSION &&
    typeof payload.userId === 'string' &&
    payload.userId.length > 0 &&
    typeof payload.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
  )
}

/**
 * Returns the number of whole seconds a cookie can live before the next
 * midnight in Asia/Kuala_Lumpur. The value is rounded up for Max-Age so a
 * fractional final second is not discarded.
 */
export function secondsUntilKualaLumpurMidnight(now = new Date()): number {
  if (!Number.isFinite(now.getTime())) throw new Error('Daily login cookie requires a valid date')

  const local = new Date(now.getTime() + KUALA_LUMPUR_OFFSET_MS)
  const nextLocalMidnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
  )
  const nextMidnight = nextLocalMidnightAsUtc - KUALA_LUMPUR_OFFSET_MS
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000))
}

/** Sign a cookie value that is valid only for this user and Kuala Lumpur day. */
export function issueDailyLoginCookie(userId: string, now = new Date()): string {
  const payload: DailyLoginPayload = {
    v: COOKIE_VERSION,
    userId: normalizedUserId(userId),
    date: kualaLumpurDate(now),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const encodedSignature = signature(encodedPayload).toString('base64url')
  return `${encodedPayload}.${encodedSignature}`
}

/** Verify the signature, user binding, and current Kuala Lumpur calendar day. */
export function verifyDailyLoginCookie(
  value: string | null | undefined,
  userId: string,
  now = new Date(),
): boolean {
  if (!value || value.length > 2048) return false

  let expectedUserId: string
  try {
    expectedUserId = normalizedUserId(userId)
  } catch {
    return false
  }

  const parts = value.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false
  const [encodedPayload, encodedSignature] = parts
  if (
    !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
    !/^[A-Za-z0-9_-]+$/.test(encodedSignature)
  ) {
    return false
  }

  try {
    const suppliedSignature = Buffer.from(encodedSignature, 'base64url')
    const expectedSignature = signature(encodedPayload)
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return false
    }

    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const payload: unknown = JSON.parse(decoded)
    return (
      isDailyLoginPayload(payload) &&
      payload.userId === expectedUserId &&
      payload.date === kualaLumpurDate(now)
    )
  } catch {
    return false
  }
}
