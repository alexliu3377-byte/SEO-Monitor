import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { summarizeCrawlTask, loadCrawlSiteLogs, loadTodayCrawlSummaries, type CrawlActivity, type CrawlSiteLog } from '../lib/crawl-log-summary'

function activity(id: string, logged_at = '2026-10-22T20:00:00Z'): CrawlActivity {
  return { id, logged_at, type: 'cron_task', source: 'github_actions', step: 'keywords',
    domain: null, group_index: 0, total_groups: 1, ip: null, status: 'done',
    ok_count: 0, empty_count: 1, fail_count: 0, skip_count: 0, rows_written: 0,
    duration_ms: 100, summary: null, data_date: '2026-10-23', crawl_run_id: 'run' }
}
function site(id: string, activity_id: string, domain: string, status: CrawlSiteLog['status'], logged_at = '2026-10-22T20:00:00Z'): CrawlSiteLog {
  return { id, activity_id, domain, status, logged_at, rows_written: 0, detail: null }
}

test('immediate and delayed retries count each domain once, not attempts', () => {
  const activities = [activity('main'), activity('immediate'), activity('later', '2026-10-23T03:00:00Z')]
  const result = summarizeCrawlTask(activities, [
    site('1', 'main', 'a.test', 'empty'), site('2', 'main', 'b.test', 'fail'),
    site('3', 'main', 'c.test', 'ok'),
    site('4', 'immediate', 'a.test', 'empty', '2026-10-22T20:01:00Z'),
    site('5', 'later', 'b.test', 'ok', '2026-10-23T03:01:00Z'),
    site('6', 'unrelated', 'hidden.test', 'fail'),
  ])
  assert.equal(result.total, 3)
  assert.equal(result.ok, 2)
  assert.equal(result.empty, 1)
  assert.equal(result.fail, 0)
  assert.deepEqual(result.problems.map(row => row.domain), ['a.test'])
  assert.equal(result.latestRun?.id, 'later')
})

test('manual-only runs work; latest suspect and later failures remain visible', () => {
  const run = { ...activity('manual'), type: 'cron_manual' as const }
  const result = summarizeCrawlTask([run], [
    site('1', 'manual', 'a.test', 'ok'),
    site('2', 'manual', 'a.test', 'suspect', '2026-10-22T20:02:00Z'),
    site('3', 'manual', 'b.test', 'fail'),
  ])
  assert.equal(result.total, 2)
  assert.equal(result.suspect, 1)
  assert.equal(result.fail, 1)
  assert.equal(result.problems.length, result.empty + result.fail + result.suspect)
})

test('skip does not erase an actual result; equal timestamps have a stable tie-breaker', () => {
  const rows = [site('1', 'main', 'a.test', 'empty'), site('2', 'main', 'a.test', 'ok'),
    site('3', 'main', 'a.test', 'skip', '2026-10-22T20:03:00Z'), site('4', 'main', 'b.test', 'skip')]
  assert.equal(summarizeCrawlTask([activity('main')], rows).ok, 1)
  assert.deepEqual(summarizeCrawlTask([activity('main')], rows), summarizeCrawlTask([activity('main')], [...rows].reverse()))
})

test('missing details and running collection are not reported as confirmed success', () => {
  assert.equal(summarizeCrawlTask([activity('main')], []).missingDetails, true)
  assert.equal(summarizeCrawlTask([{ ...activity('main'), status: 'running' }], []).running, true)
  assert.equal(summarizeCrawlTask([], []).runs, 0)
})

function mockClient(activities: CrawlActivity[], sites: CrawlSiteLog[], fail = false) {
  const requests: { table: string; from: number; to: number }[] = []
  const client = { from(table: string) {
    let ids: string[] | undefined
    const query = {
      select() { return query }, gte() { return query }, lte() { return query }, order() { return query },
      in(column: string, values: string[]) { if (column === 'activity_id') ids = values; return query },
      async range(from: number, to: number) {
        requests.push({ table, from, to })
        const data = table === 'activity_log' ? activities : sites.filter(row => ids?.includes(row.activity_id))
        return fail ? { data: null, error: { message: 'Database unavailable' } }
          : { data: data.slice(from, to + 1), error: null }
      },
    }
    return query
  } } as unknown as SupabaseClient
  return { client, requests }
}

test('site logs paginate past 2000 rows and chunk IDs to keep URLs bounded', async () => {
  const activities = Array.from({ length: 105 }, (_, i) => activity(String(i)))
  const sites = Array.from({ length: 2401 }, (_, i) => site(String(i), String(i % 105), `site${i}.test`, 'empty'))
  const { client, requests } = mockClient(activities, sites)
  const rows = await loadCrawlSiteLogs(client, activities.map(row => row.id))
  assert.equal(rows.length, 2401)
  assert.equal(new Set(rows.map(row => row.id)).size, 2401)
  assert.ok(requests.some(request => request.from >= 2000))
  assert.ok(requests.every(request => request.to - request.from === 499))
})

test('today snapshot excludes backfills and refresh replaces previous problem lists', async () => {
  const activities = [activity('today'), { ...activity('backfill'), data_date: '2026-10-21' }]
  const { client } = mockClient(activities, [site('1', 'today', 'a.test', 'empty'), site('2', 'backfill', 'b.test', 'fail')])
  const before = await loadTodayCrawlSummaries(client, '2026-10-23', '', '')
  assert.equal(before.keywords.total, 1)
  assert.equal(before.keywords.problems.length, 1)
  const refreshed = mockClient(activities, [site('3', 'today', 'a.test', 'ok')])
  const after = await loadTodayCrawlSummaries(refreshed.client, '2026-10-23', '', '')
  assert.equal(after.keywords.total, 1)
  assert.equal(after.keywords.problems.length, 0)
})

test('query failures are surfaced, never converted into a successful empty snapshot', async () => {
  const { client } = mockClient([], [], true)
  await assert.rejects(loadTodayCrawlSummaries(client, '2026-10-23', '', ''), /Database unavailable/)
  await assert.rejects(loadCrawlSiteLogs(client, ['a']), /Database unavailable/)
})
