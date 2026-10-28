import assert from 'node:assert/strict'
import test from 'node:test'
import { computeOpportunityGaps } from '../lib/opportunity-gap'
import { fetchCompetitorWinningKeywords, fetchCompetitorEffectivenessSummary } from '../lib/competitor-effectiveness'
import { fetchOwnSiteDomains } from '../lib/tracking-summary'
import { computeEnvironmentStats } from '../lib/environment-stats'

function fixture(failTable?: string) {
  const candidates = Array.from({ length: 301 }, (_, i) => ({ site_id: 'competitor', keyword: `word${i}`, rank_position: 1, rank_volume: 1000 - i }))
  return { from(table: string) {
    let start = 0, end = 9999
    const data = table === 'competitor_tracking_records' ? candidates : table === 'member_claimed_keywords' ? candidates.slice(0, 300) : table === 'sites' ? [{ id: 'competitor', domain: 'competitor.test' }] : []
    return { select() { return this }, eq() { return this }, gte() { return this }, lte() { return this }, order() { return this }, in() { return this },
      range(a: number, b: number) { start = a; end = b; return this },
      then(resolve: (value: unknown) => void) { resolve({ data: data.slice(start, end + 1), error: table === failTable ? new Error('fixture failure') : null }) },
    }
  } }
}

test('gap comparison includes uncovered words beyond the first 300 candidates', async () => {
  const result = await computeOpportunityGaps(fixture(), '2026-01-01', '2026-10-28')
  assert.equal(result.competitorTotalCount, 301)
  assert.deepEqual(result.gaps.map(row => row.keyword), ['word300'])
})

test('ownership and competitor domain lookup failures cannot become empty data', async () => {
  assert.equal((await fetchOwnSiteDomains(fixture())).size, 0)
  await assert.rejects(fetchOwnSiteDomains(fixture('task_groups')), /fixture failure/)
  for (const fn of [fetchCompetitorWinningKeywords, fetchCompetitorEffectivenessSummary]) {
    await assert.rejects(fn(fixture('sites'), '2026-01-01', '2026-10-28'), /fixture failure/)
  }
})

function environment(failTable?: string, empty = false) {
  const dates: string[] = []
  return { dates, service: { from(table: string) {
    let date = ''
    return { select() { return this }, eq(_key: string, value: string) { date = value; if (table === 'weight_history') dates.push(date); return this },
      then(resolve: (value: unknown) => void) { resolve({
        data: !empty && table === 'weight_history' && date === '2026-10-27' ? [{ site_id: 's', pc_weight: 1, mobile_weight: 2 }] : [],
        error: table === failTable ? new Error('fixture failure') : null,
      }) },
    }
  } } }
}

test('environment fallback visits consecutive calendar dates in Malaysia and UTC', async () => {
  const prior = process.env.TZ
  try {
    for (const zone of ['Asia/Kuala_Lumpur', 'UTC']) {
      process.env.TZ = zone
      const f = environment()
      assert.equal((await computeEnvironmentStats(f.service, '2026-10-28'))?.asOfDate, '2026-10-27')
      assert.deepEqual(f.dates, ['2026-10-28', '2026-10-27'])
    }
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior }
})

test('environment errors fail immediately; only genuine empty data uses seven-day fallback', async () => {
  const failed = environment('weight_history')
  await assert.rejects(computeEnvironmentStats(failed.service, '2026-10-28'), /fixture failure/)
  assert.equal(failed.dates.length, 1)
  await assert.rejects(computeEnvironmentStats(environment('index_snapshots').service, '2026-10-28'), /fixture failure/)
  const empty = environment(undefined, true)
  assert.equal(await computeEnvironmentStats(empty.service, '2026-10-28'), null)
  assert.deepEqual(empty.dates, ['2026-10-28', '2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23', '2026-10-22'])
})
