import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { resolveUserDisplayNames } from '@/lib/user-display-name'
import {
  currentMonth, monthRange, RANK_BUCKETS,
} from '@/lib/tracking-summary'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import { loadFastTrackingDetail } from '@/lib/group-tracking-cache'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)
  const month = /^\d{4}-\d{2}$/.test(searchParams.get('month') || '') ? searchParams.get('month')! : currentMonth()
  const { start, end } = monthRange(month)
  const kind = searchParams.get('kind') === 'rank' ? 'rank' : 'indexed'
  const bucketLabel = searchParams.get('bucket') || ''
  const requestedScope = searchParams.get('scope') || 'own'
  const requestedMemberId = searchParams.get('memberId') || ''
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0)
  const pageSize = 50

  if (kind === 'rank' && !RANK_BUCKETS.some(b => b.label === bucketLabel)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'normal') as UserRole
  const canSeeAll = role === 'super' || role === 'admin'

  const { data: membersRaw } = await service
    .from('task_group_members').select('user_id, username').eq('group_id', groupId)
  const memberList = (membersRaw || []) as { user_id: string; username: string | null }[]

  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let scope = canSeeAll ? requestedScope : 'own'
  let scopeUserId = ''
  if (scope === 'member') {
    if (!memberList.some(m => m.user_id === requestedMemberId)) scope = 'total'
    else scopeUserId = requestedMemberId
  }

  const bucket = kind === 'rank' ? RANK_BUCKETS.find(item => item.label === bucketLabel)! : null
  const fastDetail = await loadFastTrackingDetail(service, {
    p_group_id: groupId,
    p_start_date: start,
    p_end_date: end,
    p_effectiveness: kind === 'rank' ? '获取排名' : '获取收录',
    p_scope_user_id: scope === 'total' ? null : scope === 'own' ? user.id : scopeUserId,
    p_rank_min: bucket?.min ?? null,
    p_rank_max: bucket?.max ?? null,
    p_offset: page * pageSize,
    p_limit: pageSize,
  }) as { rows?: Array<Record<string, unknown>>; total?: number } | null
  if (fastDetail) {
    const fastRows = fastDetail.rows ?? []
    const names = await resolveUserDisplayNames(
      service,
      fastRows.map(row => typeof row.user_id === 'string' ? row.user_id : '').filter(Boolean),
      memberList,
    )
    const rows = fastRows.map(row => {
      const safeRow = { ...row }
      const rowUserId = typeof safeRow.user_id === 'string' ? safeRow.user_id : ''
      if (scope === 'total') safeRow.username = names.get(rowUserId) ?? safeRow.username
      else delete safeRow.username
      delete safeRow.user_id
      return safeRow
    })
    return NextResponse.json({
      kind,
      bucket: kind === 'rank' ? bucketLabel : undefined,
      rows,
      total: fastDetail.total ?? 0,
      page,
      pageSize,
    })
  }

  return NextResponse.json({
    error: '追踪明细快照尚未准备完成，请等待后台更新', code: 'CACHE_NOT_READY',
  }, { status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'private, no-store' } })
}
