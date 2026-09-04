import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import type { UserRole } from '@/lib/user-context'

async function getCallerRole(): Promise<UserRole | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return ((data?.role ?? 'normal') as UserRole)
}

// GET /api/admin/users
export async function GET(req: Request) {
  const callerRole = await getCallerRole()
  if (!callerRole || callerRole === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: { users }, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  const { data: profiles } = await service.from('user_profiles').select('id, role, username, is_active, disabled_at')
  const profileMap = new Map<string, {
    role: UserRole
    username: string | null
    is_active: boolean
    disabled_at: string | null
  }>(
    ((profiles ?? []) as Array<{
      id: string
      role: UserRole
      username: string | null
      is_active?: boolean
      disabled_at?: string | null
    }>).map((p) => [p.id, {
      role: p.role,
      username: p.username,
      is_active: p.is_active !== false,
      disabled_at: p.disabled_at ?? null,
    }])
  )

  const result = (users as { id: string; email: string; created_at: string }[]).map(u => ({
    id: u.id,
    email: u.email ?? '',
    username: profileMap.get(u.id)?.username ?? null,
    role: profileMap.get(u.id)?.role ?? 'normal' as UserRole,
    is_active: profileMap.get(u.id)?.is_active ?? true,
    disabled_at: profileMap.get(u.id)?.disabled_at ?? null,
    created_at: u.created_at,
  }))

  let filtered = callerRole === 'admin'
    ? result.filter(u => u.role === 'normal')
    : result
  if (new URL(req.url).searchParams.get('activeOnly') === '1') {
    filtered = filtered.filter(user => user.is_active)
  }

  return NextResponse.json({ users: filtered })
}

// POST /api/admin/users
export async function POST(req: Request) {
  const callerRole = await getCallerRole()
  if (!callerRole || callerRole === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { username, email, password, role } = await req.json() as {
    username: string
    email: string
    password: string
    role: UserRole
  }

  const normalizedUsername = username?.trim()
  const normalizedEmail = email?.trim().toLowerCase()

  if (!normalizedUsername || !normalizedEmail || !password || !role) {
    return NextResponse.json({ error: '缺少必填字段' }, { status: 400 })
  }

  if (normalizedUsername.length > 64 || password.length < 8 || !['normal', 'admin', 'super'].includes(role)) {
    return NextResponse.json({ error: 'Invalid account details' }, { status: 400 })
  }

  if (callerRole === 'admin' && role !== 'normal') {
    return NextResponse.json({ error: '管理员只能新增普通账号' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: duplicate } = await service
    .from('user_profiles')
    .select('id')
    .ilike('username', normalizedUsername)
    .maybeSingle()
  if (duplicate) return NextResponse.json({ error: 'Username is already in use' }, { status: 409 })

  const { data: { user }, error } = await service.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
  })
  if (error) return NextResponse.json({ error: 'Account creation failed; the email may already be in use' }, { status: 500 })
  if (!user) return NextResponse.json({ error: '创建失败' }, { status: 500 })

  const { error: profileError } = await service
    .from('user_profiles')
    .insert({ id: user.id, role, username: normalizedUsername })
  if (profileError) {
    await service.auth.admin.deleteUser(user.id)
    const status = profileError.code === '23505' ? 409 : 500
    return NextResponse.json({ error: status === 409 ? 'Username is already in use' : 'Profile creation failed' }, { status })
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email ?? '',
      username: normalizedUsername,
      role,
      is_active: true,
      disabled_at: null,
      created_at: user.created_at,
    }
  })
}
