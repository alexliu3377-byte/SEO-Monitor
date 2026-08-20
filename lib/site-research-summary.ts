import { computeOutcomeScore } from '@/lib/outcome-score'
import { fetchAllRows } from '@/lib/supabase-paginate'

export interface EffectivenessRow {
  keyword: string
  stat_date: string
  url: string | null
  rank_position: number | null
  prev_rank: number | null
  volume: number
  score: number | null
  searchVolumeRising: { volume: number; prev_volume: number; volume_change: number } | null
}

export interface SiteResearchSummary {
  weightTrend: { record_date: string; pc_weight: number; mobile_weight: number; pc_ip: number; pc_ip_max: number; mobile_ip: number; mobile_ip_max: number }[]
  indexTrend: { snapshot_date: string; index_count: number }[]
  rankChangeTrend: { date: string; rankup: number; rankdown: number }[]
  newKeywordsTrend: { date: string; app: number; game: number }[]
  effectivenessRows: EffectivenessRow[]
}

export interface SiteTrendStats {
  weightTrend: { record_date: string; pc_weight: number; mobile_weight: number; pc_ip: number; pc_ip_max: number; mobile_ip: number; mobile_ip_max: number }[]
  indexTrend: { snapshot_date: string; index_count: number }[]
}

// 月/季/年报"逐层汇总"架构（2026-08-20 起）用——这两张源表（weight_history/
// index_snapshots）按站点每天一行，体量小，不是 rank_changes/raw_keywords/
// site_keyword_ranks 那种会被以后收紧保留期影响的大表，永久保留，可以放心
// 为整年直接查询。只抽出 fetchSiteResearchSummary 里权重/收录这部分查询，
// 供月/季/年报 Stage1 算 pc_weight/mobile_weight/avg_index_count/avg_mobile_ip
// 这4个结构化数字用——月/季/年报不再调 fetchSiteResearchSummary 本体，因为
// 那个函数还会读 rank_changes/site_keyword_ranks/raw_keywords，这三张表以后
// 收紧保留期会让年报的整年查询被静默截断。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchSiteTrendStats(service: any, siteId: string, dateStart: string, dateEnd: string): Promise<SiteTrendStats> {
  const [{ data: weightRows }, { data: indexRows }] = await Promise.all([
    service.from('weight_history').select('record_date, pc_weight, mobile_weight, pc_ip, pc_ip_max, mobile_ip, mobile_ip_max')
      .eq('site_id', siteId).gte('record_date', dateStart).lte('record_date', dateEnd).order('record_date'),
    service.from('index_snapshots').select('snapshot_date, index_count')
      .eq('site_id', siteId).gte('snapshot_date', dateStart).lte('snapshot_date', dateEnd).order('snapshot_date'),
  ])
  return { weightTrend: weightRows ?? [], indexTrend: indexRows ?? [] }
}

