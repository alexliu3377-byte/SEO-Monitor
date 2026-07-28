import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

const ALLOWED_KEYS = ['baidu_index_cookie'] as const
type SettingKey = typeof ALLOWED_KEYS[number]

export async function GET(req: Request) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = new URL(req.url).searchParams.get('key') as SettingKey | null
  if (!key || !ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: '无效 key' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('app_settings').select('value, updated_at').eq('key', key).maybeSingle()
  return NextResponse.json({ key, value: data?.value ?? null, updated_at: data?.updated_at ?? null })
}

export async function POST(req: Request) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // baidu_index_cookie 池由全体登录用户共同维护（不限管理员），故无角色限制
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const body = await req.json().catch(() => ({}))
  const key = body.key as SettingKey
  const value = body.value as string

  if (!key || !ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: '无效 key' }, { status: 400 })
  }

  await service.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return NextResponse.json({ ok: true })
}
