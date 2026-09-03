import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { canVerifyExportPurpose, isExportVerificationPurpose } from '@/lib/kw-export-owner'

// 按 IP 做简单的失败次数限流——这个接口接受任意 username/password 组合去
// 撞 signInWithPassword，没有限流的话就是一个不限速的密码暴力破解入口。
// 内存 Map 在serverless冷启动后会重置，不是严格保证，但足以挡住大批量脚本化尝试。
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_MAX_ATTEMPTS = 8
const attemptsByCaller = new Map<string, number[]>()

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const attempts = (attemptsByCaller.get(key) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  attempts.push(now)
  attemptsByCaller.set(key, attempts)
  return attempts.length > RATE_LIMIT_MAX_ATTEMPTS
}

export async function POST(req: Request) {
  // 这个接口本身没有做登录校验，任何人（哪怕没登录过系统）都能直接调用它
  // 去尝试任意账号的密码——先要求调用方已经有登录会话，把攻击面收窄到
  // "已登录用户"，跟这个弹窗只会出现在需要登录才能进入的仪表盘页面里一致。
  const authClient = await createClient()
  const { data: { user: caller } } = await authClient.auth.getUser()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    username?: unknown
    password?: unknown
    purpose?: unknown
  } | null
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const purpose = body?.purpose
  if (!username || username.length > 100 || !password || password.length > 1024 ||
      !isExportVerificationPurpose(purpose)) {
    return NextResponse.json({ error: '请求参数无效' }, { status: 400 })
  }

  // The checked-in Database type is a partial historical snapshot and does not
  // yet describe every user_profiles column in the live project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: callerProfile, error: profileError } = await service
    .from('user_profiles')
    .select('username, role')
    .eq('id', caller.id)
    .maybeSingle()
  if (profileError || !callerProfile) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!canVerifyExportPurpose(caller.id, callerProfile.role, purpose)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1'
  const rateLimitKey = `${caller.id}:${ip}`
  if (isRateLimited(rateLimitKey)) {
    return NextResponse.json({ error: '尝试次数过多，请稍后再试' }, { status: 429 })
  }

  // Re-authenticate the logged-in caller only. Previously this endpoint could
  // test credentials for an arbitrary username, even though the export action
  // belongs to the current session.
  if (callerProfile.username?.trim().toLocaleLowerCase('en-US') !== username.toLocaleLowerCase('en-US') || !caller.email) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  // Verify password with a fresh anon client
  const anon = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: verified, error: signInErr } = await anon.auth.signInWithPassword({ email: caller.email, password })
  if (signInErr || verified.user?.id !== caller.id) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  attemptsByCaller.delete(rateLimitKey)
  return NextResponse.json({ ok: true })
}