// 单站点研究任务详情页（app/api/rules/research-tasks/[id]/route.ts）和多站点研究
// 报告（app/api/rules/multi-site-reports/[id]/analyze/route.ts）共用同一套
// "拉这个站点这段时间已经抓到的数据、按天汇总、算排名成效分"逻辑，抽成这个
// 函数避免两处重复维护。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchSiteResearchSummary(service: any, siteId: string, dateStart: string, dateEnd: string): Promise<SiteResearchSummary> {
  // rank_changes / site_keyword_ranks 时间跨度一长（月报/年报）单站点能有几万行，
  // fetchAllRows 不给 countHint 时是一页页顺序拉、拉完一页才发下一页请求——
  // 2026-08-07 跑真实月报时两个站点直接因为这个查询 "canceling statement due to
  // statement timeout"。这两张表已有 site_id 索引，先查一次精确行数（count:exact,
  // head:true 不返回数据只要总数，很快），有了 countHint 就会走 fetchAllRows 已经
  // 写好的并发批量分页（CONCURRENCY=15），跟 environment/daily-snapshot 路由拉
  // raw_keywords 用的是同一条路径。
  // raw_keywords 同理——月/年报时间跨度长的站点能有一两万行，之前用不分页的
  // 单次 select() 会被 Supabase/PostgREST 硬顶在3000行静默截断（不报错，见
  // project_supabase_row_limit_hard_cap 这条项目教训），newKeywordsTrend
  // 会悄悄漏掉后面的日期，比查询直接超时更隐蔽。改用 fetchAllRows 分页。
  const [rankChangeCountRes, rankRowsCountRes, rawKwCountRes] = await Promise.all([
    service.from('rank_changes').select('id', { count: 'exact', head: true })
      .eq('site_id', siteId).gte('stat_date', dateStart).lte('stat_date', dateEnd),
    service.from('site_keyword_ranks').select('id', { count: 'exact', head: true })
      .eq('site_id', siteId).eq('platform', 'mobile').gte('stat_date', dateStart).lte('stat_date', dateEnd),
    service.from('raw_keywords').select('id', { count: 'exact', head: true })
      .eq('site_id', siteId).gte('content_date', dateStart).lte('content_date', dateEnd),
  ])

  const [
    { data: weightRows },
    { data: indexRows },
    rankChangeRows,
    rankRows,
    rawKwRows,
  ] = await Promise.all([
    service.from('weight_history').select('record_date, pc_weight, mobile_weight, pc_ip, pc_ip_max, mobile_ip, mobile_ip_max')
      .eq('site_id', siteId).gte('record_date', dateStart).lte('record_date', dateEnd).order('record_date'),
    service.from('index_snapshots').select('snapshot_date, index_count')
      .eq('site_id', siteId).gte('snapshot_date', dateStart).lte('snapshot_date', dateEnd).order('snapshot_date'),
    fetchAllRows<{ stat_date: string; keyword: string; type: string; volume: number }>((from, to) =>
      service.from('rank_changes').select('stat_date, keyword, type, volume')
        .eq('site_id', siteId).gte('stat_date', dateStart).lte('stat_date', dateEnd)
        .order('stat_date', { ascending: true }).order('id', { ascending: true }).range(from, to),
      { countHint: rankChangeCountRes.count ?? 0 }),
    fetchAllRows<{ keyword: string; stat_date: string; rank_position: number | null; prev_rank: number | null; volume: number; url: string | null }>((from, to) =>
      service.from('site_keyword_ranks').select('keyword, stat_date, rank_position, prev_rank, volume, url')
        .eq('site_id', siteId).eq('platform', 'mobile').gte('stat_date', dateStart).lte('stat_date', dateEnd)
        .order('stat_date', { ascending: false }).order('id', { ascending: true }).range(from, to),
      { countHint: rankRowsCountRes.count ?? 0 }),
    fetchAllRows<{ content_date: string | null; content_type: string }>((from, to) =>
      service.from('raw_keywords').select('content_date, content_type')
        .eq('site_id', siteId).gte('content_date', dateStart).lte('content_date', dateEnd)
        .order('content_date', { ascending: true }).order('keyword', { ascending: true }).range(from, to),
      { countHint: rawKwCountRes.count ?? 0 }),
  ])

  const rankChangeByDate = new Map<string, { date: string; rankup: number; rankdown: number }>()
  for (const r of rankChangeRows) {
    if (!rankChangeByDate.has(r.stat_date)) rankChangeByDate.set(r.stat_date, { date: r.stat_date, rankup: 0, rankdown: 0 })
    const d = rankChangeByDate.get(r.stat_date)!
    if (r.type === 'rankup') d.rankup++
    else if (r.type === 'rankdown') d.rankdown++
  }

  const newKeywordsByDate = new Map<string, { date: string; app: number; game: number }>()
  for (const r of rawKwRows) {
    if (!r.content_date) continue
    if (!newKeywordsByDate.has(r.content_date)) newKeywordsByDate.set(r.content_date, { date: r.content_date, app: 0, game: 0 })
    const d = newKeywordsByDate.get(r.content_date)!
    if (r.content_type === 'game') d.game++
    else d.app++
  }

  const seenKw = new Set<string>()
  const latestRankRows = rankRows.filter(r => {
    if (seenKw.has(r.keyword)) return false
    seenKw.add(r.keyword)
    return true
  })

  const rankedKeywords = latestRankRows.filter(r => r.rank_position != null).map(r => r.keyword)
  const volumeTrendMap = new Map<string, { volume: number; prev_volume: number; volume_change: number }>()
  for (let i = 0; i < rankedKeywords.length; i += 150) {
    const { data: kv } = await service.from('keyword_volume')
      .select('keyword, volume, prev_volume, volume_change')
      .in('keyword', rankedKeywords.slice(i, i + 150))
    for (const k of (kv ?? []) as { keyword: string; volume: number; prev_volume: number; volume_change: number }[]) {
      volumeTrendMap.set(k.keyword, k)
    }
  }

  const effectivenessRows: EffectivenessRow[] = latestRankRows.map(r => {
    const rankChange = (r.rank_position != null && r.prev_rank != null) ? r.prev_rank - r.rank_position : null
    const volTrend = volumeTrendMap.get(r.keyword) ?? null
    return {
      keyword: r.keyword,
      stat_date: r.stat_date,
      url: r.url,
      rank_position: r.rank_position,
      prev_rank: r.prev_rank,
      volume: r.volume,
      score: r.rank_position != null ? computeOutcomeScore(r.rank_position, true, rankChange, r.volume) : null,
      searchVolumeRising: volTrend != null && volTrend.volume_change > 0 ? volTrend : null,
    }
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

  return {
    weightTrend: weightRows ?? [],
    indexTrend: indexRows ?? [],
    rankChangeTrend: Array.from(rankChangeByDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    newKeywordsTrend: Array.from(newKeywordsByDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    effectivenessRows,
  }
}
