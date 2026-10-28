import assert from 'node:assert/strict'
import test from 'node:test'
import { monthlyTrendResponse } from '../lib/monthly-trend-data'
import { loadGroupTrackingPayload, loadFastTrackingMonth, TrackingCacheNotReadyError } from '../lib/group-tracking-cache'

function readOnlyService(tables: Record<string, unknown>) {
  return {
    from(table: string) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected read: ${table}`)
      const query = {
        select() { return this }, eq() { return this }, not() { return this }, order() { return this }, limit() { return this },
        maybeSingle() { return Promise.resolve({ data: tables[table], error: null }) },
        then(resolve: (value: unknown) => void) { resolve({ data: tables[table], error: null }) },
      }
      return query
    },
    rpc() { assert.fail('Interactive read must not compute or write') },
  }
}

test('monthly missing cache returns not-ready without aggregating or writing', async () => {
  const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
  const service = readOnlyService({ monthly_trend_cache: null })
  const response = await monthlyTrendResponse(service, new URLSearchParams({ month }))
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'CACHE_NOT_READY')
})

test('monthly stale snapshot is served unchanged without refresh', async () => {
  const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
  const payload = { month, app: [{ keyword: 'old but real' }] }
  const response = await monthlyTrendResponse(readOnlyService({
    monthly_trend_cache: { payload, computed_at: '2020-01-01T00:00:00Z', is_final: false },
  }), new URLSearchParams({ month }))
  assert.equal(response.headers.get('X-Monthly-Trend-Cache'), 'stale')
  assert.deepEqual(await response.json(), payload)
})

test('monthly overview with missing cache does not run an aggregate for a member', async () => {
  const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
  const response = await monthlyTrendResponse(readOnlyService({
    raw_keywords: { content_date: `${month}-01` }, monthly_trend_summary_cache: [], monthly_trend_cache: [],
  }), new URLSearchParams())
  assert.equal(response.status, 503)
})

test('tracking missing cache never falls back to source records or writes', async () => {
  await assert.rejects(loadGroupTrackingPayload(readOnlyService({ group_tracking_cache: null }), 'g'), TrackingCacheNotReadyError)
})

test('tracking keeps stale valid snapshots and original computed time', async () => {
  const at = '2020-01-01T00:00:00Z'
  const result = await loadGroupTrackingPayload(readOnlyService({ group_tracking_cache: { payload: [], computed_at: at } }), 'g')
  assert.deepEqual(result, { rows: [], computedAt: at, fromCache: true, stale: true })
  const month = await loadFastTrackingMonth(readOnlyService({ group_tracking_cache_state: {
    computed_at: at, summary_payload: { version: 2, months: { '2020-01': { members: [] } } },
  } }), 'g', '2020-01')
  assert.equal(month?.computedAt, at)
})

