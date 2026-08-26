import { computeOutcomeScore, explainUpdateEffectScore, fetchFirstRankedDates, bareUrl, type UpdateEffectBreakdown } from '@/lib/outcome-score'
import { fetchAllRows } from '@/lib/supabase-paginate'

export interface RankMatchWithFlag {
  keyword: string
  rank_position: number | null
  prev_rank_position: number | null
  volume: number
  isNewRank: boolean
}

export interface EnrichedTrackRow {
  id: string; claim_id: string; user_id: string
  keyword: string; final_keyword: string | null
  page_url: string | null; operation_type: string | null
  search_volume: number; submit_date: string; record_date: string
  is_indexed: boolean; index_first_seen: string | null; index_disappeared: string | null
  rank_keyword: string | null; rank_position: number | null; prev_rank_position: number | null
  rank_volume: number; rank_date: string | null; effectiveness: string
  username: string
  rank_change: number | null
  env_excluded: boolean
  source: string | null
  bestRankPosition: number | null
  totalRankVolume: number
  score: number
  updateEffectBreakdown: UpdateEffectBreakdown | null
  rank_matches: RankMatchWithFlag[]
}

type RawTrackRow = {
  id: string; claim_id: string; user_id: string
  keyword: string; final_keyword: string | null
  page_url: string | null; operation_type: string | null
  search_volume: number; submit_date: string; record_date: string
  is_indexed: boolean; index_first_seen: string | null; index_disappeared: string | null
  rank_keyword: string | null; rank_position: number | null; prev_rank_position: number | null
  rank_volume: number; rank_date: string | null; effectiveness: string
}

