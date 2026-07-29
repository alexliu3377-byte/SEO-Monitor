import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeOutcomeScore } from '@/lib/outcome-score'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = user.id

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role: string = profile?.role ?? 'normal'
  const canSeeAll = role === 'super' || role === 'admin'

  if (!canSeeAll) {
    const { data: member } = await service
      .from('task_group_members').select('user_id')
      .eq('group_id', groupId).eq('user_id', user.id).maybeSingle()
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Members lookup (for usernames)
  const { data: membersRaw } = await service
    .from('task_group_members').select('user_id, username').eq('group_id', groupId)
  const memberMap = new Map<string, string>(
    (membersRaw || []).map((m: { user_id: string; username: string | null }) =>
      [m.user_id, m.username || m.user_id.slice(0, 8)])
  )

  // Filters — accept both submitStart and discoverStart for backward compat
  const filterSubmitStart   = searchParams.get('submitStart')  || searchParams.get('discoverStart') || ''
  const filterSubmitEnd     = searchParams.get('submitEnd')    || searchParams.get('discoverEnd')   || ''
  const filterMember        = searchParams.get('memberId') || ''
  const filterOp            = searchParams.get('opType') || ''
  const filterKw            = (searchParams.get('keyword') || '').toLowerCase()
  const filterIndex         = searchParams.get('indexed') || ''         // 'has' | 'none'
  const filterRankKw        = (searchParams.get('rankKeyword') || '').toLowerCase()
  const filterEffectiveness = searchParams.get('outcome') || ''         // '获取排名'|'获取收录'|'追踪中'|'无效'
  const sortBy              = searchParams.get('sortBy') || 'submit_date'
  const sortDir             = searchParams.get('sortDir') || 'desc'
  const page                = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0)
  const pageSize            = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10) || 20))

  // Fetch bad environment dates (crawl anomaly or site-wide index drop > 5%)
  const since90 = new Date(Date.now() + 8 * 3600000 - 90 * 86400000).toISOString().slice(0, 10)
  const { data: envDays } = await service
    .from('environment_daily')
    .select('date, crawl_anomaly, avg_index_change_pct')
    .gte('date', since90)
  const badDates = new Set<string>()
  for (const e of (envDays ?? []) as { date: string; crawl_anomaly: boolean; avg_index_change_pct: number | null }[]) {
    if (e.crawl_anomaly || (e.avg_index_change_pct !== null && e.avg_index_change_pct < -5)) {
      badDates.add(e.date)
    }
  }

  // Build the shared filter set once so the count query and the row query stay
  // in sync — the limit below is sized off this exact count, so a mismatch
  // here would silently reintroduce truncation.
  function applyTrackFilters<T extends { eq: any; gte: any; lte: any }>(q: T): T {
    let query = q
    if (!canSeeAll) query = query.eq('user_id', userId)
    if (filterMember && canSeeAll) query = query.eq('user_id', filterMember)
    if (filterOp) query = query.eq('operation_type', filterOp)
    if (filterEffectiveness) query = query.eq('effectiveness', filterEffectiveness)
    if (filterSubmitStart) query = query.gte('submit_date', filterSubmitStart)
    if (filterSubmitEnd)   query = query.lte('submit_date', filterSubmitEnd)
    return query
  }

  // site_tracking_records keeps one row per claim per tracking day forever, so a
  // fixed LIMIT eventually truncates any long-lived group (verified 2026-07-29:
  // one group already had 3441 rows against the old 2000 cap). Each claim can
  // only ever accumulate rows while claimed_date is within the 90-day tracking
  // window, so counting exact matching rows first and sizing the limit off that
  // is a real upper bound, not a guess — it can never truncate.
  const { count: exactCount } = await applyTrackFilters(
    service.from('site_tracking_records').select('id', { count: 'exact', head: true }).eq('group_id', groupId)
  )
  const rowLimit = Math.max(exactCount ?? 0, 1)

  let trackQuery = service
    .from('site_tracking_records')
    .select('id, claim_id, user_id, keyword, final_keyword, page_url, operation_type, search_volume, submit_date, record_date, is_indexed, index_first_seen, index_disappeared, rank_keyword, rank_position, prev_rank_position, rank_volume, rank_date, effectiveness')
    .eq('group_id', groupId)
    .order('record_date', { ascending: false })
    .order('submit_date', { ascending: false })
    .limit(rowLimit)
  trackQuery = applyTrackFilters(trackQuery)

  const { data: trackRows, error: trackErr } = await trackQuery
  if (trackErr) return NextResponse.json({ error: trackErr.message }, { status: 500 })

  type TrackRow = {
    id: string; claim_id: string; user_id: string
    keyword: string; final_keyword: string | null
    page_url: string | null; operation_type: string | null
    search_volume: number; submit_date: string; record_date: string
    is_indexed: boolean; index_first_seen: string | null; index_disappeared: string | null
    rank_keyword: string | null; rank_position: number | null; prev_rank_position: number | null
    rank_volume: number; rank_date: string | null; effectiveness: string
  }

  // Deduplicate: keep only the latest record per claim (rows already sorted record_date DESC)
  const seen = new Set<string>()
  const dedupedRows = ((trackRows || []) as TrackRow[]).filter(r => {
    if (seen.has(r.claim_id)) return false
    seen.add(r.claim_id)
    return true
  })

  // Fetch experiment_group for deduped claim_ids (batched to avoid URL length limits)
  const claimIds = dedupedRows.map(r => r.claim_id)
  const expGroupMap = new Map<string, 'control' | 'treatment' | null>()
  const BATCH = 200
  for (let i = 0; i < claimIds.length; i += BATCH) {
    const { data: claimMeta } = await service
      .from('member_claimed_keywords')
      .select('id, experiment_group')
      .in('id', claimIds.slice(i, i + BATCH))
    for (const c of (claimMeta ?? []) as { id: string; experiment_group: 'control' | 'treatment' | null }[]) {
      expGroupMap.set(c.id, c.experiment_group)
    }
  }

  let rows = dedupedRows.map(r => ({
    ...r,
    username: memberMap.get(r.user_id) ?? r.user_id.slice(0, 8),
    rank_change: (r.rank_position != null && r.prev_rank_position != null)
      ? r.prev_rank_position - r.rank_position
      : null,
    env_excluded: badDates.has(r.record_date),
    experiment_group: expGroupMap.get(r.claim_id) ?? null,
  }))

  // Post-fetch filters
  if (filterKw)              rows = rows.filter(r => r.keyword.toLowerCase().includes(filterKw) || (r.final_keyword ?? '').toLowerCase().includes(filterKw))
  if (filterIndex === 'has') rows = rows.filter(r => r.is_indexed)
  if (filterIndex === 'none')rows = rows.filter(r => !r.is_indexed)
  if (filterRankKw)          rows = rows.filter(r => (r.rank_keyword ?? '').toLowerCase().includes(filterRankKw))

  // Sort
  const dir = sortDir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    switch (sortBy) {
      case 'search_volume': return dir * ((a.search_volume ?? 0) - (b.search_volume ?? 0))
      case 'rank_change': {
        const ra = a.rank_change ?? -9999; const rb = b.rank_change ?? -9999
        return dir * (ra - rb)
      }
      case 'rank_volume': return dir * ((a.rank_volume ?? 0) - (b.rank_volume ?? 0))
      case 'record_date': return dir * a.record_date.localeCompare(b.record_date)
      default: return dir * (a.submit_date ?? '').localeCompare(b.submit_date ?? '')
    }
  })

  // Summary and pilot stats are computed over the full filtered set (every page
  // combined), not just the page being returned — the browser only ever
  // receives one page of raw rows below, but these aggregates still need to
  // reflect everything so they don't silently shift as more history accumulates.
  const summary = {
    total:         rows.length,
    rankedCount:   rows.filter(r => r.effectiveness === '获取排名').length,
    indexedCount:  rows.filter(r => r.effectiveness === '获取收录').length,
    trackingCount: rows.filter(r => r.effectiveness === '追踪中').length,
    invalidCount:  rows.filter(r => r.effectiveness === '无效').length,
  }

  function pilotAvgScore(group: typeof rows) {
    const valid = group.filter(r => !r.env_excluded)
    if (valid.length === 0) return null
    const total = valid.reduce((s, r) => s + computeOutcomeScore(r.rank_position, r.is_indexed, r.rank_change), 0)
    return Math.round(total / valid.length)
  }
  const ctrlRows = rows.filter(r => r.experiment_group === 'control')
  const trtRows  = rows.filter(r => r.experiment_group === 'treatment')
  const ctrlScore = pilotAvgScore(ctrlRows)
  const trtScore  = pilotAvgScore(trtRows)
  const pilotStats = (ctrlRows.length === 0 && trtRows.length === 0) ? null : {
    ctrlCount: ctrlRows.length, trtCount: trtRows.length,
    ctrlScore, trtScore,
    diff: (ctrlScore != null && trtScore != null) ? trtScore - ctrlScore : null,
  }

  const totalRows = rows.length
  const pagedRows = rows.slice(page * pageSize, (page + 1) * pageSize)

  // rank_matches is only fetched for the page actually being returned — with
  // full history this table can have far more matches than fit on one page,
  // and the other pages' matches would just be discarded client-side anyway.
  type RankMatch = { keyword: string; rank_position: number | null; prev_rank_position: number | null; volume: number }
  const rankMatchesMap = new Map<string, RankMatch[]>()
  const pagedClaimIds = pagedRows.map(r => r.claim_id)
  for (let i = 0; i < pagedClaimIds.length; i += BATCH) {
    const { data: matchRows } = await service
      .from('site_tracking_rank_matches')
      .select('claim_id, record_date, keyword, rank_position, prev_rank_position, volume')
      .in('claim_id', pagedClaimIds.slice(i, i + BATCH))
      .order('rank_position', { ascending: true, nullsFirst: false })
    for (const m of (matchRows ?? []) as (RankMatch & { claim_id: string; record_date: string })[]) {
      const key = `${m.claim_id}|${m.record_date}`
      if (!rankMatchesMap.has(key)) rankMatchesMap.set(key, [])
      rankMatchesMap.get(key)!.push({ keyword: m.keyword, rank_position: m.rank_position, prev_rank_position: m.prev_rank_position, volume: m.volume })
    }
  }
  const pagedRowsWithMatches = pagedRows.map(r => ({
    ...r,
    rank_matches: rankMatchesMap.get(`${r.claim_id}|${r.record_date}`) ?? [],
  }))

  // rowLimit is sized off an exact pre-count of the same filtered query, so this
  // should only trip if rows were deleted between the count and the fetch (rare
  // race), not as a real cap — real truncation is no longer possible.
  return NextResponse.json({
    rows: pagedRowsWithMatches, summary, pilotStats, totalRows, page, pageSize,
    truncated: (trackRows?.length ?? 0) < (exactCount ?? 0),
  })
}
