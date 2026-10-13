import assert from 'node:assert/strict'
import test from 'node:test'
import { crawlSourceStatus, isValidSourceDate, malaysiaSourceDate } from '../lib/crawl-source-status'
import { DAILY_CRAWL_DEPENDENCIES } from '../lib/crawl-reliability'

test('Malaysia source dates remain stable at the UTC midnight boundary', () => {
  assert.equal(malaysiaSourceDate(new Date('2026-10-12T15:59:59Z')), '2026-10-12')
  assert.equal(malaysiaSourceDate(new Date('2026-10-12T16:00:00Z')), '2026-10-13')
  assert.equal(isValidSourceDate('2026-02-31'), false)
  assert.equal(isValidSourceDate('2024-02-29'), true)
})

test('source warning counts deduplicate failed domains and never expose their names', () => {
  const rows = DAILY_CRAWL_DEPENDENCIES.map(step => ({ step, processing_complete: true, complete: true, unresolved: [] as unknown[] }))
  const rank = rows.find(row => row.step === 'rank')!
  rank.complete = false
  rank.unresolved = [{ domain: 'hidden.test' }, { domain: 'hidden.test' }, { domain: 'another.test' }]
  const result = crawlSourceStatus(rows)
  assert.deepEqual(result.sourceWarnings, [{ step: 'rank', reason: 'partial', unresolvedCount: 2 }])
  assert.equal(JSON.stringify(result).includes('hidden.test'), false)
  assert.equal(JSON.stringify(result).includes('another.test'), false)
})
