// Shared helpers for the "追踪汇总" (tracking summary) feature — used by both
// app/api/task-groups/[id]/tracking-summary/route.ts (aggregates) and
// .../tracking-summary/detail/route.ts (drill-down keyword lists), so the
// dedup/source-lookup/rank-match-lookup/scoring logic stays in exactly one
// place instead of drifting between the two routes.

import { computeOutcomeScore } from '@/lib/outcome-score'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { classifyContentCategory, type ContentCategory } from '@/lib/content-category'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

export function currentMonth() {
  return getMY().slice(0, 7)
}

// [start, end] inclusive, both YYYY-MM-DD, for the given YYYY-MM month.
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

// Keywords ranked beyond 50 aren't tracked in a bucket (dropped from the
// breakdown entirely, per user request) — they still count toward a claim's
// "获取排名" status, just not toward any bucket/source breakdown here.
export const RANK_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '1-10',  min: 1,  max: 10 },
  { label: '11-20', min: 11, max: 20 },
  { label: '21-30', min: 21, max: 30 },
  { label: '31-40', min: 31, max: 40 },
  { label: '41-50', min: 41, max: 50 },
]

export interface TrackRow {
  claim_id: string
  user_id: string
  submit_date: string
  record_date: string
  search_volume: number
  rank_position: number | null
  prev_rank_position: number | null
  rank_volume: number
  is_indexed: boolean
  effectiveness: string
  // Only needed by the detail (drill-down) route's fallback path for claims
  // predating site_tracking_rank_matches — optional so the aggregate route's
  // narrower select() doesn't need to carry it.
  rank_keyword?: string | null
}

// One claim can have many rows (one per tracking day) — keep only the latest.
// Rows must already be sorted record_date DESC (the DB query does this).
export function dedupeByClaim<T extends TrackRow>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (seen.has(r.claim_id)) return false
    seen.add(r.claim_id)
    return true
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchClaimSourceMap(service: any, claimIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  const BATCH = 200
  for (let i = 0; i < claimIds.length; i += BATCH) {
    const { data } = await service
      .from('member_claimed_keywords').select('id, source').in('id', claimIds.slice(i, i + BATCH))
    for (const c of (data ?? []) as { id: string; source: string | null }[]) map.set(c.id, c.source)
  }
  return map
}

export interface RankMatch { keyword: string; rank_position: number | null; volume: number }

