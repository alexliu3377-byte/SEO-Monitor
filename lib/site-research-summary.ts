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

// 单站点研究任务详情页（app/api/rules/research-tasks/[id]/route.ts）和多站点研究
// 报告（app/api/rules/multi-site-reports/[id]/analyze/route.ts）共用同一套
// "拉这个站点这段时间已经抓到的数据、按天汇总、算排名成效分"逻辑，抽成这个
// 函数避免两处重复维护。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchSiteResearchSummary(service: any, siteId: string, dateStart: string, dateEnd: string): Promise<SiteResearchSummary> {
  const [
    { data: weightRows },
    { data: indexRows },
    rankChangeRows,
    rankRows,
    { data: rawKwRows },
  ] = await Promise.all([
    service.from('weight_history').select('record_date, pc_weight, mobile_weight, pc_ip, pc_ip_max, mobile_ip, mobile_ip_max')
      .eq('site_id', siteId).gte('record_date', dateStart).lte('record_date', dateEnd).order('record_date'),
    service.from('index_snapshots').select('snapshot_date, index_count')
      .eq('site_id', siteId).gte('snapshot_date', dateStart).lte('snapshot_date', dateEnd).order('snapshot_date'),
    fetchAllRows<{ stat_date: string; keyword: string; type: string; volume: number }>((from, to) =>
      service.from('rank_changes').select('stat_date, keyword, type, volume')
        .eq('site_id', siteId).gte('stat_date', dateStart).lte('stat_date', dateEnd)
        .order('id', { ascending: true }).range(from, to)),
    fetchAllRows<{ keyword: string; stat_date: string; rank_position: number | null; prev_rank: number | null; volume: number; url: string | null }>((from, to) =>
      service.from('site_keyword_ranks').select('keyword, stat_date, rank_position, prev_rank, volume, url')
        .eq('site_id', siteId).eq('platform', 'mobile').gte('stat_date', dateStart).lte('stat_date', dateEnd)
        .order('stat_date', { ascending: false }).order('id', { ascending: true }).range(from, to)),
    service.from('raw_keywords').select('content_date, content_type')
      .eq('site_id', siteId).gte('content_date', dateStart).lte('content_date', dateEnd),
  ])

  const rankChangeByDate = new Map<string, { date: string; rankup: number; rankdown: number }>()
  for (const r of rankChangeRows) {
    if (!rankChangeByDate.has(r.stat_date)) rankChangeByDate.set(r.stat_date, { date: r.stat_date, rankup: 0, rankdown: 0 })
    const d = rankChangeByDate.get(r.stat_date)!
    if (r.type === 'rankup') d.rankup++
    else if (r.type === 'rankdown') d.rankdown++
  }

  const newKeywordsByDate = new Map<string, { date: string; app: number; game: number }>()
  for (const r of (rawKwRows ?? []) as { content_date: string | null; content_type: string }[]) {
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
