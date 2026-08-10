import { computeOutcomeScore } from '@/lib/outcome-score'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { fetchOwnSiteDomains } from '@/lib/tracking-summary'

export interface CompetitorEffectivenessClaim {
  site_id: string
  domain: string
  keyword: string
  content_type: string
  rank_position: number | null
  volume: number
  score: number
}

export interface CompetitorEffectivenessSummary {
  effective: number
  tracking: number
  invalid: number
  topClaims: CompetitorEffectivenessClaim[]
  // 2026-08-10：跟自己站点那边的 contentBreakdown 对应，但这边不用走
  // classifyContentCategory 猜——competitor_tracking_records.content_type
  // 抓取时就已经是 game/app 了（复制自 raw_keywords），只有两类，直接数
  // effectiveness='有效'（真正拿到效果）的条数。
  contentBreakdown: { 游戏: number; 应用: number }
}

// 研究报告（scripts/research-report.ts）"竞品成效"部分的数据源——读
// competitor_tracking_records（每天由 scripts/crawl.ts 的 runTracking() 自动
// 写入，has_rank_title=true 的站点才会被追踪）。这张表的 effectiveness 只有
// 三种值：有效/追踪中/无效（不是自己站点那套"获取排名/获取收录/追踪中/无效"
// 四分类，见 fetchGroupEffectivenessSummary）。
// has_rank_title 不区分"自己的站点"和竞品——自己站点如果也开了排名追踪
// （比如手机之家的 sjwyx.com），数据一样会写进这张表，必须排除掉，不然自己
// 的站点会被当成竞品统计进"竞品成效"。排除依据复用 task_groups.site_domains
// （分组任务页面已有的"自己站点"字段），2026-08-07 用户反馈加入。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchCompetitorEffectivenessSummary(service: any, dateStart: string, dateEnd: string): Promise<CompetitorEffectivenessSummary> {
  const [allRows, ownDomains] = await Promise.all([
    fetchAllRows<{
      site_id: string; keyword: string; content_type: string | null
      rank_position: number | null; rank_volume: number; effectiveness: string
    }>((from, to) =>
      service.from('competitor_tracking_records')
        .select('site_id, keyword, content_type, rank_position, rank_volume, effectiveness')
        .gte('discovery_date', dateStart).lte('discovery_date', dateEnd)
        .order('id', { ascending: true })
        .range(from, to)),
    fetchOwnSiteDomains(service),
  ])

  const siteIds = Array.from(new Set(allRows.map(r => r.site_id)))
  const siteDomainMap = new Map<string, string>()
  if (siteIds.length > 0) {
    const { data: sites } = await service.from('sites').select('id, domain').in('id', siteIds)
    for (const s of (sites ?? []) as { id: string; domain: string }[]) siteDomainMap.set(s.id, s.domain)
  }

  const rows = allRows.filter(r => !ownDomains.has(siteDomainMap.get(r.site_id) ?? ''))

  const effective = rows.filter(r => r.effectiveness === '有效').length
  const tracking = rows.filter(r => r.effectiveness === '追踪中').length
  const invalid = rows.filter(r => r.effectiveness === '无效').length

  const contentBreakdown = { 游戏: 0, 应用: 0 }
  for (const r of rows) {
    if (r.effectiveness !== '有效') continue
    if (r.content_type === 'game') contentBreakdown.游戏++
    else contentBreakdown.应用++
  }

  const topClaims = rows
    .filter(r => r.rank_position != null)
    .map(r => ({
      site_id: r.site_id,
      domain: siteDomainMap.get(r.site_id) ?? r.site_id.slice(0, 8),
      keyword: r.keyword,
      content_type: r.content_type ?? 'app',
      rank_position: r.rank_position,
      volume: r.rank_volume || 0,
      score: computeOutcomeScore(r.rank_position, true, null, r.rank_volume),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  return { effective, tracking, invalid, topClaims, contentBreakdown }
}
