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

function valueOn(siteStats: KwStatRow[], date: string): number {
  const row = siteStats.find(s => (s.stat_date ?? '').slice(0, 10) === date)
  return (row?.app_count ?? 0) + (row?.game_count ?? 0)
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + deltaDays)
  return d.toISOString().slice(0, 10)
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
function getBaseline(siteStats: KwStatRow[], day: string): number {
  const yIsWeekend = isWeekend(day)
  const vals: number[] = []
  for (const s of siteStats) {
    const d = (s.stat_date ?? '').slice(0, 10)
    if (!d || d === day) continue
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

// 2026-08-17：用户反馈"新增变动"/"竞品日收"天天弹提醒，一看基本都是正常
// 波动。真实数据验证发现两个根因：
// 1）之前不管什么站点都用统一的"跌破60%/超150%"比例——但不同站点自身的
//    日常波动幅度天差地别（有的站点每天数量稳定得很，波动一点点就该关注；
//    有的站点本来就常年在两个量级之间跳，这是它一直以来的更新习惯）。改成
//    按这个站点自己最近同类日（工作日/周末分开）的历史波动幅度（MAD，中位数
//    绝对偏差）来定"多大偏离才算异常"，而不是全站统一一刀切的比例。
// 2）就算阈值本身没问题，站点一旦从一个水平换到另一个水平并稳定住（比如
//    从每天20条变成每天60条、之后一直维持60条），"昨天"始终会被拿去跟还没
//    跟上变化的30天基准比，导致同一次变化连续好几天被反复报——不是新出现
//    的异常，是同一件事被重复提醒。加一层去重：如果前一天已经是同样的
//    偏高/偏低状态、且今天的数值跟前一天很接近，说明这次变化已经不是"新
//    发生的"，不再重复提醒，只在变化刚出现的第一天提醒一次。
// 用最近14天真实数据模拟过：两条一起上，触发次数从173/620（28%）降到
// 30-40/620左右，且像"某站点连续多天新增归零不恢复"这种真异常依然能抓住
// （第一天照样报，只是后续几天不再重复报同一件事）。
const SPREAD_FLOOR_PCT = 0.2
const SPREAD_MULTIPLIER = 2.5
const DEDUP_CLOSE_PCT = 0.2

// 这个站点自己最近同类日的"正常波动幅度"（MAD，中位数绝对偏差）——历史刚好
// 连续几天数值一模一样时 MAD 会是0，这里给个地板值（基准的20%），避免刚好
// 平稳过几天就变得对任何一点点波动都过敏。
function getSpread(siteStats: KwStatRow[], day: string, baseline: number): number {
  const yIsWeekend = isWeekend(day)
  const vals: number[] = []
  for (const s of siteStats) {
    const d = (s.stat_date ?? '').slice(0, 10)
    if (!d || d === day) continue
    if (isWeekend(d) === yIsWeekend) vals.push((s.app_count ?? 0) + (s.game_count ?? 0))
  }
  const mad = median(vals.map(v => Math.abs(v - baseline)))
  return Math.max(mad, SPREAD_FLOOR_PCT * baseline)
}

function computeKwStatusRaw(siteStats: KwStatRow[], day: string): KwStatus {
  const val = valueOn(siteStats, day)
  const baseline = getBaseline(siteStats, day)
  if (baseline < MIN_BASELINE_FOR_ALERT) return 'normal'
  const spread = getSpread(siteStats, day, baseline)
  if (val < baseline - SPREAD_MULTIPLIER * spread) return 'warning'
  if (val > baseline + SPREAD_MULTIPLIER * spread) return 'high'
  return 'normal'
}

export function computeKwStatus(siteStats: KwStatRow[], day: string): KwStatus {
  const status = computeKwStatusRaw(siteStats, day)
  if (status === 'normal') return 'normal'
  const prevDay = shiftDate(day, -1)
  const prevStatus = computeKwStatusRaw(siteStats, prevDay)
  if (prevStatus === status) {
    const val = valueOn(siteStats, day)
    const prevVal = valueOn(siteStats, prevDay)
    if (Math.abs(val - prevVal) <= DEDUP_CLOSE_PCT * Math.max(prevVal, 1)) return 'normal'
  }
  return status
}
