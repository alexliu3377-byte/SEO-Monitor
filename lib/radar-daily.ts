import { groupHotRadarFilterHash, normalizedRadarDomains } from './group-hot-radar-cache'
import { radarDates, validRadarDate } from './radar-dates'
export { radarDate, radarDates, validRadarDate } from './radar-dates'

export const DAILY_RADAR_TABS = ['cross', 'rank', 'streak', 'newWords', 'volumeRising', 'wordLib'] as const
export type DailyRadarTab = typeof DAILY_RADAR_TABS[number]
export function radarScope(rankDomains: string[] = [], newDomains: string[] = []) {
  const filters = { rankDomains: normalizedRadarDomains(rankDomains), newDomains: normalizedRadarDomains(newDomains) }
  return { ...filters, key: filters.rankDomains.length || filters.newDomains.length ? groupHotRadarFilterHash(filters) : 'global' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshDailyRadarCaches(db: any, options: { days?: number; date?: string; groupId?: string } = {}) {
  const { data: groups, error } = await db.from('task_groups').select('id,rank_domains,new_domains')
  if (error) throw error
  const scopes = new Map([[ 'global', radarScope() ]])
  for (const group of groups ?? []) {
    if (options.groupId && group.id !== options.groupId) continue
    const scope = radarScope(group.rank_domains ?? [], group.new_domains ?? [])
    scopes.set(scope.key, scope)
  }
  const dates = options.date ? [options.date] : radarDates().slice(0, Math.min(8, (options.days ?? 7) + 1)).reverse()
  const results = []
  for (const date of dates) {
    if (!validRadarDate(date)) throw new Error('Daily cache date is outside retention')
    for (const scope of scopes.values()) {
      const { data, error } = await db.rpc('refresh_daily_radar_cache', {
        p_date: date, p_scope: scope.key, p_rank_domains: scope.rankDomains, p_new_domains: scope.newDomains,
      })
      if (error) throw new Error(`Daily radar ${date} ${scope.key.slice(0, 12)}: ${error.message}`)
      results.push(data)
      console.log(JSON.stringify({ dailyRadar: true, date, scope: scope.key, ...data }))
    }
  }
  const cleanup = await db.rpc('prune_daily_radar_cache')
  if (cleanup.error) throw cleanup.error
  return { dates: dates.length, scopes: scopes.size, refreshed: results.length, removed: cleanup.data }
}
