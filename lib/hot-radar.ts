import { fetchAllRows } from './supabase-paginate'
import { normalizeVolumeRiseDate } from './keyword-volume-date'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

export interface HotRadarPayload {
  newWords: { keyword: string; count: number; siteCount: number; sites: string[]; last_date: string; first_date: string }[]
  rankWords: { keyword: string; siteCount: number; volume: number; sites: string[]; last_date: string; first_date: string; rankDays: number }[]
  streakWords: { keyword: string; streak: number; domain: string; volume: number; first_date: string; last_date: string }[]
  volumeRisingWords: { keyword: string; volume: number; prevVolume: number | null; change: number; baselineVolume: number; baselineDate: string; netChange: number; last_date: string; riseDate?: string | null; volumeDate?: string | null; sites: string[]; rankTrend: 'up' | 'down' | 'both' | null }[]
}

export interface HotRadarComputeResult {
  payload: HotRadarPayload
  failedSections: (keyof HotRadarPayload)[]
}

export const HOT_RADAR_SECTIONS = ['newWords', 'rankWords', 'streakWords', 'volumeRisingWords'] as const

export function hotRadarSections(value: string | null): readonly (keyof HotRadarPayload)[] {
  if (!value) return HOT_RADAR_SECTIONS
  const requested = new Set(value.split(','))
  const valid = HOT_RADAR_SECTIONS.filter(section => requested.has(section))
  return valid.length ? valid : HOT_RADAR_SECTIONS
}

export function selectHotRadarSections(payload: HotRadarPayload, sections: readonly (keyof HotRadarPayload)[]) {
  return Object.fromEntries(sections.map(section => [section, section === 'volumeRisingWords'
    ? (payload[section] ?? []).map(normalizeVolumeRiseDate) : payload[section] ?? []]))
}

// Aggregate within the requested site scope before selecting the ranked list.
// A JSON result avoids the PostgREST 3000-row cap on the previous three RPCs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeHotRadarPayload(db: any): Promise<HotRadarComputeResult> {
  const payload: HotRadarPayload = { newWords: [], rankWords: [], streakWords: [], volumeRisingWords: [] }
  const failedSections: (keyof HotRadarPayload)[] = []
  const [scoped, volumes] = await Promise.all([
    db.rpc('compute_scoped_hot_radar', { p_since: getMY(-30), p_limit: 2000 }),
    db.from('keyword_volume')
      .select('keyword, volume, prev_volume, volume_change, baseline_volume, baseline_date, net_volume_change, stat_date, last_volume_increase_date')
      .gt('net_volume_change', 0).gte('stat_date', getMY(-14))
      .order('net_volume_change', { ascending: false }).order('keyword')
      .limit(500),
  ])
  if (scoped.error || !scoped.data || !Array.isArray(scoped.data.newWords) || !Array.isArray(scoped.data.rankWords) || !Array.isArray(scoped.data.streakWords)) {
    failedSections.push('newWords', 'rankWords', 'streakWords')
    console.error('Hot radar aggregation failed', scoped.error?.message ?? 'Invalid response')
  } else {
    payload.newWords = scoped.data.newWords
    payload.rankWords = scoped.data.rankWords
    payload.streakWords = scoped.data.streakWords
  }

  if (volumes.error) {
    failedSections.push('volumeRisingWords')
    console.error('Hot radar volume lookup failed', volumes.error.message)
  } else {
    try {
      const keywords: string[] = (volumes.data ?? []).map((row: { keyword: string }) => row.keyword)
      const trendByKeyword = new Map<string, { sites: Set<string>; latest: string; up: boolean; down: boolean }>()
      if (keywords.length) {
        const { data: sites, error } = await db.from('sites').select('id, domain')
        if (error) throw error
        const domains = new Map<string, string>((sites ?? []).map((row: { id: string; domain: string }) => [row.id, row.domain]))
        for (let index = 0; index < keywords.length; index += 100) {
          const rows = await fetchAllRows<{ keyword: string; site_id: string; type: string; last_seen: string }>((from, to) => db.from('keyword_signal_rollup')
            .select('keyword,site_id,type,last_seen')
            .in('keyword', keywords.slice(index, index + 100)).gte('last_seen', getMY(-14))
            .order('keyword').order('site_id').order('type').range(from, to))
          for (const row of rows) {
            const domain = domains.get(row.site_id)
            if (!domain) continue
            const entry = trendByKeyword.get(row.keyword) ?? { sites: new Set<string>(), latest: '', up: false, down: false }
            entry.sites.add(domain)
            if (row.last_seen > entry.latest) {
              entry.latest = row.last_seen
              entry.up = row.type === 'rankup'
              entry.down = row.type === 'rankdown'
            } else if (row.last_seen === entry.latest) {
              entry.up ||= row.type === 'rankup'
              entry.down ||= row.type === 'rankdown'
            }
            trendByKeyword.set(row.keyword, entry)
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload.volumeRisingWords = (volumes.data ?? []).map((row: any) => {
        const trend = trendByKeyword.get(row.keyword)
        return {
          keyword: row.keyword, volume: Number(row.volume),
          prevVolume: row.prev_volume == null ? null : Number(row.prev_volume),
          change: Number(row.volume_change), baselineVolume: Number(row.baseline_volume),
          baselineDate: String(row.baseline_date ?? '').slice(0,10), netChange: Number(row.net_volume_change),
          riseDate: row.last_volume_increase_date ?? null,
          volumeDate: row.stat_date == null ? null : String(row.stat_date).slice(0,10),
          last_date: row.last_volume_increase_date ?? '', sites: trend ? [...trend.sites].sort() : [],
          rankTrend: trend ? trend.up && trend.down ? 'both' : trend.up ? 'up' : trend.down ? 'down' : null : null,
        }
      })
    } catch (error) {
      failedSections.push('volumeRisingWords')
      console.error('Hot radar signal lookup failed', error)
    }
  }
  return { payload, failedSections }
}
