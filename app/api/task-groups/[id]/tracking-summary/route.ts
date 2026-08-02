import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

function currentMonth() {
  return getMY().slice(0, 7)
}

// [start, end] inclusive, both YYYY-MM-DD, for the given YYYY-MM month.
function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

// Keywords ranked beyond 50 aren't tracked in a bucket (dropped from the
// breakdown entirely, per user request) — they still count toward
// ranked.total via effectiveness, just not toward any bucket/bySource here.
const RANK_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '1-10',   min: 1,  max: 10 },
  { label: '11-20',  min: 11, max: 20 },
  { label: '21-30',  min: 21, max: 30 },
  { label: '31-40',  min: 31, max: 40 },
  { label: '41-50',  min: 41, max: 50 },
]

interface MemberSummary {
  userId: string
  username: string
  submitted: { total: number; bySource: { source: string; count: number }[] }
  indexed: { count: number; volume: number }
  ranked: {
    total: number
    buckets: { label: string; count: number; volume: number }[]
    bySource: { source: string; count: number }[]
  }
}

function emptySummary(userId: string, username: string): MemberSummary {
  return {
    userId, username,
    submitted: { total: 0, bySource: [] },
    indexed: { count: 0, volume: 0 },
    ranked: { total: 0, buckets: RANK_BUCKETS.map(b => ({ label: b.label, count: 0, volume: 0 })), bySource: [] },
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)
  const month = /^\d{4}-\d{2}$/.test(searchParams.get('month') || '') ? searchParams.get('month')! : currentMonth()
  const { start, end } = monthRange(month)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role: string = profile?.role ?? 'normal'
  const canSeeAll = role === 'super' || role === 'admin'

  const { data: membersRaw } = await service
    .from('task_group_members').select('user_id, username').eq('group_id', groupId)
  const memberList = (membersRaw || []) as { user_id: string; username: string | null }[]
  const usernameOf = new Map<string, string>(memberList.map(m => [m.user_id, m.username || m.user_id.slice(0, 8)]))

  if (!canSeeAll && !memberList.some(m => m.user_id === user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Same truncation-safe pattern as the outcomes route: exact-count the
  // filtered query first, then size the fetch limit off that count.
  let countQuery = service
    .from('site_tracking_records').select('id', { count: 'exact', head: true })
    .eq('group_id', groupId).gte('submit_date', start).lte('submit_date', end)
  if (!canSeeAll) countQuery = countQuery.eq('user_id', user.id)
  const { count: exactCount } = await countQuery

  let rowQuery = service
    .from('site_tracking_records')
    .select('claim_id, user_id, submit_date, record_date, search_volume, rank_position, rank_volume, effectiveness')
    .eq('group_id', groupId).gte('submit_date', start).lte('submit_date', end)
    .order('record_date', { ascending: false })
    .limit(Math.max(exactCount ?? 0, 1))
  if (!canSeeAll) rowQuery = rowQuery.eq('user_id', user.id)
  const { data: rawRows, error } = await rowQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = { claim_id: string; user_id: string; submit_date: string; record_date: string; search_volume: number; rank_position: number | null; rank_volume: number; effectiveness: string }

  // One claim can have many rows (one per tracking day) — keep only the
  // latest (rows already sorted record_date DESC), same as the outcomes route.
  const seen = new Set<string>()
  const rows = ((rawRows || []) as Row[]).filter(r => {
    if (seen.has(r.claim_id)) return false
    seen.add(r.claim_id)
    return true
  })

  const claimIds = rows.map(r => r.claim_id)
  const claimSourceMap = new Map<string, string | null>()
  const BATCH = 200
  for (let i = 0; i < claimIds.length; i += BATCH) {
    const { data: claimMeta } = await service
      .from('member_claimed_keywords').select('id, source').in('id', claimIds.slice(i, i + BATCH))
    for (const c of (claimMeta ?? []) as { id: string; source: string | null }[]) {
      claimSourceMap.set(c.id, c.source)
    }
  }

  // Individual matched rank keywords (a claim can rank for several keywords
  // at once, e.g. the same page ranking for both "DNF多玩盒子" and "DNF") —
  // bucket every matched keyword, not just one "best pick" per claim, so the
  // per-bucket counts/volumes reflect actual ranked keywords.
  const rankedClaimIds = rows.filter(r => r.effectiveness === '获取排名').map(r => r.claim_id)
  const matchesByClaim = new Map<string, { rank_position: number | null; volume: number }[]>()
  for (let i = 0; i < rankedClaimIds.length; i += BATCH) {
    const { data: matchRows } = await service
      .from('site_tracking_rank_matches')
      .select('claim_id, record_date, rank_position, volume')
      .in('claim_id', rankedClaimIds.slice(i, i + BATCH))
    for (const m of (matchRows ?? []) as { claim_id: string; record_date: string; rank_position: number | null; volume: number }[]) {
      if (!matchesByClaim.has(m.claim_id)) matchesByClaim.set(m.claim_id, [])
      matchesByClaim.get(m.claim_id)!.push({ rank_position: m.rank_position, volume: m.volume })
    }
  }

  const summaries = new Map<string, MemberSummary>()
  function getSummary(userId: string): MemberSummary {
    let s = summaries.get(userId)
    if (!s) { s = emptySummary(userId, usernameOf.get(userId) ?? userId.slice(0, 8)); summaries.set(userId, s) }
    return s
  }

  for (const r of rows) {
    const s = getSummary(r.user_id)
    s.submitted.total++
    const src = claimSourceMap.get(r.claim_id) ?? '未知'
    const bySrc = s.submitted.bySource.find(b => b.source === src)
    if (bySrc) bySrc.count++
    else s.submitted.bySource.push({ source: src, count: 1 })

    if (r.effectiveness === '获取收录') {
      s.indexed.count++
      s.indexed.volume += r.search_volume || 0
    } else if (r.effectiveness === '获取排名') {
      s.ranked.total++
      // Falls back to the row's own scalar rank_position/rank_volume when this
      // claim has no rows in site_tracking_rank_matches (rows predating that
      // table, added 2026-07-29).
      const matches = matchesByClaim.get(r.claim_id)
      const effMatches = matches && matches.length > 0 ? matches : [{ rank_position: r.rank_position, volume: r.rank_volume || 0 }]
      for (const m of effMatches) {
        if (m.rank_position == null) continue
        const bucket = RANK_BUCKETS.find(b => m.rank_position! >= b.min && m.rank_position! <= b.max)
        if (!bucket) continue
        const target = s.ranked.buckets.find(b => b.label === bucket.label)!
        target.count++
        target.volume += m.volume || 0
        const bySrc = s.ranked.bySource.find(b => b.source === src)
        if (bySrc) bySrc.count++
        else s.ranked.bySource.push({ source: src, count: 1 })
      }
    }
  }

  for (const s of Array.from(summaries.values())) {
    s.submitted.bySource.sort((a, b) => b.count - a.count)
    s.ranked.bySource.sort((a, b) => b.count - a.count)
  }

  const own = summaries.get(user.id) ?? emptySummary(user.id, usernameOf.get(user.id) ?? user.id.slice(0, 8))
  // Super/admin accounts often aren't members of the group at all (they view
  // as overseers, not as claiming members) — the UI uses this to decide
  // whether an "own" view even makes sense to offer them.
  const isMember = memberList.some(m => m.user_id === user.id)

  if (!canSeeAll) {
    return NextResponse.json({ month, canSeeAll: false, own, isMember, truncated: (rawRows?.length ?? 0) < (exactCount ?? 0) })
  }

  const members = memberList
    .map(m => summaries.get(m.user_id) ?? emptySummary(m.user_id, m.username || m.user_id.slice(0, 8)))
    .sort((a, b) => b.submitted.total - a.submitted.total)

  const groupTotal = emptySummary(groupId, '全组汇总')
  for (const s of Array.from(summaries.values())) {
    groupTotal.submitted.total += s.submitted.total
    for (const b of s.submitted.bySource) {
      const existing = groupTotal.submitted.bySource.find(x => x.source === b.source)
      if (existing) existing.count += b.count
      else groupTotal.submitted.bySource.push({ source: b.source, count: b.count })
    }
    groupTotal.indexed.count += s.indexed.count
    groupTotal.indexed.volume += s.indexed.volume
    groupTotal.ranked.total += s.ranked.total
    s.ranked.buckets.forEach((b, i) => {
      groupTotal.ranked.buckets[i].count += b.count
      groupTotal.ranked.buckets[i].volume += b.volume
    })
    for (const b of s.ranked.bySource) {
      const existing = groupTotal.ranked.bySource.find(x => x.source === b.source)
      if (existing) existing.count += b.count
      else groupTotal.ranked.bySource.push({ source: b.source, count: b.count })
    }
  }
  groupTotal.submitted.bySource.sort((a, b) => b.count - a.count)
  groupTotal.ranked.bySource.sort((a, b) => b.count - a.count)

  return NextResponse.json({
    month, canSeeAll: true, own, members, groupTotal, isMember,
    truncated: (rawRows?.length ?? 0) < (exactCount ?? 0),
  })
}
