export type KwStatus = 'normal' | 'warning' | 'high'

interface KwStatRow {
  stat_date: string | null
  app_count: number
  game_count: number
}

function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr).getDay()
  return dow === 0 || dow === 6
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0
  const sorted = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * 按工作日/周末分组计算基准值。
 * 昨天是工作日 → 只跟30天内的工作日基准比；周末 → 只跟周末基准比。
 * 消除星期效应，避免周末低量被误判为异常。
 * 竞品日收与首页快报共用此逻辑，只改这里两边同步生效。
 * 调用方需拉取30天数据。
 *
 * 用中位数不用平均值——2026-08-08 真实数据验证过：不少站点周末几乎总是0，
 * 偶尔一次例外（比如某个周末临时发了25条），平均值会被这一次例外拉高到
 * 6~8，之后每个真正正常的0都会被"0 / 6"这种比例算成"暴跌"标红，天天挂着
 * 异常，跟站点实际情况完全不符。中位数只反映"大多数周末啥样"，一次例外
 * 不会带偏基准（同样的坑之前在 environment_daily 的日环比计算上出过，见
 * project_environment_segments 那次教训）。
 */
function getBaseline(siteStats: KwStatRow[], yesterday: string): number {
  const yIsWeekend = isWeekend(yesterday)
  const vals: number[] = []
  for (const s of siteStats) {
    const d = (s.stat_date ?? '').slice(0, 10)
    if (!d || d === yesterday) continue
    if (isWeekend(d) === yIsWeekend) {
      vals.push((s.app_count ?? 0) + (s.game_count ?? 0))
    }
  }
  return median(vals)
}

export function computeKwBaseline(siteStats: KwStatRow[], yesterday: string): number {
  return Math.round(getBaseline(siteStats, yesterday))
}

// 基准值本身很小时（个位数），随便一天的正常波动用比例算都会显得像暴涨暴跌
// ——比如基准2，今天0，比例0跌了100%，但绝对量本来就没几个，参考
// lib/index-status.ts 的 computeIndexStatus 对"数据不够/水位太低"直接判定
// normal、不硬套比例的思路，这里加一个最低基准门槛，基准不到这个量就不用
// 比例判断，避免小基数站点/天天被噪音标红。
const MIN_BASELINE_FOR_ALERT = 5

// 2026-08-17：'danger'（跌破30%基准，标"异常"）单独拎出来意义不大——用户
// 反馈只想看"偏高/偏低"两档，不需要"偏低"里再细分出一档更严重的"异常"。
// 合并成一档：跌破60%基准统一算 warning（偏低）。
export function computeKwStatus(siteStats: KwStatRow[], yesterday: string): KwStatus {
  const ytStat = siteStats.find(s => (s.stat_date ?? '').slice(0, 10) === yesterday)
  const yesterdayVal = (ytStat?.app_count ?? 0) + (ytStat?.game_count ?? 0)
  const baseline = getBaseline(siteStats, yesterday)
  if (baseline >= MIN_BASELINE_FOR_ALERT) {
    const ratio = yesterdayVal / baseline
    if (ratio < 0.6) return 'warning'
    if (ratio > 1.5) return 'high'
  }
  return 'normal'
}
