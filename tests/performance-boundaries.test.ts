import assert from 'node:assert/strict'
import test from 'node:test'
import { monthlyTrendResponse } from '../lib/monthly-trend-data'
import { loadGroupTrackingPayload, loadFastTrackingMonth, TrackingCacheNotReadyError } from '../lib/group-tracking-cache'
import { parseCrawlContentDate } from '../lib/crawl-content-date'
import { parseUnreadSnapshot, FEEDBACK_POLL_MS, watchFeedbackUnread } from '../lib/feedback-unread-poll'
import { loadFeedbackUnreadCount } from '../lib/feedback-unread-count'

test('unread RPC returns scalar only and database failures do not become a false zero', async () => {
  assert.equal(await loadFeedbackUnreadCount({ rpc: async (name: string, params: unknown) => {
    assert.equal(name, 'get_feedback_unread_count')
    assert.deepEqual(params, { p_viewer_id: 'alice' })
    return { data: '3001', error: null }
  }, from() { assert.fail('Must not fetch complete lists when RPC is available') } }, 'alice', 'normal'), 3001)
  await assert.rejects(loadFeedbackUnreadCount({ rpc: async () => ({ data: null, error: { code: '42501' } }) }, 'alice', 'normal'))
  await assert.rejects(loadFeedbackUnreadCount({ rpc: async () => ({ data: null, error: null }) }, 'alice', 'normal'), /Invalid unread count/)
})

test('unapplied unread migration uses the same scoped count without timestamp string ordering', async () => {
  const service = {
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } }),
    from(table: string) {
      return {
        select() { return this }, not() { return this }, order() { return this },
        in(field: string, roles: string[]) { assert.equal(field, 'submitter_role'); assert.deepEqual(roles, ['normal', 'admin']); return this },
        neq(field: string, value: string) { assert.equal(field, 'latest_message_author_id'); assert.equal(value, 'alice'); return this },
        eq(field: string, value: string) { assert.equal(field, 'user_id'); assert.equal(value, 'alice'); return this },
        async range() { return { error: null, data: table === 'development_requests'
          ? [{ id: 'one', latest_message_at: '2026-10-27T02:00:00Z' }, { id: 'two', latest_message_at: '2026-10-27T01:00:00Z' }]
          : [{ request_id: 'one', last_read_at: '2026-10-27T09:00:00+08:00' }, { request_id: 'two', last_read_at: '2026-10-27T09:00:00+08:00' }] } },
      }
    },
  }
  assert.equal(await loadFeedbackUnreadCount(service, 'alice', 'normal'), 1)
})

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

test('source dates validate calendar dates and subtract relative time across MYT midnight', () => {
  const now = Date.parse('2026-10-27T00:30:00+08:00')
  assert.equal(parseCrawlContentDate('1小时前', now), '2026-10-26')
  assert.equal(parseCrawlContentDate('40分钟前', now), '2026-10-26')
  assert.equal(parseCrawlContentDate('昨天', now), '2026-10-26')
  assert.equal(parseCrawlContentDate('2026/10/25 18:30', now), '2026-10-25')
  assert.equal(parseCrawlContentDate('2026年10月25日', now), '2026-10-25')
  assert.equal(parseCrawlContentDate('2026-02-30', now), null)
  assert.equal(parseCrawlContentDate('导航栏目', now), null)
  assert.equal(parseCrawlContentDate(undefined, now), null)
})

test('unread cache rejects malformed, expired and future data', () => {
  const now = 1_000_000
  for (const value of ['oops', '{}', JSON.stringify({ count: -1, at: now }), JSON.stringify({ count: 2, at: now + 1 }), JSON.stringify({ count: 2, at: now - FEEDBACK_POLL_MS })]) {
    assert.equal(parseUnreadSnapshot(value, now), null)
  }
  assert.deepEqual(parseUnreadSnapshot(JSON.stringify({ count: 2, at: now }), now), { count: 2, at: now })
})

test('unread watcher pauses hidden tabs, shares per-user cache and invalidates after mark-read', async () => {
  const saved = new Map(['window', 'document', 'navigator', 'localStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const win = Object.assign(new EventTarget(), { setInterval: () => 1, clearInterval: () => {} })
  const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' })
  const storage = new Map<string, string>()
  const counts: number[] = []
  const stops: (() => void)[] = []
  let requests = 0
  let tail = Promise.resolve()
  try {
    const values = { window: win, document: doc, navigator: { locks: { request(_key: string, run: () => Promise<void>) { tail = tail.then(run); return tail } } },
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      fetch: async () => { requests++; return Response.json({ unreadCount: requests === 1 ? 3 : 0 }) },
    }
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value })
    stops.push(watchFeedbackUnread('alice', 'normal', value => counts.push(value)))
    assert.equal(requests, 0)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await new Promise(setImmediate)
    assert.equal(requests, 1)
    stops[0]()
    stops.push(watchFeedbackUnread('alice', 'normal', value => counts.push(value)))
    win.dispatchEvent(new Event('focus'))
    await new Promise(setImmediate)
    assert.equal(requests, 1, 'navigation/focus must reuse the fresh count')
    win.dispatchEvent(new Event('feedback-unread-changed'))
    await new Promise(setImmediate)
    assert.equal(requests, 2)
    assert.equal(counts.at(-1), 0)
    stops.push(watchFeedbackUnread('bob', 'normal', () => {}))
    await new Promise(setImmediate)
    assert.equal(requests, 3, 'another account cannot reuse Alice’s badge')
  } finally {
    stops.forEach(stop => stop())
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
