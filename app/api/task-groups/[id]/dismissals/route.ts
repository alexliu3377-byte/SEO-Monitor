import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/supabase-paginate'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'

async function getCaller() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return null
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return { id: user.id, role: (profile?.role ?? 'normal') as UserRole, service }
}

async function isGroupMember(service: any, groupId: string, userId: string) {
  const { data } = await service.from('task_group_members').select('user_id')
    .eq('group_id', groupId).eq('user_id', userId).maybeSingle()
  return !!data
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)
  const all = searchParams.get('all') === '1'
  const targetUserId = searchParams.get('userId') || caller.id
  if (!await canAccessTaskGroup(caller.service, caller.id, caller.role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const canManage = ['admin', 'super'].includes(caller.role)
  if (all && !canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (targetUserId !== caller.id && !canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManage && !await isGroupMember(caller.service, groupId, caller.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!all && !await isGroupMember(caller.service, groupId, targetUserId)) {
    return NextResponse.json({ error: 'Group member not found' }, { status: 404 })
  }

  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const rows = await fetchAllRows<{ user_id: string; keyword: string; dismissed_at: string }>((from, to) => {
    let query = caller.service.from('member_rec_dismissals')
      .select('user_id, keyword, dismissed_at')
      .eq('group_id', groupId)
      .gte('dismissed_at', since)
      .order('user_id', { ascending: true })
      .order('keyword', { ascending: true })
      .range(from, to)
    if (!all) query = query.eq('user_id', targetUserId)
    return query
  })
  return NextResponse.json({ rows })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: groupId } = await params
  const body = await req.json().catch(() => ({})) as { userId?: string; keyword?: string; permanent?: boolean }
  const targetUserId = body.userId || caller.id
  const keyword = body.keyword?.trim() || ''
  if (!await canAccessTaskGroup(caller.service, caller.id, caller.role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const canManage = ['admin', 'super'].includes(caller.role)
  if (targetUserId !== caller.id && !canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!keyword || keyword.length > 200) return NextResponse.json({ error: 'Invalid keyword' }, { status: 400 })
  if (!await isGroupMember(caller.service, groupId, targetUserId)) {
    return NextResponse.json({ error: 'Group member not found' }, { status: 404 })
  }

  const dismissedAt = body.permanent ? '2099-12-31T00:00:00.000Z' : new Date().toISOString()
  const { error } = await caller.service.from('member_rec_dismissals').upsert(
    { group_id: groupId, user_id: targetUserId, keyword, dismissed_at: dismissedAt },
    { onConflict: 'group_id,user_id,keyword' }
  )
  if (error) return NextResponse.json({ error: 'Unable to dismiss recommendation' }, { status: 500 })
  return NextResponse.json({ dismissedAt })
}
