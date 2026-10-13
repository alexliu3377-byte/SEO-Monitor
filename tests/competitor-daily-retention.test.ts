import assert from 'node:assert/strict'
import test from 'node:test'
import { pruneCompetitorDailyHistory } from '../lib/competitor-daily-retention'

type Archive = { month: string; is_final: boolean }

function database(dates: string[], details: Archive[], summaries: Archive[], archiveError = false) {
  const tables = Object.fromEntries(['raw_keywords', 'rank_changes', 'site_keyword_ranks'].map(table => [table, [...dates]]))
  const deletions: string[] = []
  return {
    tables, deletions,
    service: {
      from(table: string) {
        let column = ''
        let lessThan = ''
        let greaterThanOrEqual = ''
        let removing = false
        let equals = ''
        const query = {
          select(value: string) { column = value; return query },
          not() { return query },
          lt(_column: string, value: string) { lessThan = value; return query },
          gte(_column: string, value: string) { greaterThanOrEqual = value; return query },
          order() { return query },
          limit() { return query },
          delete() { removing = true; return query },
          eq(_column: string, value: string) { equals = value; return query },
          then(resolve: (result: { data: unknown; error: { message: string } | null }) => unknown) {
            if (table === 'monthly_trend_cache' || table === 'monthly_trend_summary_cache') {
              return Promise.resolve(resolve({
                data: table === 'monthly_trend_cache' ? details : summaries,
                error: archiveError ? { message: 'archive lookup failed' } : null,
              }))
            }
            if (removing) {
              deletions.push(`${table}:${equals}`)
              tables[table] = tables[table].filter(date => date !== equals)
              return Promise.resolve(resolve({ data: null, error: null }))
            }
            const first = tables[table].filter(date => (!lessThan || date < lessThan)
              && (!greaterThanOrEqual || date >= greaterThanOrEqual)).sort()[0]
            return Promise.resolve(resolve({ data: first ? [{ [column]: first }] : [], error: null }))
          },
        }
        return query
      },
    },
  }
}

test('preserves source detail until both monthly archives are final', async () => {
  const fixture = database(['2026-08-01', '2026-08-02'], [{ month: '2026-08', is_final: true }], [])
  const result = await pruneCompetitorDailyHistory(fixture.service, '2026-09-03')
  assert.deepEqual(fixture.deletions, [])
  assert.deepEqual(result.blockedArchiveMonths, ['2026-08'])
  assert.equal(result.complete, false)
})

test('cleans archived months while skipping an earlier unarchived month', async () => {
  const archives = [{ month: '2026-09', is_final: true }]
  const fixture = database(['2026-08-01', '2026-08-02', '2026-09-01', '2026-09-02', '2026-09-03'], archives, archives)
  const result = await pruneCompetitorDailyHistory(fixture.service, '2026-09-03')
  for (const dates of Object.values(fixture.tables)) {
    assert.deepEqual(dates, ['2026-08-01', '2026-08-02', '2026-09-03'])
  }
  assert.equal(fixture.deletions.length, 6)
  assert.deepEqual(result.blockedArchiveMonths, ['2026-08'])
})

test('a nonfinal snapshot cannot authorize cleanup', async () => {
  const fixture = database(['2026-08-01'], [{ month: '2026-08', is_final: false }], [{ month: '2026-08', is_final: true }])
  await pruneCompetitorDailyHistory(fixture.service, '2026-09-03')
  assert.deepEqual(fixture.deletions, [])
})

test('stops without deleting when the archive metadata query fails', async () => {
  const fixture = database(['2026-08-01'], [], [], true)
  await assert.rejects(pruneCompetitorDailyHistory(fixture.service, '2026-09-03'), /archive verification failed/)
  assert.deepEqual(fixture.deletions, [])
})

test('respects the cleanup date limit and the exclusive retention boundary', async () => {
  const archives = [{ month: '2026-08', is_final: true }]
  const fixture = database(['2026-08-01', '2026-08-02', '2026-08-03'], archives, archives)
  const result = await pruneCompetitorDailyHistory(fixture.service, '2026-08-03', 1)
  for (const dates of Object.values(fixture.tables)) assert.deepEqual(dates, ['2026-08-02', '2026-08-03'])
  assert.equal(fixture.deletions.length, 3)
  assert.equal(result.complete, false)
  assert.deepEqual(result.blockedArchiveMonths, [])
})
