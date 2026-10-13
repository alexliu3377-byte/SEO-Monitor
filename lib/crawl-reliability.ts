import type { SupabaseClient } from '@supabase/supabase-js'
import { activityStart, activityEnd, type SiteLogStatus } from './activity-log'

type StartOptions = Parameters<typeof activityStart>[1]
type EndOptions = Parameters<typeof activityEnd>[2]

export const DAILY_CRAWL_DEPENDENCIES = ['keywords', 'weight', 'rank', 'rank-title', 'index-pages'] as const

export function checkDatabaseResult<T extends { error: unknown }>(result: T, label: string): T {
  if (result.error) throw new Error(`${label}: ${JSON.stringify(result.error)}`)
  return result
}

export async function writeCrawlSiteLog(sb: SupabaseClient, activityId: string, options: {
  domain: string; status: SiteLogStatus; rowsWritten?: number; detail?: string
}) {
  checkDatabaseResult(await sb.from('activity_site_log').insert({
    activity_id: activityId, domain: options.domain, status: options.status,
    rows_written: options.rowsWritten ?? 0, detail: options.detail ?? null,
  }), 'write crawl site result')
}

// Activity metadata lets the one final job verify the exact workflow run,
// rather than assuming that the fastest (group 0) shard was the last one.
export async function startCrawlActivity(sb: SupabaseClient, options: StartOptions & { dataDate: string }) {
  const { dataDate, ...activityOptions } = options
  const id = await activityStart(sb, activityOptions)
  if (!id) throw new Error('Cannot create crawl activity; completion cannot be verified')
  checkDatabaseResult(await sb.from('activity_log').update({
    crawl_run_id: process.env.GITHUB_RUN_ID || null,
    data_date: dataDate,
  }).eq('id', id), 'write crawl activity metadata')
  return id
}

export async function finishCrawlActivity(sb: SupabaseClient, id: string, options: EndOptions) {
  checkDatabaseResult(await sb.from('activity_log').update({
    status: options.status,
    ok_count: options.ok ?? 0,
    empty_count: options.empty ?? 0,
    skip_count: options.skip ?? 0,
    fail_count: options.fail ?? 0,
    rows_written: options.rowsWritten ?? 0,
    duration_ms: options.durationMs ?? null,
    summary: options.summary ?? null,
    completed_at: new Date().toISOString(),
    complete: options.status === 'done',
  }).eq('id', id), 'finish crawl activity')
}

export async function replaceCollectedRankRows(sb: SupabaseClient, siteId: string, date: string,
  target: 'rank_changes' | 'site_keyword_ranks', rows: Record<string, unknown>[]) {
  if (!rows.length) return 0
  const result = checkDatabaseResult(await sb.rpc('replace_crawl_rank_rows', {
    p_site_id: siteId, p_date: date, p_target: target, p_rows: rows,
  }), `atomic ${target} replacement`)
  return result.data as number
}

type Activity = { id: string; group_index: number | null; total_groups: number | null; status: string; completed_at: string | null }
export function hasCompletedCrawlGroups(activities: Activity[], totalGroups: number): boolean {
  // Rows are newest-first. Retries using the original full matrix supersede
  // an earlier crashed shard; subset retries cannot stand in for that matrix.
  const latest = new Map<number, Activity>()
  for (const activity of activities) {
    if (activity.total_groups !== totalGroups || activity.group_index == null || latest.has(activity.group_index)) continue
    latest.set(activity.group_index, activity)
  }
  return Array.from({ length: totalGroups }, (_, i) => latest.get(i)).every(activity =>
    !!activity?.completed_at && ['done', 'warn'].includes(activity.status))
}

type SiteResult = { domain: string; status: string }
export function unresolvedCrawlSites(logs: SiteResult[]): SiteResult[] {
  const latest = new Map<string, SiteResult>()
  for (const log of logs) if (!latest.has(log.domain)) latest.set(log.domain, log)
  return Array.from(latest.values()).filter(log => ['fail', 'empty', 'suspect'].includes(log.status))
}

