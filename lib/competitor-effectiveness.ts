import { computeOutcomeScore } from '@/lib/outcome-score'
import { fetchAllRows } from '@/lib/supabase-paginate'

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
}

// 研究报告（scripts/research-report.ts）"成效"部分的数据源——不是自己团队
// （site_tracking_records/task_groups），是竞品（competitor_tracking_records，
// 每天由 scripts/crawl.ts 的 runTracking() 自动写入，has_rank_title=true 的站点
// 才会被追踪）。这张表的 effectiveness 只有三种值：有效/追踪中/无效（不是自己
// 团队那套"获取排名/获取收录/追踪中/无效"四分类）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchCompetitorEffectivenessSummary(service: any, dateStart: string, dateEnd: string): Promise<CompetitorEffectivenessSummary> {
  const rows = await fetchAllRows<{
    site_id: string; keyword: string; content_type: string | null
    rank_position: number | null; rank_volume: number; effectiveness: string
  }>((from, to) =>
    service.from('competitor_tracking_records')
      .select('site_id, keyword, content_type, rank_position, rank_volume, effectiveness')
      .gte('discovery_date', dateStart).lte('discovery_date', dateEnd)
      .order('id', { ascending: true })
      .range(from, to))

  const effective = rows.filter(r => r.effectiveness === '有效').length
  const tracking = rows.filter(r => r.effectiveness === '追踪中').length
  const invalid = rows.filter(r => r.effectiveness === '无效').length

  const siteIds = Array.from(new Set(rows.map(r => r.site_id)))
  const siteDomainMap = new Map<string, string>()
  if (siteIds.length > 0) {
    const { data: sites } = await service.from('sites').select('id, domain').in('id', siteIds)
    for (const s of (sites ?? []) as { id: string; domain: string }[]) siteDomainMap.set(s.id, s.domain)
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

  return { effective, tracking, invalid, topClaims }
}
