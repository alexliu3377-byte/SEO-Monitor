import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasCompletedCrawlGroups, unresolvedCrawlSites, replaceCollectedRankRows, checkCrawlDependencies, finalizeCrawlStep, writeCrawlSiteLog, claimCrawlDerivation, finishCrawlDerivation } from '../lib/crawl-reliability'

const activity = (group: number, status = 'done', completed = true, total = 2) => ({
  id: `a${group}`, group_index: group, total_groups: total, status,
  completed_at: completed ? '2026-10-13T00:00:00Z' : null,
})

test('finalization waits for the last shard, not group 0, and accepts a full-matrix recovery', () => {
  assert.equal(hasCompletedCrawlGroups([activity(0)], 2), false)
  assert.equal(hasCompletedCrawlGroups([activity(0), activity(1, 'running', false)], 2), false)
  assert.equal(hasCompletedCrawlGroups([activity(1), activity(0), activity(1, 'running', false)], 2), true)
  assert.equal(hasCompletedCrawlGroups([activity(0, 'done', true, 1), activity(1, 'running', false)], 2), false)
})

test('successful retries resolve old failure logs, while latest empty/partial results stay explicit', () => {
  assert.deepEqual(unresolvedCrawlSites([
    { domain: 'a.com', status: 'ok' }, { domain: 'b.com', status: 'suspect' },
    { domain: 'a.com', status: 'fail' }, { domain: 'b.com', status: 'ok' },
  ]), [{ domain: 'b.com', status: 'suspect' }])
})

test('an empty result never invokes replacement; a DB failure does not fall back to non-atomic deletion', async () => {
  let calls = 0
  const sb = { rpc: async () => { calls++; return { data: null, error: { message: 'insert failed' } } } } as unknown as SupabaseClient
  assert.equal(await replaceCollectedRankRows(sb, 'site', '2026-10-13', 'rank_changes', []), 0)
  assert.equal(calls, 0)
  await assert.rejects(replaceCollectedRankRows(sb, 'site', '2026-10-13', 'rank_changes', [{ keyword: 'a' }]), /insert failed/)
  assert.equal(calls, 1)
})

function resultQuery(result: unknown) {
  const query: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'in', 'order', 'maybeSingle']) query[name] = () => query
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return query
}

test('cache dependency checks reject a missing/unfinished step and propagate DB errors', async () => {
  const sb = { from: () => resultQuery({ data: [{ step: 'rank', processing_complete: false }], error: null }) } as unknown as SupabaseClient
  await assert.rejects(checkCrawlDependencies(sb, '2026-10-13', ['rank', 'rank-title']), /rank, rank-title/)
  const failed = { from: () => resultQuery({ data: null, error: { message: 'read failed' } }) } as unknown as SupabaseClient
  await assert.rejects(checkCrawlDependencies(failed, '2026-10-13', ['rank']), /read failed/)
})

test('failed result logging cannot silently authorize a full completion', async () => {
  const sb = { from: () => ({ insert: async () => ({ data: null, error: { message: 'log write failed' } }) }) } as unknown as SupabaseClient
  await assert.rejects(writeCrawlSiteLog(sb, 'activity', { domain: 'a.com', status: 'fail' }), /log write failed/)
})

test('rollup RPC error prevents a completion marker from being published', async () => {
  const original = process.env.GITHUB_RUN_ID
  process.env.GITHUB_RUN_ID = 'test-run'
  let writes = 0
  const sb = {
    from: (table: string) => {
      if (table === 'activity_log') return resultQuery({ data: [activity(0, 'done', true, 1)], error: null })
      if (table === 'activity_site_log') return resultQuery({ data: [{ domain: 'a.com', status: 'ok' }], error: null })
      writes++
      throw new Error('completion write should not occur')
    },
    rpc: async () => ({ data: null, error: { message: 'rollup timed out' } }),
  } as unknown as SupabaseClient
  try {
    await assert.rejects(finalizeCrawlStep(sb, { step: 'rank', date: '2026-10-13', totalGroups: 1, site: null }), /rollup timed out/)
    assert.equal(writes, 0)
  } finally {
    if (original === undefined) delete process.env.GITHUB_RUN_ID
    else process.env.GITHUB_RUN_ID = original
  }
})

test('monthly service route reaches its handler without exposing unrelated chart routes', async () => {
  const { allowsServiceAuthPath } = await import('../lib/service-api-access')
  assert.equal(allowsServiceAuthPath('/api/charts/monthly-trend'), true)
  assert.equal(allowsServiceAuthPath('/api/charts/monthly-trend-invalid'), false)
  assert.equal(allowsServiceAuthPath('/api/charts'), false)
})

test('a delayed prerequisite skips immediately, while the last ready source can claim derived work', async () => {
  const original = process.env.GITHUB_RUN_ID
  process.env.GITHUB_RUN_ID = 'last-source-run'
  const responses = [
    { ready: false, claimed: false, missing: ['rank-title'] },
    { ready: true, claimed: true, missing: [] },
    { ready: true, claimed: false, missing: [] },
  ]
  let calls = 0
  const service = { rpc: async () => ({ data: responses[calls++], error: null }) } as unknown as SupabaseClient
  try {
    assert.equal((await claimCrawlDerivation(service, '2026-10-13')).claimed, false)
    assert.equal((await claimCrawlDerivation(service, '2026-10-13')).claimed, true)
    assert.equal((await claimCrawlDerivation(service, '2026-10-13')).claimed, false)
    assert.equal(calls, 3)
  } finally {
    if (original === undefined) delete process.env.GITHUB_RUN_ID
    else process.env.GITHUB_RUN_ID = original
  }
})

test('a missing derivation lease cannot be reported as a completed cache pipeline', async () => {
  const service = { rpc: async () => ({ data: false, error: null }) } as unknown as SupabaseClient
  await assert.rejects(finishCrawlDerivation(service, '2026-10-13', true), /lease is missing/)
})
