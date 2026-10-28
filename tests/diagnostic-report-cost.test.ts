import assert from 'node:assert/strict'
import test from 'node:test'
import { createDiagnosticCache, mapWithConcurrency } from '../lib/diagnostic-work'
import { loadSubmissionTotals } from '../lib/submission-totals'

test('diagnostic reuse isolates keys, coalesces concurrent reads, expires and retries failures', async () => {
  let now = 0, calls = 0
  const cache = createDiagnosticCache<number>(() => now)
  const load = async () => ++calls
  assert.deepEqual(await Promise.all([cache('alice/site/day', load), cache('alice/site/day', load)]), [1, 1])
  assert.equal(await cache('bob/site/day', load), 2)
  assert.equal(await cache('alice/site/day', load), 1)
  now = 60_000
  assert.equal(await cache('alice/site/day', load), 3)
  await assert.rejects(cache('failed', async () => { throw new Error('offline') }))
  assert.equal(await cache('failed', load), 4)
})

test('diagnostic retention is bounded and skips oversized summaries', async () => {
  let calls = 0
  const cache = createDiagnosticCache<string>()
  const load = async () => { calls++; return 'small' }
  for (let i = 0; i < 9; i++) await cache(String(i), load)
  await cache('0', load)
  assert.equal(calls, 10)
  const huge = async () => { calls++; return 'x'.repeat(513 * 1024) }
  await cache('huge', huge); await cache('huge', huge)
  assert.equal(calls, 12)
})

test('site work keeps input order and runs at most two jobs together', async () => {
  let active = 0, peak = 0
  const result = await mapWithConcurrency([3, 2, 1, 0], 2, async n => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, n))
    active--; return n * 2
  })
  assert.deepEqual(result, [6, 4, 2, 0])
  assert.equal(peak, 2)
})

test('submission aggregation spans pages without mixing users, groups or sources', async () => {
  const rows = [
    { group_id: 'g', user_id: 'u', source: 'a', search_volume: 10 },
    { group_id: 'g', user_id: 'u', source: 'b', search_volume: 20 },
    { group_id: 'g', user_id: 'u', source: 'a', search_volume: 30 },
    { group_id: 'g', user_id: 'other', source: 'a', search_volume: 5 },
    { group_id: 'other', user_id: 'u', source: 'a', search_volume: 7 },
  ]
  const result = await loadSubmissionTotals(async (from, to) => ({ data: rows.slice(from, to + 1), error: null }), 2)
  assert.equal(result.length, 4)
  assert.deepEqual(result[0], { ...rows[0], count: 2, search_volume: 40 })
  assert.equal(result.reduce((n, row) => n + row.count, 0), rows.length)
  assert.equal(result.reduce((n, row) => n + row.search_volume, 0), 72)
  await assert.rejects(loadSubmissionTotals(async () => ({ data: null, error: { message: 'offline' } })), /offline/)
})
