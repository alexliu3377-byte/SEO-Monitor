import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-server'

// 按 IP 做简单的失败次数限流——这个接口接受任意 username/password 组合去
// 撞 signInWithPassword，没有限流的话就是一个不限速的密码暴力破解入口。
// 内存 Map 在serverless冷启动后会重置，不是严格保证，但足以挡住大批量脚本化尝试。
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_MAX_ATTEMPTS = 8
const attemptsByIp = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const attempts = (attemptsByIp.get(ip) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  attempts.push(now)
  attemptsByIp.set(ip, attempts)
  return attempts.length > RATE_LIMIT_MAX_ATTEMPTS
}

export async function POST(req: Request) {
  // 这个接口本身没有做登录校验，任何人（哪怕没登录过系统）都能直接调用它
  // 去尝试任意账号的密码——先要求调用方已经有登录会话，把攻击面收窄到
  // "已登录用户"，跟这个弹窗只会出现在需要登录才能进入的仪表盘页面里一致。
  const authClient = createClient()
  const { data: { user: caller } } = await authClient.auth.getUser()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1'
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: '尝试次数过多，请稍后再试' }, { status: 429 })
  }

  const { username, password } = await req.json()
  if (!username || !password) {
    return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 })
  }

  const service = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Look up email from username via user_profiles → auth.users
  const { data: profile, error: profileErr } = await service
    .from('user_profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  if (profileErr || !profile) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  const { data: authUser, error: authErr } = await service.auth.admin.getUserById(profile.id)
  if (authErr || !authUser?.user?.email) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  // Verify password with a fresh anon client
  const anon = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { error: signInErr } = await anon.auth.signInWithPassword({ email: authUser.user.email, password })
  if (signInErr) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}
