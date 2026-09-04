import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

const ALLOWED_KEYS = ['baidu_index_cookie'] as const
type SettingKey = typeof ALLOWED_KEYS[number]

async function requireCookieManager() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { status: 401 as const, service: null }
  const service = createServiceClient() as any
  const [{ data: profile }, { data: membership }] = await Promise.all([
    service.from('user_profiles').select('role').eq('id', user.id).maybeSingle(),
    service.from('task_group_members').select('user_id').eq('user_id', user.id).limit(1).maybeSingle(),
  ])
  if (!['super', 'admin'].includes(profile?.role) && !membership) {
    return { status: 403 as const, service: null }
  }
  return { status: 200 as const, service }
}

export async function GET(req: Request) {
  const auth = await requireCookieManager()
  if (!auth.service) return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status })

  const key = new URL(req.url).searchParams.get('key') as SettingKey | null
  if (!key || !ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: '无效 key' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await auth.service.from('app_settings').select('value, updated_at').eq('key', key).maybeSingle()
  if (error) return NextResponse.json({ error: 'Failed to read setting' }, { status: 500 })
  return NextResponse.json({ key, value: data?.value ?? null, updated_at: data?.updated_at ?? null })
}

export async function POST(req: Request) {
  const auth = await requireCookieManager()
  if (!auth.service) return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status })

  // baidu_index_cookie 池由全体登录用户共同维护（不限管理员），故无角色限制
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await req.json().catch(() => ({}))
  const key = body.key as SettingKey
  const value = body.value as string

  if (!key || !ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: '无效 key' }, { status: 400 })
  }

  if (typeof value !== 'string' || value.length > 32_768) {
    return NextResponse.json({ error: 'Invalid value' }, { status: 400 })
  }

  const { error } = await auth.service.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
