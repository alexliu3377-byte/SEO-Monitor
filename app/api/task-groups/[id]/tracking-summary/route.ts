import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeOutcomeScore } from '@/lib/outcome-score'
import {
  currentMonth, monthRange, dedupeByClaim, fetchClaimSourceMap, fetchRankMatches,
  fetchBadDates, computeSourceEffectiveness, effectiveMatchesForClaim, RANK_BUCKETS,
  type TrackRow, type RankMatch, type SourceEffectivenessEntry,
} from '@/lib/tracking-summary'

interface MemberSummary {
  userId: string
  username: string
  submitted: { total: number }
  indexed: { count: number; volume: number; bySource: { source: string; count: number }[] }
  ranked: {
    total: number
    totalVolume: number
    buckets: { label: string; count: number; volume: number; bySource: { source: string; count: number }[] }[]
  }
  totalScore: number
}

function buildSummary(
  rows: TrackRow[],
  claimSourceMap: Map<string, string | null>,
  matchesByClaim: Map<string, RankMatch[]>,
  badDates: Set<string>,
  userId: string,
  username: string
): MemberSummary {
  let submittedTotal = 0
  let indexedCount = 0, indexedVolume = 0
  const indexedBySource = new Map<string, number>()
  let rankedTotal = 0
  const buckets = RANK_BUCKETS.map(b => ({ label: b.label, count: 0, volume: 0, bySource: new Map<string, number>() }))
  // 得分口径要跟成效追踪表格里逐条的"得分"列完全一致（同一个 computeOutcomeScore,
  // 同样排除环境异常日）——这里是累加总和，不是平均值，用户明确要"得分总数"。
  let scoreTotal = 0

  for (const r of rows) {
    submittedTotal++
    const src = claimSourceMap.get(r.claim_id) ?? '未知'
    if (r.effectiveness === '获取收录') {
      indexedCount++
      indexedVolume += r.search_volume || 0
      indexedBySource.set(src, (indexedBySource.get(src) ?? 0) + 1)
    } else if (r.effectiveness === '获取排名') {
      rankedTotal++
      for (const m of effectiveMatchesForClaim(r, matchesByClaim)) {
        if (m.rank_position == null) continue
        const bucketDef = RANK_BUCKETS.find(b => m.rank_position! >= b.min && m.rank_position! <= b.max)
        if (!bucketDef) continue
        const target = buckets.find(b => b.label === bucketDef.label)!
        target.count++
        target.volume += m.volume || 0
        target.bySource.set(src, (target.bySource.get(src) ?? 0) + 1)
      }
    }
    if (!badDates.has(r.record_date)) {
      const rankChange = (r.rank_position != null && r.prev_rank_position != null)
        ? r.prev_rank_position - r.rank_position : null
      scoreTotal += computeOutcomeScore(r.rank_position, r.is_indexed, rankChange, r.rank_volume)
    }
  }

  const bucketsOut = buckets.map(b => ({
    label: b.label, count: b.count, volume: b.volume,
    bySource: Array.from(b.bySource.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
  }))

  return {
    userId, username,
    submitted: { total: submittedTotal },
    indexed: {
      count: indexedCount, volume: indexedVolume,
      bySource: Array.from(indexedBySource.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    },
    ranked: { total: rankedTotal, totalVolume: bucketsOut.reduce((s, b) => s + b.volume, 0), buckets: bucketsOut },
    totalScore: Math.round(scoreTotal * 10) / 10,
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
  const requestedScope = searchParams.get('scope') || 'own'
  const requestedMemberId = searchParams.get('memberId') || ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role: string = profile?.role ?? 'normal'
  const canSeeAll = role === 'super' || role === 'admin'

  const { data: membersRaw } = await service
    .from('task_group_members').select('user_id, username').eq('group_id', groupId)
  const memberList = (membersRaw || []) as { user_id: string; username: string | null }[]
  const usernameOf = new Map<string, string>(memberList.map(m => [m.user_id, m.username || m.user_id.slice(0, 8)]))
  const isMember = memberList.some(m => m.user_id === user.id)

  if (!canSeeAll && !isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Non-admins can only ever view their own scope, regardless of what the
  // request asks for.
  let scope = canSeeAll ? requestedScope : 'own'
  let scopeUserId = ''
  if (scope === 'member') {
    if (!memberList.some(m => m.user_id === requestedMemberId)) scope = 'total'
    else scopeUserId = requestedMemberId
  }

  // Always fetch the whole group's rows unfiltered — group-wide source
  // effectiveness is shown to everyone regardless of role (it's aggregated
  // by source, not by member, so it doesn't expose individual identities),
  // and reusing this same set avoids a second round-trip for whichever
  // scope ends up selected.
  const { count: exactCount } = await service
    .from('site_tracking_records').select('id', { count: 'exact', head: true })
    .eq('group_id', groupId).gte('submit_date', start).lte('submit_date', end)

  const { data: rawRows, error } = await service
    .from('site_tracking_records')
    .select('claim_id, user_id, submit_date, record_date, search_volume, rank_position, prev_rank_position, rank_volume, is_indexed, effectiveness')
    .eq('group_id', groupId).gte('submit_date', start).lte('submit_date', end)
    .order('record_date', { ascending: false })
    .limit(Math.max(exactCount ?? 0, 1))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = dedupeByClaim((rawRows || []) as TrackRow[])
  const claimIds = rows.map(r => r.claim_id)
  const [claimSourceMap, badDates] = await Promise.all([
    fetchClaimSourceMap(service, claimIds),
    fetchBadDates(service),
  ])
  const rankedClaimIds = rows.filter(r => r.effectiveness === '获取排名').map(r => r.claim_id)
  const matchesByClaim = await fetchRankMatches(service, rankedClaimIds)

  const scopeRows = scope === 'own' ? rows.filter(r => r.user_id === user.id)
    : scope === 'total' ? rows
    : rows.filter(r => r.user_id === scopeUserId)

  const scopeUserIdOut = scope === 'own' ? user.id : scope === 'total' ? groupId : scopeUserId
  const scopeUsername = scope === 'own' ? (usernameOf.get(user.id) ?? user.id.slice(0, 8))
    : scope === 'total' ? '全组汇总'
    : (usernameOf.get(scopeUserId) ?? scopeUserId.slice(0, 8))

  const summary = buildSummary(scopeRows, claimSourceMap, matchesByClaim, badDates, scopeUserIdOut, scopeUsername)
  const groupSummary = scope === 'total' ? summary : buildSummary(rows, claimSourceMap, matchesByClaim, badDates, groupId, '全组汇总')
  const groupSourceEffectiveness: SourceEffectivenessEntry[] = computeSourceEffectiveness(rows, claimSourceMap)
  const scopeSourceEffectiveness: SourceEffectivenessEntry[] = scope === 'total'
    ? groupSourceEffectiveness
    : computeSourceEffectiveness(scopeRows, claimSourceMap)

  // 全组排名（2026-08-04 请求，替换掉原来的4张统计卡片）：给每个组员（哪怕这个月
  // 一条提交都没有）都算一份汇总，按得分从高到低排名。排名和姓名对所有组员可见
  // （2026-08-04 二次调整：一开始做成非管理员只能看自己那一条，用户改成"能看到
  // 其他人的排名，只是不能看到其它人的资料"），但具体数字（提交数/获取排名/
  // 获取收录/得分）只对本人和管理员暴露——这个屏蔽在接口层做，不是前端隐藏，
  // 避免绕过UI直接读接口拿到其他组员的具体数字；全组汇总同理，非管理员的响应
  // 里完全不含 groupSummary。
  const rowsByUser = new Map<string, TrackRow[]>()
  for (const r of rows) {
    if (!rowsByUser.has(r.user_id)) rowsByUser.set(r.user_id, [])
    rowsByUser.get(r.user_id)!.push(r)
  }
  const fullRanking = memberList
    .map(m => buildSummary(rowsByUser.get(m.user_id) ?? [], claimSourceMap, matchesByClaim, badDates, m.user_id, usernameOf.get(m.user_id)!))
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((s, i) => ({ rank: i + 1, summary: s }))
  const ranking = fullRanking.map(({ rank, summary: s }) => {
    const visible = canSeeAll || s.userId === user.id
    return {
      rank, userId: s.userId, username: s.username,
      submitted: visible ? s.submitted.total : null,
      ranked: visible ? s.ranked.total : null,
      indexed: visible ? s.indexed.count : null,
      totalScore: visible ? s.totalScore : null,
    }
  })

  return NextResponse.json({
    month, canSeeAll, isMember, scope: scope === 'member' ? scopeUserId : scope,
    memberList: canSeeAll ? memberList.map(m => ({ userId: m.user_id, username: usernameOf.get(m.user_id)! })) : undefined,
    summary, groupSummary: canSeeAll ? groupSummary : undefined,
    groupSourceEffectiveness, scopeSourceEffectiveness, ranking,
    truncated: (rawRows?.length ?? 0) < (exactCount ?? 0),
  })
}
