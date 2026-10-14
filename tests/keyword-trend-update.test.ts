import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { buildKeywordTrendBatches, updateKeywordVolumeTrends, KEYWORD_TREND_URL_BUDGET } from '../lib/keyword-trend-update'

test('short keywords use up to 300 per batch without dropping any keyword', () => {
  const words = Array.from({ length: 901 }, (_, i) => `game-${i}`)
  const batches = buildKeywordTrendBatches(words)
  assert.deepEqual(batches.map(batch => batch.length), [300, 300, 300, 1])
  assert.deepEqual(batches.flat(), words)
  assert.deepEqual(buildKeywordTrendBatches([]), [])
  assert.deepEqual(buildKeywordTrendBatches(['same', 'same']), [['same']])
})

test('CJK and reserved characters stay below the budget using real SDK URL encoding', async () => {
  const words = Array.from({ length: 900 }, (_, i) => `游戏应用下载(中文),"更新" 🚀 ${i}`)
  const batches = buildKeywordTrendBatches(words)
  assert.deepEqual(batches.flat(), words)
  assert.ok(batches.every(batch => batch.length < 300))
  const urls: string[] = []
  const service = createClient('https://example-project.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async url => {
      urls.push(String(url))
      return new Response(null, { status: 204 })
    } },
  })
  await updateKeywordVolumeTrends(service, words, 'rankup')
  assert.equal(urls.length, batches.length)
  assert.ok(urls.every(url => Buffer.byteLength(url) < KEYWORD_TREND_URL_BUDGET))
})

test('updates only the trend field, leaving volume and historical baselines untouched', async () => {
  const changes: unknown[] = []
  const seen: string[][] = []
  const service = {
    from: (table: string) => {
      assert.equal(table, 'keyword_volume')
      return { update: (value: { latest_trend: 'rankup' | 'rankdown' }) => {
        changes.push(value)
        return { in: async (column: string, words: string[]) => {
          assert.equal(column, 'keyword')
          seen.push(words)
          return { error: null }
        } }
      } }
    },
  }
  await updateKeywordVolumeTrends(service, ['应用一', '应用二'], 'rankdown')
  assert.deepEqual(changes, [{ latest_trend: 'rankdown' }])
  assert.deepEqual(seen, [['应用一', '应用二']])
})

test('a rejected long request is split and all keywords are eventually updated', async () => {
  const requests: string[][] = []
  const saved: string[] = []
  const service = { from: () => ({ update: () => ({ in: async (_column: string, words: string[]) => {
    requests.push(words)
    if (words.length > 2) return { status: 400, error: { message: 'Bad Request' } }
    saved.push(...words)
    return { status: 204, error: null }
  } }) }) }
  const words = ['one', 'two', 'three', 'four', 'five']
  await updateKeywordVolumeTrends(service, words, 'rankup')
  assert.deepEqual(saved, words)
  assert.deepEqual(requests.map(words => words.length), [5, 3, 2, 1, 2])
})

test('non-size database errors and rejected singletons are not swallowed', async () => {
  let calls = 0
  const failed = { from: () => ({ update: () => ({ in: async () => {
    calls++
    return { status: 403, error: { message: 'permission denied' } }
  } }) }) }
  await assert.rejects(updateKeywordVolumeTrends(failed, ['a', 'b'], 'rankdown'), /rankdown trend update.*permission denied/)
  assert.equal(calls, 1)
  const constraint = { from: () => ({ update: () => ({ in: async () => {
    calls++
    return { status: 400, error: { code: '23514', message: 'violates check constraint' } }
  } }) }) }
  await assert.rejects(updateKeywordVolumeTrends(constraint, ['a', 'b'], 'rankup'), /violates check constraint/)
  assert.equal(calls, 2)
  const singleton = { from: () => ({ update: () => ({ in: async () => ({ status: 400, error: { message: 'Bad Request' } }) }) }) }
  await assert.rejects(updateKeywordVolumeTrends(singleton, ['one'], 'rankup'), /1 keywords.*Bad Request/)
})

test('a single oversized keyword fails before any updates are sent', async () => {
  let writes = 0
  const service = { from: () => { writes++; throw new Error('must not write') } }
  await assert.rejects(updateKeywordVolumeTrends(service, ['short', '长'.repeat(3000)], 'rankup'), /single keyword exceeds/)
  assert.equal(writes, 0)
})
