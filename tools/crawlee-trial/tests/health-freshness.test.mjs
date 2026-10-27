import assert from 'node:assert/strict'
import test from 'node:test'
import { assessSourceFreshness } from '../health.mjs'

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