// "成效追踪"/"追踪汇总"背后共用的重活——查一个分组全部claim的最新追踪状态、
// 算分、判断"真新排名"。2026-08-18 之前这段逻辑各自内嵌在两个路由里，每次
// 打开页面都现场查现场算（用户反馈"打开很慢"）；改成定时任务调这个函数算好
// 存进 group_tracking_cache，两个路由改成只读缓存（见
// app/api/tracking-cache/refresh/route.ts）。这个函数本身逻辑照抄改之前的
// app/api/task-groups/[id]/outcomes/route.ts，只是从"按当次请求的筛选条件
// 查询"变成"不带任何筛选、查一个分组的全量历史"——谁来筛选、筛什么，交给
// 调用方（路由）在读出缓存之后自己做内存过滤，缓存本身要对所有请求通用。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeGroupTrackingPayload(service: any, groupId: string): Promise<EnrichedTrackRow[]> {
  const { data: membersRaw } = await service
    .from('task_group_members').select('user_id, username').eq('group_id', groupId)
  const memberMap = new Map<string, string>(
    (membersRaw || []).map((m: { user_id: string; username: string | null }) =>
      [m.user_id, m.username || m.user_id.slice(0, 8)])
  )

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

  // site_tracking_records 永久保留、按claim每天一行持续增长，PostgREST 在这个
  // 项目上单次请求硬顶3000行，必须真分页（fetchAllRows）才能拿全，见
  // project_supabase_row_limit_hard_cap 这类踩过的坑。
  const trackRows = await fetchAllRows<RawTrackRow>((from, to) => service
    .from('site_tracking_records')
    .select('id, claim_id, user_id, keyword, final_keyword, page_url, operation_type, search_volume, submit_date, record_date, is_indexed, index_first_seen, index_disappeared, rank_keyword, rank_position, prev_rank_position, rank_volume, rank_date, effectiveness')
    .eq('group_id', groupId)
    .order('record_date', { ascending: false })
    .order('submit_date', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to))

  // Deduplicate: keep only the latest record per claim (rows already sorted record_date DESC)
  const seen = new Set<string>()
  const dedupedRows = ((trackRows || []) as RawTrackRow[]).filter(r => {
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

  // Fetch every matched rank keyword for the whole group (not just one page) —
  // "排名"/"排名量" sort by the best position and summed volume across ALL of
  // a claim's matched keywords, not the single "best pick" scalar columns.
  //
  // 2026-08-26 修复：一个claim平均能匹配到二三十个排名词（活跃分组实测过
  // 一个claim最多近30条），200个claim一批很容易凑够3000+行，之前这里没有
  // 分页、只是单次 .in() 查询——PostgREST 单次硬顶3000行会静默截断（这个
  // 项目反复踩过的坑，见 lib/supabase-paginate.ts 顶部注释），而且排序是
  // 按 rank_position 全局升序（nulls last），截断时优先保留"批次里排名最好
  // 的那些行"，同一批次里排名不是最靠前、但搜索量很大的claim反而容易被整批
  // 挤掉——表现就是组员反馈"以前得分较高的东西不见了"：不是数据被删，是
  // 这个claim自己的排名词整批没读到，退化成只用 site_tracking_records 那个
  // 单一"最佳位置"标量兜底，totalRankVolume 少算了其它排名词的搜索量，
  // 分数跟着算低了。改成跟 site_tracking_records 一样真分页（fetchAllRows），
  // 加 id 做唯一排序兜底，不会再截断。
  type RankMatch = { keyword: string; rank_position: number | null; prev_rank_position: number | null; volume: number }
  const rankMatchesMap = new Map<string, RankMatch[]>()
  for (let i = 0; i < claimIds.length; i += BATCH) {
    const chunk = claimIds.slice(i, i + BATCH)
    const matchRows = await fetchAllRows<RankMatch & { claim_id: string; record_date: string }>((from, to) => service
      .from('site_tracking_rank_matches')
      .select('claim_id, record_date, keyword, rank_position, prev_rank_position, volume')
      .in('claim_id', chunk)
      .order('rank_position', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to))
    for (const m of matchRows) {
      const key = `${m.claim_id}|${m.record_date}`
      if (!rankMatchesMap.has(key)) rankMatchesMap.set(key, [])
      rankMatchesMap.get(key)!.push({ keyword: m.keyword, rank_position: m.rank_position, prev_rank_position: m.prev_rank_position, volume: m.volume })
    }
  }

  // "更新"型claim的增量评分需要知道一个URL是不是"真新排名"（历史上从没排过
  // 名 vs 这条claim刚开始追踪、还没攒够前一天数据）——只对 prev_rank_position
  // 为null的"更新"行查（有真实prev_rank_position的已经证明不是新的）。
  const urlsNeedingHistory = dedupedRows
    .filter(r => r.operation_type === '更新' && r.prev_rank_position == null && r.page_url)
    .map(r => r.page_url as string)
  const firstRankedDates = await fetchFirstRankedDates(service, urlsNeedingHistory)

  return dedupedRows.map(r => {
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
    // crawl hasn't caught it yet (separate crawl, can lag/miss coverage).
    const isIndexed = r.is_indexed || r.rank_position != null
    const rankChange = (r.rank_position != null && r.prev_rank_position != null)
      ? r.prev_rank_position - r.rank_position
      : null

    // 这一行的URL是不是"真新排名"——只对 prev_rank_position 为null的行有意义。
    const firstRankedDate = r.page_url ? firstRankedDates.get(bareUrl(r.page_url)) : undefined
    const isNewRank = r.prev_rank_position == null && (firstRankedDate == null || firstRankedDate >= r.submit_date)

    let score: number
    let updateEffectBreakdown: UpdateEffectBreakdown | null = null
    if (r.operation_type === '更新') {
      updateEffectBreakdown = explainUpdateEffectScore({
        rankPos: r.rank_position, prevRankPos: r.prev_rank_position, rankVolume: r.rank_volume,
        isIndexed, indexFirstSeen: r.index_first_seen, submitDate: r.submit_date, isNewRank,
      })
      score = updateEffectBreakdown.total
    } else {
      score = computeOutcomeScore(r.rank_position, isIndexed, rankChange, r.rank_volume)
    }

    // 排名列每一个匹配到的排名词，各自判断是不是"真新"（跟行级共用同一个URL
    // 的历史查询结果——同一个URL下的所有匹配词天然共享同一份"这个URL是不是
    // 老URL"的历史)，只有 prev_rank_position 为null的那个匹配才可能是"新"。
    const matchesWithNewFlag = matches.map(m => ({
      ...m,
      isNewRank: r.operation_type === '更新' && m.prev_rank_position == null && isNewRank,
    }))

    return {
      ...r,
      is_indexed: isIndexed,
      username: memberMap.get(r.user_id) ?? r.user_id.slice(0, 8),
      rank_change: rankChange,
      env_excluded: badDates.has(r.record_date),
      source: claimSourceMap.get(r.claim_id) ?? null,
      bestRankPosition, totalRankVolume,
      score, updateEffectBreakdown,
      rank_matches: matchesWithNewFlag,
    }
  })
}
