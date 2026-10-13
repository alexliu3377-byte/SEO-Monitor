import { createHash } from 'node:crypto'
import type { HotRadarPayload } from './hot-radar'

export interface GroupHotRadarFilters {
  rankDomains: string[]
  newDomains: string[]
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\.$/, '')
}

function normalizedDomains(values: string[] | null | undefined) {
  return [...new Set((values ?? []).map(normalizeDomain).filter(Boolean))].sort()
}

export function groupHotRadarFilterHash(filters: GroupHotRadarFilters) {
  return createHash('sha256').update(JSON.stringify({
    rank: normalizedDomains(filters.rankDomains),
    new: normalizedDomains(filters.newDomains),
  })).digest('hex')
}

function selectedSites(sites: string[], allowed: Set<string>) {
  if (allowed.size === 0) return sites
  return sites.filter(site => allowed.has(normalizeDomain(site)))
}

/**
 * Builds the compact payload used by one task group from the shared daily
 * radar result. Raw crawl data remains global; only the ready-to-render result
 * is duplicated per group.
 */
export function buildGroupHotRadarPayload(
  payload: HotRadarPayload,
  filters: GroupHotRadarFilters,
): HotRadarPayload {
  const rankDomains = new Set(normalizedDomains(filters.rankDomains))
  const newDomains = new Set(normalizedDomains(filters.newDomains))

  const newWords = payload.newWords.flatMap(word => {
    const sites = selectedSites(word.sites, newDomains)
    if (newDomains.size > 0 && sites.length === 0) return []
    return [{ ...word, sites, siteCount: sites.length }]
  })

  const rankWords = payload.rankWords.flatMap(word => {
    const sites = selectedSites(word.sites, rankDomains)
    if (rankDomains.size > 0 && sites.length === 0) return []
    return [{ ...word, sites, siteCount: sites.length }]
  })

  const streakWords = payload.streakWords.filter(word =>
    rankDomains.size === 0 || rankDomains.has(normalizeDomain(word.domain)),
  )

  // Search-volume growth is a keyword-level signal and has no authoritative
  // site owner. Keep it shared between groups, matching the existing product
  // rule in the task workspace.
  return {
    newWords,
    rankWords,
    streakWords,
    volumeRisingWords: payload.volumeRisingWords,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshAllGroupHotRadarCaches(service: any, payload: HotRadarPayload, sourceComputedAt: string) {
  const { data: groups, error: groupError } = await service.from('task_groups')
    .select('id, rank_domains, new_domains')
  if (groupError) throw groupError

  const rows = ((groups ?? []) as { id: string; rank_domains: string[] | null; new_domains: string[] | null }[])
    .map(group => {
      const filters = {
        rankDomains: group.rank_domains ?? [],
        newDomains: group.new_domains ?? [],
      }
      return {
        group_id: group.id,
        payload: buildGroupHotRadarPayload(payload, filters),
        filter_hash: groupHotRadarFilterHash(filters),
        source_computed_at: sourceComputedAt,
        computed_at: new Date().toISOString(),
      }
    })

  if (rows.length === 0) return 0
  const { error } = await service.from('group_hot_radar_cache').upsert(rows, { onConflict: 'group_id' })
  if (error) throw error
  return rows.length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshGroupHotRadarCache(service: any, groupId: string) {
  const [{ data: group, error: groupError }, { data: globalCache, error: globalError }] = await Promise.all([
    service.from('task_groups').select('id, rank_domains, new_domains').eq('id', groupId).maybeSingle(),
    service.from('hot_radar_cache').select('payload, computed_at').eq('id', 'latest').maybeSingle(),
  ])
  if (groupError) throw groupError
  if (!group) throw new Error('Task group not found')
  if (globalError) throw globalError
  if (!globalCache?.payload) return null

  const filters = {
    rankDomains: group.rank_domains ?? [],
    newDomains: group.new_domains ?? [],
  }
  const row = {
    group_id: groupId,
    payload: buildGroupHotRadarPayload(globalCache.payload as HotRadarPayload, filters),
    filter_hash: groupHotRadarFilterHash(filters),
    source_computed_at: globalCache.computed_at,
    computed_at: new Date().toISOString(),
  }
  const { error } = await service.from('group_hot_radar_cache').upsert(row, { onConflict: 'group_id' })
  if (error) throw error
  return row
}
