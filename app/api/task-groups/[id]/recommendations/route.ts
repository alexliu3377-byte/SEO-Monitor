import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import { normalizeDomains } from '@/lib/task-group-data'
import type { UserRole } from '@/lib/user-context'

export const maxDuration = 180

const PAGE_SIZE = 20
const COOLDOWN_UNIT_DAYS = 7

interface SignalRow {
  keyword: string
  stat_date: string
  rank_position: number | null
  prev_rank: number | null
  volume: number | null
  url: string | null
  title: string | null
}

interface ClaimRow {
  id: string
  user_id: string
  keyword: string
  final_keyword: string | null
  page_url: string | null
  operation_type: string | null
  submitted_at: string | null
  claimed_date: string
  created_at: string
}

interface RecommendationRow extends SignalRow {
  volume: number
  memberId: string
  memberName: string
  ownUrl: string | null
  ownCreatedAt: string | null
}

function malaysiaDate(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

function normalizeUrl(raw: string | null) {
  return (raw ?? '').trim().replace(/^https?:\/\/(www\.|m\.)?/i, '').toLowerCase()
}

function addDays(date: string, days: number) {
  return new Date(new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime() + days * 86400000)
    .toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000)
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = []
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size))
  return result
}

function dedupeSignals(rows: SignalRow[]) {
  const seen = new Set<string>()
  return rows.filter(row => {
    const key = row.keyword.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildHistory(rows: ClaimRow[]) {
  const byUser = new Map<string, {
    keywordMap: Map<string, { lastSubmittedAt: string; updateCount: number }>
    urlSet: Set<string>
  }>()
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, { keywordMap: new Map(), urlSet: new Set() })
    const history = byUser.get(row.user_id)!
    const keyword = (row.final_keyword || row.keyword).trim().toLowerCase()
    const submittedAt = row.submitted_at || row.claimed_date
    const existing = history.keywordMap.get(keyword)
    history.keywordMap.set(keyword, {
      lastSubmittedAt: !existing || submittedAt > existing.lastSubmittedAt ? submittedAt : existing.lastSubmittedAt,
      updateCount: (existing?.updateCount ?? 0) + (row.operation_type === '更新' ? 1 : 0),
    })
    const url = normalizeUrl(row.page_url)
    if (url) history.urlSet.add(url)
  }
  return byUser
}

function cooldownPriority(keyword: string, volume: number, history: ReturnType<typeof buildHistory> extends Map<string, infer T> ? T : never) {
  const info = history.keywordMap.get(keyword.toLowerCase())
  if (!info) return { eligible: true, daysSinceEligible: 0, volume }
  const end = addDays(info.lastSubmittedAt, COOLDOWN_UNIT_DAYS * (info.updateCount + 1))
  const today = malaysiaDate()
  return { eligible: end <= today, daysSinceEligible: end <= today ? daysBetween(end, today) : -1, volume }
}

async function loadSignals(service: any, siteIds: string[], type: 'rankdown' | 'rankup') {
  if (siteIds.length === 0) return []
  return fetchAllRows<SignalRow>((from, to) => service
    .from('keyword_signal_rollup')
    .select('keyword, stat_date:last_seen, rank_position:latest_rank_position, prev_rank:latest_prev_rank, volume:max_volume, url:latest_url, title:latest_title')
    .in('site_id', siteIds)
    .eq('type', type)
    .gte('last_seen', malaysiaDate(-30))
    .order('last_seen', { ascending: false })
    .order('max_volume', { ascending: false })
    .order('site_id', { ascending: true })
    .order('keyword', { ascending: true })
    .range(from, to))
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') === 'rankup' ? 'rankup' : 'rankdown'
  const page = Math.max(0, Number.parseInt(searchParams.get('page') || '0', 10) || 0)
  const requestedUserId = searchParams.get('userId') || user.id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'normal') as UserRole
  const canManage = role === 'super' || role === 'admin'
  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [{ data: group }, { data: memberRows }, { data: sites }, { data: allGroups }] = await Promise.all([
    service.from('task_groups').select('site_domains').eq('id', groupId).maybeSingle(),
    service.from('task_group_members').select('user_id, username').eq('group_id', groupId),
    service.from('sites').select('id, domain'),
    type === 'rankup' ? service.from('task_groups').select('site_domains') : Promise.resolve({ data: [] }),
  ])
  if (!group) return NextResponse.json({ error: 'Task group not found' }, { status: 404 })

  const members = ((memberRows ?? []) as { user_id: string; username: string | null }[])
  const memberMap = new Map(members.map(member => [member.user_id, member.username || '']))
  if (!canManage && !memberMap.has(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManage && requestedUserId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (canManage && requestedUserId !== user.id && !memberMap.has(requestedUserId)) {
    return NextResponse.json({ error: 'Group member not found' }, { status: 404 })
  }

  // Managers keep the existing merged-team view. Members only receive their own recommendations.
  const targetUsers = canManage ? members.map(member => member.user_id) : [requestedUserId]
  if (targetUsers.length === 0) return NextResponse.json({ rows: [], total: 0, page, pageSize: PAGE_SIZE })

  const groupDomains = new Set(normalizeDomains(group.site_domains))
  const allSiteRows = (sites ?? []) as { id: string; domain: string }[]
  const ownSiteIds = allSiteRows.filter(site => groupDomains.has(normalizeDomains([site.domain])[0] ?? '')).map(site => site.id)
  if (ownSiteIds.length === 0) return NextResponse.json({ rows: [], total: 0, page, pageSize: PAGE_SIZE })

  const claims = await fetchAllRows<ClaimRow>((from, to) => service
    .from('member_claimed_keywords')
    .select('id, user_id, keyword, final_keyword, page_url, operation_type, submitted_at, claimed_date, created_at')
    .eq('group_id', groupId)
    .in('user_id', targetUsers)
    .eq('status', 'submitted')
    .order('id', { ascending: true })
    .range(from, to))
  const historyByUser = buildHistory(claims)

  const { data: dismissalRows } = await service.from('member_rec_dismissals')
    .select('user_id, keyword')
    .eq('group_id', groupId)
    .in('user_id', targetUsers)
    .gte('dismissed_at', new Date(Date.now() - 7 * 86400000).toISOString())
  const dismissed = new Set(((dismissalRows ?? []) as { user_id: string; keyword: string }[])
    .map(row => `${row.user_id}\n${row.keyword.toLowerCase()}`))

  let recommendations: (RecommendationRow & { priority: number })[] = []

  if (type === 'rankdown') {
    const signals = dedupeSignals(await loadSignals(service, ownSiteIds, 'rankdown'))
    for (const memberId of targetUsers) {
      const history = historyByUser.get(memberId)
      if (!history) continue
      for (const signal of signals) {
        const keyword = signal.keyword.toLowerCase()
        if (!history.keywordMap.has(keyword) && !history.urlSet.has(normalizeUrl(signal.url))) continue
        if (dismissed.has(`${memberId}\n${keyword}`)) continue
        const priority = cooldownPriority(signal.keyword, Number(signal.volume) || 0, history)
        if (!priority.eligible) continue
        recommendations.push({
          ...signal,
          volume: Number(signal.volume) || 0,
          memberId,
          memberName: memberMap.get(memberId) || '',
          ownUrl: signal.url,
          ownCreatedAt: null,
          priority: priority.daysSinceEligible,
        })
      }
    }

    recommendations.sort((a, b) => a.priority - b.priority || b.volume - a.volume || b.stat_date.localeCompare(a.stat_date))
    const seenUrls = new Set<string>()
    recommendations = recommendations.filter(row => {
      const normalized = normalizeUrl(row.url)
      if (!normalized) return true
      const key = `${row.memberId}\n${normalized}`
      if (seenUrls.has(key)) return false
      seenUrls.add(key)
      return true
    })
  } else {
    const globalOwnDomains = new Set<string>()
    for (const item of (allGroups ?? []) as { site_domains: string[] | null }[]) {
      for (const domain of normalizeDomains(item.site_domains)) globalOwnDomains.add(domain)
    }
    const competitorSiteIds = allSiteRows
      .filter(site => !globalOwnDomains.has(normalizeDomains([site.domain])[0] ?? ''))
      .map(site => site.id)
    const signals = dedupeSignals(await loadSignals(service, competitorSiteIds, 'rankup'))
    const signalKeywords = signals.map(signal => signal.keyword)
    const ownRanked = new Set<string>()
    for (const keywordChunk of chunks(signalKeywords, 100)) {
      const rows = await fetchAllRows<{ id: string; keyword: string }>((from, to) => service
        .from('site_keyword_ranks')
        .select('id, keyword')
        .in('site_id', ownSiteIds)
        .in('keyword', keywordChunk)
        .eq('platform', 'mobile')
        .not('rank_position', 'is', null)
        .order('id', { ascending: true })
        .range(from, to))
      for (const row of rows) ownRanked.add(row.keyword.toLowerCase())
    }

    // Preserve the existing ownership rule: the latest submitted page for a keyword owns the recommendation.
    const latestClaim = new Map<string, ClaimRow>()
    for (const claim of claims) {
      if (!claim.page_url) continue
      const keyword = (claim.final_keyword || claim.keyword).trim().toLowerCase()
      const existing = latestClaim.get(keyword)
      if (!existing || claim.created_at > existing.created_at) latestClaim.set(keyword, claim)
    }
    for (const signal of signals) {
      const keyword = signal.keyword.toLowerCase()
      if (ownRanked.has(keyword)) continue
      const claim = latestClaim.get(keyword)
      if (!claim || !targetUsers.includes(claim.user_id)) continue
      if (dismissed.has(`${claim.user_id}\n${keyword}`)) continue
      const history = historyByUser.get(claim.user_id)
      if (!history) continue
      const priority = cooldownPriority(signal.keyword, Number(signal.volume) || 0, history)
      if (!priority.eligible) continue
      recommendations.push({
        ...signal,
        volume: Number(signal.volume) || 0,
        memberId: claim.user_id,
        memberName: memberMap.get(claim.user_id) || '',
        ownUrl: claim.page_url,
        ownCreatedAt: claim.created_at,
        priority: priority.daysSinceEligible,
      })
    }
    recommendations.sort((a, b) => a.priority - b.priority || b.volume - a.volume || b.stat_date.localeCompare(a.stat_date))
  }

  const total = recommendations.length
  const start = page * PAGE_SIZE
  const rows = recommendations.slice(start, start + PAGE_SIZE).map(({ priority: _priority, ...row }) => row)
  return NextResponse.json(
    { rows, total, page, pageSize: PAGE_SIZE },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  )
}
