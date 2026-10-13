import { createClient } from '@supabase/supabase-js'
import { crawlSourceStatus, isValidSourceDate, type CrawlSourceCompletion } from '../lib/crawl-source-status'
import { DAILY_CRAWL_DEPENDENCIES } from '../lib/crawl-reliability'

// Repair confirmation metadata without recalculating/writing payloads or their
// timestamps. Never confirm newer source inputs against an older data cache.
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret) throw new Error('Supabase worker credentials are not configured')
  const db = createClient(url,secret,{ auth: { persistSession: false,autoRefreshToken: false } })
  const { data: cache,error: cacheError } = await db.from('hot_radar_cache')
    .select('computed_at,source_data_date').eq('id','latest').single()
  if (cacheError) throw cacheError
  if (!cache?.source_data_date || !isValidSourceDate(cache.source_data_date)) {
    throw new Error('Cache has no trustworthy source batch date; do not infer a completed batch')
  }
  const { data: rows,error: sourceError } = await db.from('crawl_step_completion')
    .select('step,processing_complete,complete,unresolved,completed_at')
    .eq('data_date',cache.source_data_date).in('step',[...DAILY_CRAWL_DEPENDENCIES])
  if (sourceError) throw sourceError
  if (!Array.isArray(rows)) throw new Error('Invalid source confirmation metadata')
  if (rows.some(row => row.completed_at && Date.parse(row.completed_at) > Date.parse(cache.computed_at))) {
    throw new Error('Source confirmations are newer than cached data; regenerate the data cache first')
  }
  const status = crawlSourceStatus(rows as CrawlSourceCompletion[])
  const { data: updated,error: writeError } = await db.from('hot_radar_cache').update({
    source_complete: status.sourceComplete,source_warnings: status.sourceWarnings,
  }).eq('id','latest').eq('computed_at',cache.computed_at)
    .eq('source_data_date',cache.source_data_date).select('id')
  if (writeError) throw writeError
  if (updated?.length !== 1) throw new Error('Cache changed during the update; source status was not published')
  console.log(JSON.stringify({ updated: true,sourceDataDate: cache.source_data_date,
    ...status,payloadAndTimestampsUnchanged: true }))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Unable to refresh source confirmation metadata')
  process.exitCode = 1
})
