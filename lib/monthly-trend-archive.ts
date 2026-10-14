export type MonthlyTrendArchiveState = 'archived' | 'rebuildable' | 'expired' | 'future'

// The owner opted out of the incomplete July 2026 overview. This is a display
// boundary only: existing archives and the direct drilldown remain untouched.
export const MONTHLY_TREND_OVERVIEW_START = '2026-08'

export function includeMonthlyTrendOverviewMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= MONTHLY_TREND_OVERVIEW_START
}

// Crawl detail is pruned before today - 40 days (Malaysia calendar dates).
// A whole month can only be recomputed when its first day is still retained.
// Having a few later rows does not prove that the whole month is available.
export function monthlyTrendArchiveState(
  month: string,
  malaysiaToday: string,
  hasFinalCache = false,
): MonthlyTrendArchiveState {
  const currentMonth = malaysiaToday.slice(0, 7)
  if (month > currentMonth) return 'future'
  if (month < currentMonth && hasFinalCache) return 'archived'
  const cutoff = new Date(`${malaysiaToday}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - 40)
  return `${month}-01` >= cutoff.toISOString().slice(0, 10) ? 'rebuildable' : 'expired'
}
