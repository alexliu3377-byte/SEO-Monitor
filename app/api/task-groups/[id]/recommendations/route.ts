import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import type { UserRole } from '@/lib/user-context'

export const maxDuration = 60

const PAGE_SIZE = 20

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') === 'rankup' ? 'rankup' : 'rankdown'
  const page = Math.min(100000, Math.max(0, Number.parseInt(searchParams.get('page') || '0', 10) || 0))
  const requestedUserId = searchParams.get('userId') || user.id

  // Only the server may call this RPC. User IDs come from the authorized
  // membership list, never directly from request parameters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  try {
    const { data: profile, error: profileError } = await service.from('user_profiles').select('role, is_active').eq('id', user.id).single()
    if (profileError) throw profileError
    if (profile?.is_active === false) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const role = (profile?.role ?? 'normal') as UserRole
    const canManage = role === 'super' || role === 'admin'
    if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [{ data: group, error: groupError }, { data: members, error: membersError }] = await Promise.all([
      service.from('task_groups').select('id').eq('id', groupId).maybeSingle(),
      service.from('task_group_members').select('user_id').eq('group_id', groupId),
    ])
    if (groupError || membersError) throw groupError || membersError
    if (!group) return NextResponse.json({ error: 'Task group not found' }, { status: 404 })
    const memberIds = ((members ?? []) as { user_id: string }[]).map(member => member.user_id)
    if (!canManage && (!memberIds.includes(user.id) || requestedUserId !== user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (canManage && requestedUserId !== user.id && !memberIds.includes(requestedUserId)) {
      return NextResponse.json({ error: 'Group member not found' }, { status: 404 })
    }

    // Managers retain the merged-team view; members can only see themselves.
    const targetUsers = canManage ? memberIds : [user.id]
    if (targetUsers.length === 0) return NextResponse.json({ rows: [], total: 0, page, pageSize: PAGE_SIZE })

    const { data, error } = await service.rpc('get_task_group_recommendations_page', {
      p_group_id: groupId,
      p_user_ids: targetUsers,
      p_type: type,
      p_page: page,
      p_page_size: PAGE_SIZE,
    })
    if (error) throw error
    if (!data || !Array.isArray(data.rows) || typeof data.total !== 'number') {
      throw new Error('Invalid recommendation page response')
    }
    // Re-evaluate cooldowns and dismissals after a submission changes.
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Task group recommendations failed:', error)
    return NextResponse.json({ error: '今日推荐读取失败，请重试' }, { status: 500 })
  }
}
