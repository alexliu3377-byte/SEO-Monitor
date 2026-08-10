// 体量分档——从 app/api/environment/daily-snapshot/route.ts 抽出来的共用逻辑
// （原本那边自己按 pc_weight+mobile_weight 33/66百分位分"高/中/低档"，研究报告
// 2026-08-10 也要用同一套百分位算法算"大/中/小站"，标签不同但算法必须一致，
// 抽成一个函数两边共用，不能各自维护一份容易分叉）。
// 不依赖人工维护的 sites.category（早前查证过没人持续更新，见 project 备忘）。

export type WeightTier = '大站' | '中站' | '小站'

export function computeWeightTiers(
  weightRows: { site_id: string; pc_weight: number | null; mobile_weight: number | null }[]
): Map<string, WeightTier> {
  const siteWeight = new Map<string, number>(
    weightRows.map(r => [r.site_id, (r.pc_weight ?? 0) + (r.mobile_weight ?? 0)])
  )
  const weightValues = Array.from(siteWeight.values()).sort((a, b) => a - b)
  const p33 = weightValues[Math.floor(weightValues.length * 0.33)] ?? 0
  const p66 = weightValues[Math.floor(weightValues.length * 0.66)] ?? 0

  const tiers = new Map<string, WeightTier>()
  for (const [siteId, w] of Array.from(siteWeight)) {
    if (w <= p33) tiers.set(siteId, '小站')
    else if (w <= p66) tiers.set(siteId, '中站')
    else tiers.set(siteId, '大站')
  }
  return tiers
}
