import { computeWeightTiers, type WeightTier } from '@/lib/weight-tiers'

export interface TierStats {
  siteCount: number
  pcWeight: number | null
  mobileWeight: number | null
  indexCount: number | null
}

export interface EnvironmentStats {
  asOfDate: string
  overall: TierStats
  tiers: { 大站: TierStats; 中站: TierStats; 小站: TierStats }
  // site_id -> 这个站点当天算出来的档位，调用方（比如站点诊断）要知道"这个
  // 站点自己在哪一档"时不用再单独跑一次 computeWeightTiers。
  siteTiers: Map<string, WeightTier>
}

// 整体 + 大/中/小站 的权重/收录结构化数字——从 periodEnd 往前最多找7天，拿到
// 有 weight_history 数据的那一天做快照（正常情况 periodEnd 当天/前一天就有
// 数据，往前找只是给"这段时间刚好抓取有缺口"兜个底）。
// 2026-08-11 从 scripts/research-report.ts 抽出来共享——站点诊断功能也要用
// 同一套"这个站点在大环境里处于什么位置"的计算，不重复实现第三份。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeEnvironmentStats(service: any, periodEnd: string): Promise<EnvironmentStats | null> {
  let asOfDate = periodEnd
  let weightRows: { site_id: string; pc_weight: number | null; mobile_weight: number | null }[] = []
  for (let i = 0; i < 7; i++) {
    const { data } = await service.from('weight_history')
      .select('site_id, pc_weight, mobile_weight').eq('record_date', asOfDate)
    if (data && data.length > 0) { weightRows = data; break }
    asOfDate = new Date(new Date(asOfDate + 'T00:00:00').getTime() - 86400000).toISOString().slice(0, 10)
  }
  if (weightRows.length === 0) return null

  const { data: indexRows } = await service.from('index_snapshots')
    .select('site_id, index_count').eq('snapshot_date', asOfDate)
  const indexBySite = new Map<string, number>((indexRows ?? []).map((r: { site_id: string; index_count: number }) => [r.site_id, r.index_count]))

  const tiers = computeWeightTiers(weightRows)
  const round1 = (n: number) => Math.round(n * 10) / 10

  function statsFor(siteIds: string[]): TierStats {
    const pcVals: number[] = []; const mVals: number[] = []; const idxVals: number[] = []
    for (const id of siteIds) {
      const w = weightRows.find(r => r.site_id === id)
      if (w?.pc_weight != null) pcVals.push(w.pc_weight)
      if (w?.mobile_weight != null) mVals.push(w.mobile_weight)
      const idx = indexBySite.get(id)
      if (idx != null) idxVals.push(idx)
    }
    const avg = (vals: number[]) => vals.length > 0 ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null
    return {
      siteCount: siteIds.length,
      pcWeight: avg(pcVals), mobileWeight: avg(mVals),
      indexCount: idxVals.length > 0 ? Math.round(idxVals.reduce((a, b) => a + b, 0) / idxVals.length) : null,
    }
  }

  const allSiteIds = weightRows.map(r => r.site_id)
  const tierGroups: Record<string, string[]> = { 大站: [], 中站: [], 小站: [] }
  for (const [siteId, tier] of Array.from(tiers)) tierGroups[tier].push(siteId)

  return {
    asOfDate,
    overall: statsFor(allSiteIds),
    tiers: { 大站: statsFor(tierGroups.大站), 中站: statsFor(tierGroups.中站), 小站: statsFor(tierGroups.小站) },
    siteTiers: tiers,
  }
}
