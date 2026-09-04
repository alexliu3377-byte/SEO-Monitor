import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { resolveUserDisplayNames } from '@/lib/user-display-name'
import { fetchAllRows } from '@/lib/supabase-paginate'
import {
  currentMonth, monthRange, dedupeByClaim, fetchClaimSourceMap, fetchRankMatches,
  effectiveMatchesForClaim, RANK_BUCKETS, type TrackRow,
} from '@/lib/tracking-summary'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import { loadFastTrackingDetail } from '@/lib/group-tracking-cache'

interface DetailRow {
  claim_id: string; user_id: string; submit_date: string; record_date: string
  keyword: string; final_keyword: string | null; search_volume: number
  rank_position: number | null; rank_volume: number; rank_keyword: string | null
  operation_type: string | null
  effectiveness: string
}

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
  const isMember = memberList.some(m => m.user_id === user.id)

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

  // Supabase/PostgREST 在这个项目上单次查询硬截到3000行，不管 .limit() 传多大——
  // count-then-limit 治标不治本，改用 fetchAllRows 真分页（见 lib/supabase-paginate.ts）。
  const rawRows = await fetchAllRows<TrackRow & DetailRow>((from, to) => {
    let query = service
      .from('site_tracking_records')
      .select('claim_id, user_id, submit_date, record_date, keyword, final_keyword, search_volume, rank_position, rank_volume, rank_keyword, operation_type, effectiveness')
      .eq('group_id', groupId).gte('submit_date', start).lte('submit_date', end)
      .eq('effectiveness', kind === 'rank' ? '获取排名' : '获取收录')
      .order('record_date', { ascending: false }).order('id', { ascending: true })
      .range(from, to)
    if (scope === 'own') query = query.eq('user_id', user.id)
    else if (scope === 'member') query = query.eq('user_id', scopeUserId)
    return query
  })

  const rows = dedupeByClaim(rawRows)
  const usernameOf = await resolveUserDisplayNames(
    service,
    [...memberList.map(m => m.user_id), ...rows.map(r => r.user_id)],
    memberList
  )
  const claimIds = rows.map(r => r.claim_id)
  const claimSourceMap = await fetchClaimSourceMap(service, claimIds)
  const showUsername = scope === 'total'

  if (kind === 'indexed') {
    const out = rows
      .map(r => ({
        keyword: r.keyword, final_keyword: r.final_keyword, search_volume: r.search_volume || 0,
        source: claimSourceMap.get(r.claim_id) ?? '未知', operation_type: r.operation_type,
        username: showUsername ? (usernameOf.get(r.user_id) ?? r.user_id.slice(0, 8)) : undefined,
      }))
      .sort((a, b) => b.search_volume - a.search_volume)
    return NextResponse.json({ kind, rows: out.slice(page * pageSize, (page + 1) * pageSize), total: out.length, page, pageSize })
  }

  const bucketDef = RANK_BUCKETS.find(b => b.label === bucketLabel)!
  const matchesByClaim = await fetchRankMatches(service, claimIds)
  const out: { keyword: string; final_keyword: string | null; rank_position: number; rank_keyword: string; rank_volume: number; source: string; operation_type: string | null; username?: string }[] = []
  for (const r of rows) {
    const src = claimSourceMap.get(r.claim_id) ?? '未知'
    const username = showUsername ? (usernameOf.get(r.user_id) ?? r.user_id.slice(0, 8)) : undefined
    for (const m of effectiveMatchesForClaim(r, matchesByClaim)) {
      if (m.rank_position == null || m.rank_position < bucketDef.min || m.rank_position > bucketDef.max) continue
      out.push({
        keyword: r.keyword, final_keyword: r.final_keyword,
        rank_position: m.rank_position, rank_keyword: m.keyword || r.keyword,
        rank_volume: m.volume || 0, source: src, operation_type: r.operation_type, username,
      })
    }
  }
  out.sort((a, b) => b.rank_volume - a.rank_volume)
  return NextResponse.json({ kind, bucket: bucketLabel, rows: out.slice(page * pageSize, (page + 1) * pageSize), total: out.length, page, pageSize })
}
