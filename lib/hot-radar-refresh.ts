import { computeHotRadarPayload, HOT_RADAR_SECTIONS, type HotRadarComputeResult } from './hot-radar'
import { refreshAllGroupHotRadarCaches } from './group-hot-radar-cache'
import { checkDatabaseResult, DAILY_CRAWL_DEPENDENCIES } from './crawl-reliability'
import { crawlSourceStatus, isValidSourceDate, malaysiaSourceDate, type CrawlSourceCompletion } from './crawl-source-status'

// Shared cache calculation can run on a worker with no Vercel request timeout.
// Keep timestamps for failed sections so retained old data never looks fresh.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshHotRadarCaches(service: any, options: {
  compute?: () => Promise<HotRadarComputeResult>
  refreshGroups?: typeof refreshAllGroupHotRadarCaches
  now?: string
  sourceDate?: string
} = {}) {
  const computedAt = options.now ?? new Date().toISOString()
  const sourceDataDate = options.sourceDate ?? malaysiaSourceDate(new Date(computedAt))
  if (!isValidSourceDate(sourceDataDate)) throw new Error('Invalid crawl source date')
  let sourceStatus = crawlSourceStatus(null, true)
  try {
    const { data, error } = await service.from('crawl_step_completion')
      .select('step,processing_complete,complete,unresolved').eq('data_date', sourceDataDate)
      .in('step', [...DAILY_CRAWL_DEPENDENCIES])
    if (error || !Array.isArray(data)) {
      console.warn('::warning::Crawl source completion metadata unavailable; marking source status unknown')
    } else {
      sourceStatus = crawlSourceStatus(data as CrawlSourceCompletion[])
    }
  } catch {
    console.warn('::warning::Crawl source completion metadata unavailable; marking source status unknown')
  }
  if (!sourceStatus.sourceComplete) {
    console.warn(`::warning::Source batch ${sourceDataDate} is incomplete/unknown; publishing usable cache with source warnings: ${JSON.stringify(sourceStatus.sourceWarnings)}`)
  }
  const { payload, failedSections } = await (options.compute?.() ?? computeHotRadarPayload(service))
  const { data: oldCache } = checkDatabaseResult(await service.from('hot_radar_cache')
    .select('payload,section_updated_at').eq('id', 'latest').maybeSingle(), 'read previous hot radar cache')
  if (failedSections.some(section => !Array.isArray(oldCache?.payload?.[section]))) {
    throw new Error(`Hot radar source data is not ready and has no previous valid cache: ${failedSections.join(', ')}`)
  }
  const finalPayload = { ...payload }
  for (const section of failedSections) finalPayload[section] = oldCache.payload[section]
  const sectionUpdatedAt = { ...oldCache?.section_updated_at }
  for (const section of HOT_RADAR_SECTIONS) if (!failedSections.includes(section)) sectionUpdatedAt[section] = computedAt
  checkDatabaseResult(await service.from('hot_radar_cache').upsert({
    id: 'latest', payload: finalPayload, computed_at: computedAt,
    section_updated_at: sectionUpdatedAt, failed_sections: failedSections,
    source_data_date: sourceDataDate, source_complete: sourceStatus.sourceComplete,
    source_warnings: sourceStatus.sourceWarnings,
  }), 'write hot radar cache')

  let refreshedGroups = 0
  let groupCacheWarning: string | null = null
  try {
    const { data: wordlib } = checkDatabaseResult(await service.rpc('compute_scoped_wordlib'), 'compute word library')
    if (!Array.isArray(wordlib)) throw new Error('Invalid word library result')
    checkDatabaseResult(await service.from('wordlib_cache').upsert({
      id: 'latest', payload: wordlib, computed_at: computedAt,
    }), 'write word library cache')
    refreshedGroups = await (options.refreshGroups ?? refreshAllGroupHotRadarCaches)(service, finalPayload, computedAt,sectionUpdatedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    groupCacheWarning = message.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,300)
    console.warn(`::warning::Word library/group cache refresh failed; previous good rows retained: ${groupCacheWarning}`)
  }
  return {
    success: true, complete: failedSections.length === 0 && !groupCacheWarning,
    computed_at: computedAt, failedSections, refreshedGroups, groupCacheWarning,
    sourceDataDate, ...sourceStatus,
    counts: Object.fromEntries(HOT_RADAR_SECTIONS.map(section => [section, finalPayload[section].length])),
  }
}
