import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase-server'

const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 10

function clientIp(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

function isRateLimited(key: string) {
  const now = Date.now()
  if (attempts.size > 5_000) {
    for (const [candidate, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(candidate)
    }
    while (attempts.size > 5_000) attempts.delete(attempts.keys().next().value as string)
  }
  const current = attempts.get(key)
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  current.count += 1
  return current.count > MAX_ATTEMPTS
}

async function verifyTurnstile(token: string | undefined, ip: string) {
  if (process.env.NODE_ENV === 'development') return true
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return process.env.NODE_ENV !== 'production'
  if (!token) return false
  const body = new URLSearchParams({ secret, response: token })
  if (ip !== 'unknown') body.set('remoteip', ip)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) return false
  const result = await response.json() as { success?: boolean }
  return result.success === true
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > 16_384) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  const { username, password, turnstileToken } = await req.json().catch(() => ({})) as {
    username?: string; password?: string; turnstileToken?: string
  }
  const normalizedUsername = username?.trim() ?? ''
  if (normalizedUsername.length > 100 || (password?.length ?? 0) > 1024) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 400 })
  }

  if (!username?.trim() || !password) {
    return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 })
  }

  const ip = clientIp(req)
  const rateLimitKey = `${ip}:${normalizedUsername.toLowerCase()}`
  if (isRateLimited(rateLimitKey)) return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  try {
    if (!await verifyTurnstile(turnstileToken, ip)) {
      return NextResponse.json({ error: 'Human verification failed' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Verification service unavailable' }, { status: 503 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile, error: profileError } = await service
    .from('user_profiles')
    .select('id')
    .ilike('username', normalizedUsername)
    .maybeSingle()

  if (profileError) {
    console.error('Unable to query login profile:', profileError.message)
    return NextResponse.json({ error: '无法连接账户服务，请稍后重试' }, { status: 503 })
  }

  if (!profile?.id) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  const { data: { user }, error: userError } = await service.auth.admin.getUserById(profile.id)
  if (userError || !user?.email) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  // Use plain anon client to verify password — returns session tokens, email never leaves server
  const anonClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email: user.email,
    password,
  })

  if (signInError || !signInData.session) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  const sessionClient = await createClient()
  const { error: sessionError } = await sessionClient.auth.setSession(signInData.session)
  if (sessionError) return NextResponse.json({ error: 'Unable to establish session' }, { status: 500 })

  attempts.delete(rateLimitKey)
  return NextResponse.json({ ok: true })
}
