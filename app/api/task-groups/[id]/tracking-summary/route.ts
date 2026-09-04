import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { resolveUserDisplayNames } from '@/lib/user-display-name'
import { loadGroupTrackingPayload, type EnrichedTrackRow, type RankMatchWithFlag } from '@/lib/group-tracking-cache'
import {
  currentMonth, monthRange, computeSourceEffectiveness, effectiveMatchesForClaim, RANK_BUCKETS,
  type RankMatch, type SourceEffectivenessEntry,
} from '@/lib/tracking-summary'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'

export const maxDuration = 60

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
  rows: EnrichedTrackRow[],
  matchesByClaim: Map<string, RankMatch[]>,
  userId: string,
  username: string
): MemberSummary {
  let submittedTotal = 0
  let indexedCount = 0, indexedVolume = 0
  const indexedBySource = new Map<string, number>()
  let rankedTotal = 0
  const buckets = RANK_BUCKETS.map(b => ({ label: b.label, count: 0, volume: 0, bySource: new Map<string, number>() }))
  // 得分口径要跟成效追踪表格里逐条的"得分"列完全一致——2026-08-18 起两边
  // 都直接读缓存里已经算好的精确分（带"真新排名"历史查询的那版本），不再
  // 用简化版 computeRowScore 现场估算，两个页面数字终于对得上。
  let scoreTotal = 0

  for (const r of rows) {
    submittedTotal++
    const src = r.source ?? '未知'
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
    if (!r.env_excluded) scoreTotal += r.score
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
  const authClient = await createClient()
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
  const role = (profile?.role ?? 'normal') as UserRole
  const canSeeAll = role === 'super' || role === 'admin'

  const { data: membersRaw } = await service
    .from('task_group_members').select('user_id, username').eq('group_id', groupId)
  const memberList = (membersRaw || []) as { user_id: string; username: string | null }[]
  const isMember = memberList.some(m => m.user_id === user.id)

  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (canSeeAll && searchParams.get('refresh') === '1') {
    const { error: refreshError } = await service
      .from('group_tracking_cache')
      .delete()
      .eq('group_id', groupId)
    if (refreshError) {
      return NextResponse.json({ error: 'Failed to refresh tracking data' }, { status: 500 })
    }
  }

  // Non-admins can only ever view their own scope, regardless of what the
  // request asks for.
  let scope = canSeeAll ? requestedScope : 'own'
  let scopeUserId = ''
  if (scope === 'member') {
    if (!memberList.some(m => m.user_id === requestedMemberId)) scope = 'total'
    else scopeUserId = requestedMemberId
  }

  // 2026-08-18：这个接口原来的"实时查site_tracking_records当月部分+批量查
  // 认领来源/排名匹配词/环境异常日"那一套很重，改成读跟"成效追踪"共用的
  // group_tracking_cache（GitHub Actions 每天08:05 MYT算好写入，见
  // lib/group-tracking-cache.ts）。缓存本身是这个分组的全量历史（不分月），
  // 这里按 submit_date 落在当月区间筛——submit_date 是claim级别固定值，
  // 缓存已经是"每个claim取最新一行"，按它筛不需要再去重一次。
  const { rows: allRows, computedAt, fromCache } = await loadGroupTrackingPayload(service, groupId)
  const rows = allRows.filter(r => r.submit_date >= start && r.submit_date <= end)
  const usernameOf = await resolveUserDisplayNames(
    service,
    [...memberList.map(m => m.user_id), ...rows.map(r => r.user_id)],
    memberList
  )

  // matchesByClaim/claimSourceMap/badDates 原来是单独查询得到的，现在直接从
  // 缓存行本身派生（每行已经带 source/rank_matches/env_excluded）——
  // effectiveMatchesForClaim 还是复用 lib/tracking-summary.ts 里那个既有函数
  // （没排名匹配记录时回退到单条scalar字段），只是它要的 Map 现在从缓存行
  // 现场拼一份，不用再查 site_tracking_rank_matches 表。
  const matchesByClaim = new Map<string, RankMatch[]>(
    rows.map(r => [`${r.claim_id}|${r.record_date}`, r.rank_matches as RankMatchWithFlag[]])
  )

  const scopeRows = scope === 'own' ? rows.filter(r => r.user_id === user.id)
    : scope === 'total' ? rows
    : rows.filter(r => r.user_id === scopeUserId)

  const scopeUserIdOut = scope === 'own' ? user.id : scope === 'total' ? groupId : scopeUserId
  const scopeUsername = scope === 'own' ? (usernameOf.get(user.id) ?? user.id.slice(0, 8))
    : scope === 'total' ? '全组汇总'
    : (usernameOf.get(scopeUserId) ?? scopeUserId.slice(0, 8))

  const summary = buildSummary(scopeRows, matchesByClaim, scopeUserIdOut, scopeUsername)
  const groupSummary = scope === 'total' ? summary : buildSummary(rows, matchesByClaim, groupId, '全组汇总')
  const groupSourceEffectiveness: SourceEffectivenessEntry[] = computeSourceEffectiveness(rows, new Map(rows.map(r => [r.claim_id, r.source])))
  const scopeSourceEffectiveness: SourceEffectivenessEntry[] = scope === 'total'
    ? groupSourceEffectiveness
    : computeSourceEffectiveness(scopeRows, new Map(scopeRows.map(r => [r.claim_id, r.source])))

  // 全组排名：给每个组员（哪怕这个月一条提交都没有）都算一份汇总，按得分
  // 从高到低排名。排名和姓名对所有组员可见，但具体数字只对本人和管理员
  // 暴露——这个屏蔽在接口层做，不是前端隐藏。
  const rowsByUser = new Map<string, EnrichedTrackRow[]>()
  for (const r of rows) {
    if (!rowsByUser.has(r.user_id)) rowsByUser.set(r.user_id, [])
    rowsByUser.get(r.user_id)!.push(r)
  }
  const fullRanking = memberList
    .map(m => buildSummary(rowsByUser.get(m.user_id) ?? [], matchesByClaim, m.user_id, usernameOf.get(m.user_id)!))
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
    groupSourceEffectiveness, scopeSourceEffectiveness, ranking, computedAt, fromCache,
  })
}
