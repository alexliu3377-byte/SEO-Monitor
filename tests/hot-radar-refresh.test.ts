import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshHotRadarCaches } from '../lib/hot-radar-refresh'
import type { HotRadarPayload } from '../lib/hot-radar'
import { DAILY_CRAWL_DEPENDENCIES } from '../lib/crawl-reliability'
import type { CrawlSourceCompletion } from '../lib/crawl-source-status'

const fresh: HotRadarPayload = { newWords: [], rankWords: [], streakWords: [], volumeRisingWords: [] }
function completeSources(): CrawlSourceCompletion[] {
  return DAILY_CRAWL_DEPENDENCIES.map(step => ({ step, processing_complete: true, complete: true, unresolved: [] }))
}
function cacheDb(old: unknown, wordlibError: unknown = null, sources = completeSources(), sourceError: unknown = null) {
  const writes: Record<string, unknown> = {}
  const service = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: old, error: null }),
        in: async () => ({ data: sourceError ? null : sources, error: sourceError }),
      }) }),
      upsert: async (value: unknown) => { writes[table] = value; return { error: null } },
    }),
    rpc: async () => ({ data: wordlibError ? null : [], error: wordlibError }),
  }
  return { service, writes }
}

test('failed radar sections retain previous contents and their own freshness timestamp', async () => {
  const oldRank = [{ keyword: 'old-word' }]
  const { service, writes } = cacheDb({ payload: { ...fresh, rankWords: oldRank }, section_updated_at: { rankWords: '2026-10-12T00:00:00Z' } })
  const result = await refreshHotRadarCaches(service, {
    compute: async () => ({ payload: fresh, failedSections: ['rankWords'] }),
    refreshGroups: async () => 2, now: '2026-10-13T00:00:00Z',
  })
  const row = writes.hot_radar_cache as { payload: HotRadarPayload; section_updated_at: Record<string, string> }
  assert.deepEqual(row.payload.rankWords, oldRank)
  assert.equal(row.section_updated_at.rankWords, '2026-10-12T00:00:00Z')
  assert.equal(row.section_updated_at.newWords, '2026-10-13T00:00:00Z')
  assert.equal(result.complete, false)
})

test('first-run source failure cannot publish empty caches', async () => {
  const { service, writes } = cacheDb(null)
  await assert.rejects(refreshHotRadarCaches(service, {
    compute: async () => ({ payload: fresh, failedSections: ['newWords'] }),
  }), /no previous valid cache/)
  assert.deepEqual(writes, {})
})

test('wordlib failure leaves its good cache and group rows untouched and reports incomplete', async () => {
  const { service, writes } = cacheDb({ payload: fresh }, { message: 'wordlib timeout' })
  let groupsCalled = false
  const result = await refreshHotRadarCaches(service, {
    compute: async () => ({ payload: fresh, failedSections: [] }),
    refreshGroups: async () => { groupsCalled = true; return 1 },
  })
  assert.equal(result.complete, false)
  assert.match(result.groupCacheWarning || '', /wordlib timeout/)
  assert.equal(groupsCalled, false)
  assert.equal(Object.hasOwn(writes, 'wordlib_cache'), false)
})

test('partial source markers publish useful results with warnings instead of failing derivation', async () => {
  const sources = completeSources()
  const rankSource = sources.find(row => row.step === 'rank')!
  rankSource.complete = false
  rankSource.unresolved = [{ domain: 'private-own-site.test', status: 'empty' }, { domain: 'another-hidden.test', status: 'fail' }]
  const { service, writes } = cacheDb({ payload: fresh }, null, sources)
  const result = await refreshHotRadarCaches(service, {
    compute: async () => ({ payload: fresh, failedSections: [] }),
    refreshGroups: async () => 1, now: '2026-10-13T00:00:00Z', sourceDate: '2026-10-12',
  })
  assert.equal(result.complete, true)
  assert.equal(result.sourceComplete, false)
  assert.equal(result.sourceDataDate, '2026-10-12')
  assert.deepEqual(result.sourceWarnings, [{ step: 'rank', reason: 'partial', unresolvedCount: 2 }])
  assert.deepEqual(result.failedSections, [])
  const row = writes.hot_radar_cache as { source_data_date: string; source_complete: boolean; source_warnings: unknown }
  assert.equal(row.source_data_date, '2026-10-12')
  assert.equal(row.source_complete, false)
  assert.equal(JSON.stringify(row.source_warnings).includes('private-own-site.test'), false)
  assert.equal(JSON.stringify(result.sourceWarnings).includes('another-hidden.test'), false)
})

test('manual refresh without markers records unknown status rather than fake completeness or unfinished collection', async () => {
  const { service, writes } = cacheDb({ payload: fresh }, null, [])
  const result = await refreshHotRadarCaches(service, {
    compute: async () => ({ payload: fresh, failedSections: [] }), refreshGroups: async () => 1,
    now: '2026-10-12T16:01:00Z',
  })
  assert.equal(result.complete, true)
  assert.equal(result.sourceComplete, false)
  assert.equal(result.sourceDataDate, '2026-10-13')
  assert.equal(result.sourceWarnings.length, 5)
  assert.equal(result.sourceWarnings.every(warning => warning.reason === 'unknown' && warning.unresolvedCount == null), true)
  assert.equal(Object.hasOwn(writes, 'hot_radar_cache'), true)
})

test('source metadata failure is visible but does not discard successfully calculated sections', async () => {
  const { service } = cacheDb({ payload: fresh }, null, [], { message: 'source status timeout' })
  const result = await refreshHotRadarCaches(service, {
    compute: async () => ({ payload: fresh, failedSections: [] }), refreshGroups: async () => 1,
  })
  assert.equal(result.complete, true)
  assert.equal(result.sourceComplete, false)
  assert.equal(result.sourceWarnings.every(warning => warning.reason === 'unknown'), true)
})

test('complete input markers keep source status separate from output calculation failures', async () => {
  const { service } = cacheDb({ payload: fresh })
  const result = await refreshHotRadarCaches(service, {
    compute: async () => ({ payload: fresh, failedSections: [] }), refreshGroups: async () => 1,
  })
  assert.equal(result.complete, true)
  assert.equal(result.sourceComplete, true)
  assert.deepEqual(result.sourceWarnings, [])
})

test('invalid source dates cannot create incorrectly scoped freshness metadata', async () => {
  const { service, writes } = cacheDb({ payload: fresh })
  await assert.rejects(refreshHotRadarCaches(service, { sourceDate: '2026-02-31' }), /Invalid crawl source date/)
  assert.deepEqual(writes, {})
})
