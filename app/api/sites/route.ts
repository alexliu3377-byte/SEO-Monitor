import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { getUserProfile } from '@/lib/get-user-profile'

async function getCallerRole(): Promise<string | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return data?.role ?? 'normal'
}

export async function GET() {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const supabase = createServiceClient()
    let query = supabase.from('sites').select('*').order('created_at', { ascending: false })
    // normal 角色只能看 accessibleSiteIds 范围内的站点（focus_level=3 或被
    // user_site_access 授权）——之前只在前端过滤，接口本身没做同等限制。
    if (profile.accessibleSiteIds) query = query.in('id', profile.accessibleSiteIds)
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ sites: data })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '查询失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const role = await getCallerRole()
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await request.json()
    const { id, created_at, ...insertData } = body
    void id; void created_at

    const supabase = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('sites') as any).insert(insertData)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ site: data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '创建失败' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const role = await getCallerRole()
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await request.json()
    const { id, created_at, ...updateData } = body
    if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
    void created_at

    const supabase = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('sites') as any).update(updateData).eq('id', id).select().single()
    if (error) throw error
    return NextResponse.json({ site: data })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '更新失败' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const role = await getCallerRole()
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

    const supabase = createServiceClient()
    const { error } = await supabase.from('sites').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '删除失败' }, { status: 500 })
  }
}
