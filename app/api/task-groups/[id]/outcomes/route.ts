import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { loadGroupTrackingPayload } from '@/lib/group-tracking-cache'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'

export const maxDuration = 60

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = user.id

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'normal') as UserRole
  const canSeeAll = role === 'super' || role === 'admin'
  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2026-08-26 去掉按日期筛选（先是提交日期、后改记录日期，都被用户反馈
  // "看不全"——回到最简单的状态：默认不按时间分组，全量按得分排序，想找
  // 某天的用排序列自己翻。
  const filterMember        = searchParams.get('memberId') || ''
  const filterOp            = searchParams.get('opType') || ''
  const filterKw            = (searchParams.get('keyword') || '').toLowerCase()
  const filterIndex         = searchParams.get('indexed') || ''         // 'has' | 'none'
  const filterRankKw        = (searchParams.get('rankKeyword') || '').toLowerCase()
  const filterEffectiveness = searchParams.get('outcome') || ''         // '获取排名'|'获取收录'|'追踪中'|'无效'
  const sortBy              = searchParams.get('sortBy') || 'score'
  const sortDir              = searchParams.get('sortDir') || 'desc'
  const page                = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0)
  const pageSize            = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10) || 20))

  // 2026-08-18：这张表原来的"实时查site_tracking_records全量+批量查认领来源/
  // 排名匹配词/更新型真新排名历史+逐行算分"那一整套很重（用户反馈"打开很
  // 慢"），改成读 group_tracking_cache（GitHub Actions 每天08:05 MYT算好写
  // 进去，见 lib/group-tracking-cache.ts + app/api/tracking-cache/refresh）。
  // 缓存没命中（刚上线还没跑过定时任务、或者这个分组是新建的）才现场算一次
  // 并顺手写回，跟 hot_radar_cache 的兜底逻辑一致。
  const { rows: allRows, computedAt, fromCache } = await loadGroupTrackingPayload(service, groupId)

  // 原来 applyTrackFilters 里对 DB 的过滤（user_id/operation_type/submit_date）
  // 现在改成对缓存数组的内存过滤——effectiveness 依然不在这一批里（原因见下
  // 面 post-fetch 过滤那段注释，缓存本身已经是"每个claim取最新一行"，跟原来
  // 的 dedup-after-fetch 顺序一致，不会重新引入那个"筛完比不筛还多"的坑）。
  let rows = allRows
  if (!canSeeAll) rows = rows.filter(r => r.user_id === userId)
  if (filterOp) rows = rows.filter(r => r.operation_type === filterOp)

  // Post-fetch filters (everything except the member filter — member narrowing
  // happens after groupSummary is computed, same as before).
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
  rows = [...rows].sort((a, b) => {
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
  // combined), not just the page being returned.
  const summary = {
    total:         rows.length,
    rankedCount:   rows.filter(r => r.effectiveness === '获取排名').length,
    indexedCount:  rows.filter(r => r.effectiveness === '获取收录').length,
    trackingCount: rows.filter(r => r.effectiveness === '追踪中').length,
    invalidCount:  rows.filter(r => r.effectiveness === '无效').length,
  }

  const totalRows = rows.length
  const pagedRows = rows.slice(page * pageSize, (page + 1) * pageSize)

  return NextResponse.json({
    rows: pagedRows, summary, groupSummary, totalRows, page, pageSize,
    truncated: false, computedAt, fromCache,
  })
}
