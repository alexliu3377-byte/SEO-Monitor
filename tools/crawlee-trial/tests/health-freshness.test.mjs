import assert from 'node:assert/strict'
import test from 'node:test'
import { assessHealth, assessSourceFreshness } from '../health.mjs'

test('tracking must be complete today even when all five source steps succeed', () => {
  const now = Date.parse('2026-10-27T12:00:00+08:00')
  const sources = ['keywords', 'weight', 'rank', 'rank-title', 'index-pages'].map(step => ({
    step, data_date: '2026-10-27', processing_complete: true, complete: true, unresolved: [],
  }))
  const bili = { last_seen_at: new Date(now).toISOString() }
  const tracking = { step: 'tracking', data_date: '2026-10-27', processing_complete: true, complete: true, unresolved: [] }
  assert.equal(assessHealth([...sources, tracking], bili, now).status, 'passed')
  for (const row of [
    null,
    { ...tracking, complete: false, unresolved: [{ domain: 'fixture.invalid', status: 'fail' }] },
    { ...tracking, processing_complete: false },
    { ...tracking, data_date: '2026-10-26' },
  ]) {
    const result = assessHealth(row ? [...sources, row] : sources, bili, now)
    assert.equal(result.status, 'failed')
    assert.equal(result.issues.length, 1)
    assert.match(result.issues[0], /^tracking：/)
  }
})

test('scheduled source checks flag old data without treating manual Xiaohongshu as missing', () => {
  const now = Date.parse('2026-10-27T12:00:00+08:00')
  const content = ['xiaoheihe_guide','xiaoheihe_ns'].map(source => ({ source, last_seen_at: new Date(now).toISOString() }))
  const discovery = ['momo_ip','momo_hot_words'].map(dataset => ({ dataset, collected_at: new Date(now).toISOString() }))
  assert.deepEqual(assessSourceFreshness(content, discovery, now), [])
  discovery[0].collected_at = '2026-10-22T00:00:00Z'
  assert.equal(assessSourceFreshness(content, discovery, now).length, 1)
  assert.equal(assessSourceFreshness([], [], now).length, 4)
  content[0].last_seen_at = '2099-01-01T00:00:00Z'
  assert.equal(assessSourceFreshness(content, discovery, now).length, 2)
})
