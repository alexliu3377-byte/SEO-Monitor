import type { SupabaseClient } from '@supabase/supabase-js'
import type { SiteLogStatus } from './activity-log'
import { fetchAllRows } from './supabase-paginate'

export type CrawlActivity = {
  id: string
  type: 'cron_task' | 'cron_manual'
  source: string | null
  step: string | null
  domain: string | null
  group_index: number | null
  total_groups: number | null
  ip: string | null
  status: 'running' | 'done' | 'warn' | 'fail'
  ok_count: number
  empty_count: number
  skip_count: number
  fail_count: number
  rows_written: number
  duration_ms: number | null
  summary: string | null
  logged_at: string
  data_date?: string | null
  crawl_run_id?: string | null
}

export type CrawlSiteLog = {
  id: string
  activity_id: string
  domain: string
  status: SiteLogStatus
  rows_written: number
  detail: string | null
  logged_at: string
}

function newestFirst(a: { id: string; logged_at: string }, b: { id: string; logged_at: string }) {
  return Date.parse(b.logged_at) - Date.parse(a.logged_at) || b.id.localeCompare(a.id)
}

export function summarizeCrawlTask(activities: CrawlActivity[], siteLogs: CrawlSiteLog[]) {
  const ids = new Set(activities.map(activity => activity.id))
  const latest = new Map<string, CrawlSiteLog>()
  const recorded = new Set<string>()
  for (const log of [...siteLogs].sort(newestFirst)) {
    if (!ids.has(log.activity_id)) continue
    recorded.add(log.activity_id)
    // A retry can skip an already collected site. It must not erase its actual result.
    if (log.status !== 'skip' && !latest.has(log.domain)) latest.set(log.domain, log)
  }
  const sites = [...latest.values()]
  const problems = sites.filter(site => ['fail', 'empty', 'suspect'].includes(site.status))
    .sort((a, b) => a.status.localeCompare(b.status) || a.domain.localeCompare(b.domain))
  return {
    ok: sites.filter(site => site.status === 'ok').length,
    empty: sites.filter(site => site.status === 'empty').length,
    fail: sites.filter(site => site.status === 'fail').length,
    suspect: sites.filter(site => site.status === 'suspect').length,
    total: sites.length,
    problems,
    latestRun: [...activities].sort(newestFirst)[0],
    runs: activities.length,
    running: activities.some(activity => activity.status === 'running'),
    missingDetails: activities.some(activity => activity.status !== 'running'
      && activity.ok_count + activity.empty_count + activity.fail_count + activity.skip_count > 0
      && !recorded.has(activity.id)),
  }
}

export type CrawlTaskSummary = ReturnType<typeof summarizeCrawlTask>

export async function loadCrawlSiteLogs(sb: SupabaseClient, activityIds: string[]): Promise<CrawlSiteLog[]> {
  const out: CrawlSiteLog[] = []
  // Bound URL size as well as row size. Stable ordering prevents gaps between pages.
  const ids = [...new Set(activityIds)]
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    out.push(...await fetchAllRows<CrawlSiteLog>((from, to) => sb.from('activity_site_log')
      .select('id,activity_id,domain,status,rows_written,detail,logged_at')
      .in('activity_id', batch)
      .order('logged_at', { ascending: false }).order('id', { ascending: false })
      .range(from, to), { pageSize: 500 }))
  }
  return out
}

export async function loadTodayCrawlSummaries(sb: SupabaseClient, date: string, from: string, to: string) {
  const activities = await fetchAllRows<CrawlActivity>((start, end) => sb.from('activity_log')
    .select('*').gte('logged_at', from).lte('logged_at', to)
    .in('type', ['cron_task', 'cron_manual']).in('step', ['keywords', 'weight', 'rank'])
    .order('logged_at', { ascending: false }).order('id', { ascending: false })
    .range(start, end), { pageSize: 500 })
  // Backfills for another data date must not overwrite today's result. Legacy
  // and manual records without data_date remain scoped by their MYT execution day.
  const today = activities.filter(activity => !activity.data_date || activity.data_date === date)
  const sites = await loadCrawlSiteLogs(sb, today.map(activity => activity.id))
  return Object.fromEntries(['keywords', 'weight', 'rank'].map(step => [
    step, summarizeCrawlTask(today.filter(activity => activity.step === step), sites),
  ]))
}