// site_tracking_rank_matches keeps one row per (claim_id, record_date,
// keyword) — a claim tracked across N days has N rows per matched keyword,
// not one. Keying by claim_id alone (as an earlier version of this file did)
// silently multiplies every matched keyword by however many days it's been
// tracked. Keying by `claim_id|record_date` and looking a row up by its own
// (already-deduped-to-latest) record_date, exactly like
// app/api/task-groups/[id]/outcomes/route.ts does, is the fix.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchRankMatches(service: any, claimIds: string[]): Promise<Map<string, RankMatch[]>> {
  const map = new Map<string, RankMatch[]>()
  const BATCH = 200
  for (let i = 0; i < claimIds.length; i += BATCH) {
    const { data } = await service
      .from('site_tracking_rank_matches')
      .select('claim_id, record_date, keyword, rank_position, volume')
      .in('claim_id', claimIds.slice(i, i + BATCH))
    for (const m of (data ?? []) as { claim_id: string; record_date: string; keyword: string; rank_position: number | null; volume: number }[]) {
      const key = `${m.claim_id}|${m.record_date}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ keyword: m.keyword, rank_position: m.rank_position, volume: m.volume })
    }
  }
  return map
}

// A claim's matched rank keywords for its own (latest) record_date, falling
// back to its own scalar rank_position/rank_volume when it predates
// site_tracking_rank_matches (added 2026-07-29) or otherwise has no rows there.
export function effectiveMatchesForClaim(row: TrackRow, matchesByClaim: Map<string, RankMatch[]>): RankMatch[] {
  const matches = matchesByClaim.get(`${row.claim_id}|${row.record_date}`)
  if (matches && matches.length > 0) return matches
  return [{ keyword: row.rank_keyword ?? '', rank_position: row.rank_position, volume: row.rank_volume || 0 }]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchBadDates(service: any): Promise<Set<string>> {
  const since90 = getMY(-90)
  const { data: envDays } = await service
    .from('environment_daily').select('date, crawl_anomaly, avg_index_change_pct').gte('date', since90)
  const badDates = new Set<string>()
  for (const e of (envDays ?? []) as { date: string; crawl_anomaly: boolean; avg_index_change_pct: number | null }[]) {
    if (e.crawl_anomaly || (e.avg_index_change_pct !== null && e.avg_index_change_pct < -5)) badDates.add(e.date)
  }
  return badDates
}

export interface SourceEffectivenessEntry {
  source: string
  total: number
  ranked: number
  indexed: number
}

// ranked = 有 rank_position（等价于 effectiveness='获取排名'，因为写入时
// rank_position 存在就优先归类为"获取排名"，见 scripts/crawl.ts 的分类逻辑），
// indexed = effectiveness 恰好是"获取收录"（不含已经排名、因而也已收录的——
// 那些算进 ranked，不重复计进 indexed，避免"已收录"卡片的数字比"获取排名"
// 卡片还大导致误解）。有效率 = (indexed + ranked*2) / total，排名词权重是收录词的
// 2 倍（一个词能排上名，说明它一定也被收录了，理应比"只收录"更值钱）——这个加权
// 只用于本页"追踪汇总"，跟 app/api/rules/source-stats/route.ts（规则中心用的独立
// 实现，未加权）不共享代码，故意允许两边口径不同步。
export function computeSourceEffectiveness(
  rows: TrackRow[],
  claimSourceMap: Map<string, string | null>
): SourceEffectivenessEntry[] {
  interface Acc { total: number; ranked: number; indexed: number }
  const map = new Map<string, Acc>()
  for (const r of rows) {
    const source = claimSourceMap.get(r.claim_id) ?? '未知'
    let s = map.get(source)
    if (!s) { s = { total: 0, ranked: 0, indexed: 0 }; map.set(source, s) }
    s.total++
    if (r.rank_position != null) s.ranked++
    if (r.effectiveness === '获取收录') s.indexed++
  }
  return Array.from(map.entries())
    .map(([source, s]) => ({ source, total: s.total, ranked: s.ranked, indexed: s.indexed }))
    .sort((a, b) => b.total - a.total)
}

export interface GroupEffectivenessClaim {
  keyword: string
  url: string | null
  rank_position: number | null
  volume: number
  score: number
}

export interface GroupEffectivenessSummary {
  ranked: number
  indexed: number
  tracking: number
  invalid: number
  topClaims: GroupEffectivenessClaim[]
  // 2026-08-10：只数"获取排名"（真正拿到效果）的claim按内容类型分布，回答
  // "这个月的收益主要是什么类型内容带来的"（用户明确要求）。
  contentBreakdown: Record<ContentCategory, number>
}

// 研究中心报告（scripts/research-report.ts）"自己站点成效"用——2026-08-07
// 从竞品成效里拆出来单独一段，不再混在一起。只有2个组、数据量小，不值得
// 像单站点分析那样单独占一次 Gemini 调用（Stage 1），原始数据直接留到 Stage 2
// 跟大环境/竞品成效一起喂给最终综合。逻辑复用 app/api/task-groups/[id]/outcomes/
// route.ts 同一套 dedupe/scoring，只是不分页返回、不按成员筛选，只要一份汇总数字
// + 得分最高的几条给 AI 参考。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchGroupEffectivenessSummary(service: any, groupId: string, dateStart: string, dateEnd: string): Promise<GroupEffectivenessSummary> {
  const rows = await fetchAllRows<TrackRow & { keyword: string; page_url: string | null }>((from, to) =>
    service.from('site_tracking_records')
      .select('claim_id, user_id, keyword, page_url, submit_date, record_date, search_volume, rank_position, prev_rank_position, rank_volume, is_indexed, effectiveness')
      .eq('group_id', groupId)
      .gte('record_date', dateStart).lte('record_date', dateEnd)
      .order('record_date', { ascending: false }).order('id', { ascending: true })
      .range(from, to))

  const deduped = dedupeByClaim(rows)

  const ranked = deduped.filter(r => r.effectiveness === '获取排名').length
  const indexed = deduped.filter(r => r.effectiveness === '获取收录').length
  const tracking = deduped.filter(r => r.effectiveness === '追踪中').length
  const invalid = deduped.filter(r => r.effectiveness === '无效').length

  const contentBreakdown: Record<ContentCategory, number> = { 游戏: 0, 应用: 0, 专题: 0, 资讯: 0 }
  for (const r of deduped) {
    if (r.effectiveness !== '获取排名') continue
    contentBreakdown[classifyContentCategory(r.page_url, r.keyword)]++
  }

  const topClaims = deduped
    .map(r => {
      const rankChange = (r.rank_position != null && r.prev_rank_position != null) ? r.prev_rank_position - r.rank_position : null
      return {
        keyword: r.keyword, url: r.page_url,
        rank_position: r.rank_position, volume: r.rank_volume || 0,
        score: computeOutcomeScore(r.rank_position, r.is_indexed || r.rank_position != null, rankChange, r.rank_volume),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  return { ranked, indexed, tracking, invalid, topClaims, contentBreakdown }
}

// 研究报告"机会缺口"（scripts/research-report.ts Stage2）用——判断一个竞品
// 赢下的词是不是我方"零覆盖"，要靠这份"我方历史上有没有做过这个词"的全量
// 集合去比对，不能按周期限定（三个月前做过、现在还在排名的词依然算已覆盖，
// 不该因为这期没提交就被误判成缺口）。site_tracking_records 永久保留、持续
// 增长，超3000行会被 PostgREST 静默截断（这个项目已经踩过好几次同一个坑，
// 见 project_supabase_row_limit_hard_cap），必须走 fetchAllRows 分页，不能
// 直接 select()。只要 keyword 一列，量再大也很轻。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchOwnCoveredKeywordSet(service: any): Promise<Set<string>> {
  const { count } = await service.from('site_tracking_records').select('id', { count: 'exact', head: true })
  const rows = await fetchAllRows<{ keyword: string }>((from, to) =>
    service.from('site_tracking_records').select('keyword').order('id', { ascending: true }).range(from, to),
    { countHint: count ?? 0 })
  return new Set(rows.map(r => r.keyword.trim()))
}

// 自己站点的域名集合——曾短暂改成 sites.is_own_site 手动逐站标记（研究中心
// "管理竞品站点"弹窗里选"自家/竞品"），2026-08-10 当天用户又反悔改回来：
// 手动标太麻烦，还是自动识别更好。复用 task_groups.site_domains（分组任务
// 页面的"自己站点"字段，雷达/词库那类页面也在用同一个字段判断"自己站点"）。
// 研究中心"竞品成效"tab 和竞品成效汇总都要排除这些域名，不能把自己的站点当竞品追踪。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchOwnSiteDomains(service: any): Promise<Set<string>> {
  const { data } = await service.from('task_groups').select('site_domains')
  const domains = new Set<string>()
  for (const g of (data ?? []) as { site_domains: string[] | null }[]) {
    for (const d of g.site_domains ?? []) domains.add(d)
  }
  return domains
}

