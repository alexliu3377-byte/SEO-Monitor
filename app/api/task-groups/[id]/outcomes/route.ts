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
  //
  // effectiveness is intentionally NOT included here — unlike user_id/
  // operation_type/submit_date (fixed per claim), effectiveness is a per-day
  // snapshot that can change over a claim's tracking history. Pushing it into
  // the DB query would filter the raw multi-day rows BEFORE dedup, so dedup
  // would then pick each claim's latest row matching that effectiveness
  // (its last-ever-ranked day, say) instead of its true latest status —
  // silently inflating the filtered count above the unfiltered baseline
  // (found via user report: filtering to 获取排名 showed 76 vs 56 unfiltered).
  // It's applied as a post-fetch filter on the deduped rows instead, same as
  // filterIndex/filterKw/filterRankKw below.
  //
  // filterMember is ALSO deliberately left out (only for canSeeAll — normal
  // users still get the unconditional .eq('user_id', userId) below, they can
  // never see other members' rows at all). Fetching the whole group's rows
  // regardless of the member filter lets us compute a "group total" alongside
  // the member-scoped one (2026-08-04 request: cards show "该组员 / 全组" so
  // admin/super can compare a selected member against the group at a glance)
  // without a second round-trip — the member filter is applied in-memory
  // after groupSummary is computed, further down.
  function applyTrackFilters<T extends { eq: any; gte: any; lte: any }>(q: T): T {
    let query = q
    if (!canSeeAll) query = query.eq('user_id', userId)
    if (filterOp) query = query.eq('operation_type', filterOp)
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

  // Fetch source for deduped claim_ids (batched to avoid URL length limits —
  // UUIDs are fixed-width so 200/batch is safe here, unlike the CJK-keyword
  // case elsewhere in this codebase).
  const claimIds = dedupedRows.map(r => r.claim_id)
  const claimSourceMap = new Map<string, string | null>()
  const BATCH = 200
  for (let i = 0; i < claimIds.length; i += BATCH) {
    const { data: claimMeta } = await service
      .from('member_claimed_keywords')
      .select('id, source')
      .in('id', claimIds.slice(i, i + BATCH))
    for (const c of (claimMeta ?? []) as { id: string; source: string | null }[]) {
      claimSourceMap.set(c.id, c.source)
    }
  }

  // Fetch every matched rank keyword for the full filtered set (not just the
  // page being returned) — "排名"/"排名量" now sort by the best position and
  // summed volume across ALL of a claim's matched keywords, not the single
  // "best pick" scalar columns, so we need the whole picture before sorting.
  // The same map is reused below to attach matches to the paginated response,
  // so this isn't a second query on top of the per-page one.
  type RankMatch = { keyword: string; rank_position: number | null; prev_rank_position: number | null; volume: number }
  const rankMatchesMap = new Map<string, RankMatch[]>()
  for (let i = 0; i < claimIds.length; i += BATCH) {
    const { data: matchRows } = await service
      .from('site_tracking_rank_matches')
      .select('claim_id, record_date, keyword, rank_position, prev_rank_position, volume')
      .in('claim_id', claimIds.slice(i, i + BATCH))
      .order('rank_position', { ascending: true, nullsFirst: false })
    for (const m of (matchRows ?? []) as (RankMatch & { claim_id: string; record_date: string })[]) {
      const key = `${m.claim_id}|${m.record_date}`
      if (!rankMatchesMap.has(key)) rankMatchesMap.set(key, [])
      rankMatchesMap.get(key)!.push({ keyword: m.keyword, rank_position: m.rank_position, prev_rank_position: m.prev_rank_position, volume: m.volume })
    }
  }

  let rows = dedupedRows.map(r => {
    const matches = rankMatchesMap.get(`${r.claim_id}|${r.record_date}`) ?? []
    const matchedPositions = matches.map(m => m.rank_position).filter((p): p is number => p != null)
    // Best (lowest = highest-ranking) position across every matched keyword,
    // falling back to the single scalar rank_position for rows predating this
    // table. No rank at all sorts as worst regardless of direction.
    const bestRankPosition = matchedPositions.length > 0 ? Math.min(...matchedPositions) : r.rank_position
    // Sum of volume across every matched keyword, not just the one "best pick".
    const totalRankVolume = matches.length > 0 ? matches.reduce((s, m) => s + (m.volume || 0), 0) : (r.rank_volume ?? 0)
    // A page can't rank in search without being indexed — if site_keyword_ranks
    // found a rank_position, it's indexed even when our own site_indexed_pages
    // crawl hasn't caught it yet (separate crawl, can lag/miss coverage). Only
    // overridden here at read time (2026-07-29), not at write time, so this
    // self-heals for historical rows too without a backfill.
    const isIndexed = r.is_indexed || r.rank_position != null
    const rankChange = (r.rank_position != null && r.prev_rank_position != null)
      ? r.prev_rank_position - r.rank_position
      : null
    return {
      ...r,
      is_indexed: isIndexed,
      username: memberMap.get(r.user_id) ?? r.user_id.slice(0, 8),
      rank_change: rankChange,
      env_excluded: badDates.has(r.record_date),
      source: claimSourceMap.get(r.claim_id) ?? null,
      bestRankPosition, totalRankVolume,
      // Same inputs the frontend's per-row "得分" cell uses (raw scalar
      // rank_position/rank_volume, not bestRankPosition/totalRankVolume) —
      // sorting has to match what's actually displayed.
      score: computeOutcomeScore(r.rank_position, isIndexed, rankChange, r.rank_volume),
    }
  })

  // Post-fetch filters (everything except the member filter — see the comment
  // on applyTrackFilters above for why member narrowing happens after this).
  if (filterEffectiveness)   rows = rows.filter(r => r.effectiveness === filterEffectiveness)
  if (filterKw)              rows = rows.filter(r => r.keyword.toLowerCase().includes(filterKw) || (r.final_keyword ?? '').toLowerCase().includes(filterKw))
  if (filterIndex === 'has') rows = rows.filter(r => r.is_indexed)
  if (filterIndex === 'none')rows = rows.filter(r => !r.is_indexed)
  if (filterRankKw)          rows = rows.filter(r => (r.rank_keyword ?? '').toLowerCase().includes(filterRankKw))

  // Group-wide aggregate under the same non-member filters — always computed,
  // only meaningfully different from `summary` below when canSeeAll picked a
  // specific member (for normal users this set is already their own rows only).
  const groupSummary = {
    total:         rows.length,
    rankedCount:   rows.filter(r => r.effectiveness === '获取排名').length,
    indexedCount:  rows.filter(r => r.effectiveness === '获取收录').length,
    trackingCount: rows.filter(r => r.effectiveness === '追踪中').length,
    invalidCount:  rows.filter(r => r.effectiveness === '无效').length,
  }

  if (filterMember && canSeeAll) rows = rows.filter(r => r.user_id === filterMember)

  // Sort
  const dir = sortDir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    switch (sortBy) {
      case 'search_volume': return dir * ((a.search_volume ?? 0) - (b.search_volume ?? 0))
      case 'rank_position': {
        // No rank (null) always sorts last, in either direction — it's worse
        // than any real position, not just "low" or "high".
        const ra = a.bestRankPosition; const rb = b.bestRankPosition
        if (ra == null && rb == null) return 0
        if (ra == null) return 1
        if (rb == null) return -1
        return dir * (ra - rb)
      }
      case 'rank_volume': return dir * (a.totalRankVolume - b.totalRankVolume)
      case 'score': return dir * (a.score - b.score)
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

  const totalRows = rows.length
  const pagedRows = rows.slice(page * pageSize, (page + 1) * pageSize)

  // rankMatchesMap was already fetched for the full filtered set above (needed
  // for sorting) — reuse it here instead of querying again.
  const pagedRowsWithMatches = pagedRows.map(r => ({
    ...r,
    rank_matches: rankMatchesMap.get(`${r.claim_id}|${r.record_date}`) ?? [],
  }))

  // rowLimit is sized off an exact pre-count of the same filtered query, so this
  // should only trip if rows were deleted between the count and the fetch (rare
  // race), not as a real cap — real truncation is no longer possible.
  return NextResponse.json({
    rows: pagedRowsWithMatches, summary, groupSummary, totalRows, page, pageSize,
    truncated: (trackRows?.length ?? 0) < (exactCount ?? 0),
  })
}