export async function finalizeCrawlStep(sb: SupabaseClient, options: {
  step: string; date: string; totalGroups: number; site: string | null; retryOnly?: boolean
}) {
  const runId = process.env.GITHUB_RUN_ID
  if (!runId) throw new Error('Finalization requires GITHUB_RUN_ID')
  const activitiesResult = checkDatabaseResult(await sb.from('activity_log')
    .select('id,group_index,total_groups,status,completed_at')
    .eq('crawl_run_id', runId).eq('step', options.step).eq('data_date', options.date)
    .order('logged_at', { ascending: false }), 'read crawl completion')
  const activities = (activitiesResult.data || []) as Activity[]
  // A retry-only run may legitimately have no shards when there is no failure.
  // Its dependency check below still requires the full run's existing marker.
  if ((!options.retryOnly || activities.length > 0) && !hasCompletedCrawlGroups(activities, options.totalGroups)) {
    throw new Error(`${options.step}: a crawl shard failed, is still running, or has no completion record`)
  }
  let siteQuery = sb.from('activity_site_log').select('domain,status').order('logged_at', { ascending: false })
  if (options.retryOnly) {
    const previousActivities = checkDatabaseResult(await sb.from('activity_log').select('id')
      .eq('step', options.step).eq('data_date', options.date), 'read original crawl activities')
    siteQuery = siteQuery.in('activity_id', (previousActivities.data || []).map(row => row.id))
  } else {
    siteQuery = siteQuery.in('activity_id', activities.map(row => row.id))
  }
  const siteResults = activities.length || options.retryOnly
    ? checkDatabaseResult(await siteQuery, 'read crawl site results').data || [] : []
  const unresolved = unresolvedCrawlSites(siteResults)
  if (options.step === 'rank' || options.step === 'rank-title') {
    checkDatabaseResult(await sb.rpc('refresh_keyword_signal_rollup', { p_date: options.date }), 'final keyword signal rollup')
  }
  const summary = { step: options.step, data_date: options.date, run_id: runId,
    processing_complete: true, complete: unresolved.length === 0, unresolved, completed_at: new Date().toISOString() }
  if (!options.site) {
    if (options.retryOnly) {
      // Do not claim a full daily batch when a manual retry has no full-run
      // completion record (e.g. the main matrix never finished).
      const existing = checkDatabaseResult(await sb.from('crawl_step_completion').select('processing_complete')
        .eq('data_date', options.date).eq('step', options.step).maybeSingle(), 'read original completion marker')
      if (!existing.data?.processing_complete) throw new Error(`${options.step}: the original full batch is not finalized`)
    }
    checkDatabaseResult(await sb.from('crawl_step_completion').upsert(summary, { onConflict: 'data_date,step' }), 'write crawl completion marker')
  }
  console.log(JSON.stringify(summary))
  if (unresolved.length) console.warn(`::warning::${options.step}: ${unresolved.length} sites remain empty/failed/suspect; complete=false`)
  return summary
}

export async function checkCrawlDependencies(sb: SupabaseClient, date: string, steps: readonly string[]) {
  const result = checkDatabaseResult(await sb.from('crawl_step_completion')
    .select('step,processing_complete,complete,unresolved').eq('data_date', date).in('step', [...steps]), 'read cache dependencies')
  const rows = result.data || []
  const missing = steps.filter(step => !rows.some(row => row.step === step && row.processing_complete))
  if (missing.length) throw new Error(`Cache refresh blocked: ${date} unfinished dependencies: ${missing.join(', ')}`)
  for (const row of rows) if (!row.complete) console.warn(`::warning::${row.step}: partial data; unresolved=${JSON.stringify(row.unresolved)}`)
}

export async function claimCrawlDerivation(sb: SupabaseClient, date: string) {
  const runId = process.env.GITHUB_RUN_ID
  if (!runId) throw new Error('Derivation coordination requires GITHUB_RUN_ID')
  const result = checkDatabaseResult(await sb.rpc('claim_crawl_derivation', { p_date: date, p_run_id: runId }), 'claim cache derivation')
  const claim = result.data as { ready: boolean; claimed: boolean; missing?: string[] }
  if (!claim || typeof claim.claimed !== 'boolean') throw new Error('Invalid derivation coordination response')
  if (!claim.ready) console.log(`Source steps still pending: ${(claim.missing || []).join(', ')}; a later source completion will coordinate the caches`)
  else if (!claim.claimed) console.log('This data version is already being derived or has finished; skipping duplicate work')
  return claim
}

export async function finishCrawlDerivation(sb: SupabaseClient, date: string, success: boolean) {
  const result = checkDatabaseResult(await sb.rpc('finish_crawl_derivation', {
    p_date: date, p_run_id: process.env.GITHUB_RUN_ID, p_success: success,
  }), 'finish cache derivation')
  if (result.data !== true) throw new Error('Derivation lease is missing or owned by another run')
}
