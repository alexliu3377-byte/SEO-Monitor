import { createHash } from 'node:crypto'
import type { HotRadarPayload } from './hot-radar'

type RadarTimestamps = Partial<Record<keyof HotRadarPayload, string>>
function groupSectionTimes(scoped: boolean, global: RadarTimestamps, computedAt: string) {
  return scoped ? { ...global,newWords: computedAt,rankWords: computedAt,streakWords: computedAt } : global
}

export interface GroupHotRadarFilters {
  rankDomains: string[]
  newDomains: string[]
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\.$/, '')
}

export function normalizedRadarDomains(values: string[] | null | undefined) {
  return [...new Set((values ?? []).map(normalizeDomain).filter(Boolean))].sort()
}

export function groupHotRadarFilterHash(filters: GroupHotRadarFilters) {
  return createHash('sha256').update(JSON.stringify({
    version: 2,
    rank: normalizedRadarDomains(filters.rankDomains),
    new: normalizedRadarDomains(filters.newDomains),
  })).digest('hex')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshAllGroupHotRadarCaches(service: any, payload: HotRadarPayload, sourceComputedAt: string, sourceSectionTimes: RadarTimestamps = {}) {
  const { data: groups, error: groupError } = await service.from('task_groups')
    .select('id, rank_domains, new_domains')
  if (groupError) throw groupError

  const computedByFilter = new Map<string, { payload: HotRadarPayload; wordlib: unknown[] }>()
  const { data: wordlibCache, error: wordlibError } = await service.from('wordlib_cache').select('payload').eq('id', 'latest').maybeSingle()
  if (wordlibError) throw wordlibError
  if (!Array.isArray(wordlibCache?.payload)) throw new Error('Word library cache is not ready')
  const rows = []
  for (const group of (groups ?? []) as { id: string; rank_domains: string[] | null; new_domains: string[] | null }[]) {
      const filters = {
        rankDomains: normalizedRadarDomains(group.rank_domains),
        newDomains: normalizedRadarDomains(group.new_domains),
      }
      const hash = groupHotRadarFilterHash(filters)
      let computed = computedByFilter.get(hash)
      if (!computed) {
        computed = await computeGroupRadar(service, filters, payload, wordlibCache.payload)
        computedByFilter.set(hash, computed)
      }
      rows.push({
        group_id: group.id,
        payload: computed.payload,
        wordlib_payload: computed.wordlib,
        filter_hash: hash,
        source_computed_at: sourceComputedAt,
        computed_at: new Date().toISOString(),
        section_updated_at: groupSectionTimes(Boolean(filters.rankDomains.length || filters.newDomains.length),sourceSectionTimes,sourceComputedAt),
      })
  }

  if (rows.length === 0) return 0
  // Keep requests bounded: repeating a large payload for every group in one
  // write can exceed gateway limits. A failed row leaves its old cache intact.
  for (const row of rows) {
    const { error } = await service.from('group_hot_radar_cache').upsert(row, { onConflict: 'group_id' })
    if (error) throw new Error(`Group cache write failed: ${String(error.message ?? error).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,240)}`)
  }
  return rows.length
}

// Each filtered result is computed from raw/shared site summaries, never from
// a truncated global top list. Empty filters can reuse the global result.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeGroupRadar(service: any, filters: GroupHotRadarFilters, global: HotRadarPayload, globalWordlib: unknown[]) {
  let scoped = global
  if (filters.rankDomains.length || filters.newDomains.length) {
    const { data, error } = await service.rpc('compute_scoped_hot_radar', {
      p_rank_domains: filters.rankDomains,
      p_new_domains: filters.newDomains,
      p_limit: 2000,
    })
    if (error) throw error
    if (!data || !Array.isArray(data.newWords) || !Array.isArray(data.rankWords) || !Array.isArray(data.streakWords)) {
      throw new Error('Invalid scoped radar result')
    }
    scoped = { ...data, volumeRisingWords: global.volumeRisingWords }
  }
  let wordlib = globalWordlib
  if (filters.newDomains.length) {
    const { data, error } = await service.rpc('compute_scoped_wordlib', { p_new_domains: filters.newDomains })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Invalid scoped word library result')
    wordlib = data
  }
  return { payload: scoped, wordlib }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshGroupHotRadarCache(service: any, groupId: string) {
  const [{ data: group, error: groupError }, { data: globalCache, error: globalError }, { data: wordlibCache, error: wordlibError }] = await Promise.all([
    service.from('task_groups').select('id, rank_domains, new_domains').eq('id', groupId).maybeSingle(),
    service.from('hot_radar_cache').select('payload, computed_at, section_updated_at').eq('id', 'latest').maybeSingle(),
    service.from('wordlib_cache').select('payload').eq('id', 'latest').maybeSingle(),
  ])
  if (groupError) throw groupError
  if (!group) throw new Error('Task group not found')
  if (globalError) throw globalError
  if (wordlibError) throw wordlibError
  if (!globalCache?.payload) return null
  if (!Array.isArray(wordlibCache?.payload)) throw new Error('Word library cache is not ready')

  const filters = {
    rankDomains: normalizedRadarDomains(group.rank_domains),
    newDomains: normalizedRadarDomains(group.new_domains),
  }
  const computedAt = new Date().toISOString()
  const computed = await computeGroupRadar(service, filters, globalCache.payload as HotRadarPayload, wordlibCache.payload)
  const row = {
    group_id: groupId,
    payload: computed.payload,
    wordlib_payload: computed.wordlib,
    filter_hash: groupHotRadarFilterHash(filters),
    source_computed_at: globalCache.computed_at,
    computed_at: computedAt,
    section_updated_at: groupSectionTimes(Boolean(filters.rankDomains.length || filters.newDomains.length),globalCache.section_updated_at ?? {},computedAt),
  }
  const { error } = await service.from('group_hot_radar_cache').upsert(row, { onConflict: 'group_id' })
  if (error) throw error
  return row
}
