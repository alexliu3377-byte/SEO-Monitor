import assert from 'node:assert/strict'
import test from 'node:test'
import { radarCacheNotice } from '../lib/radar-cache-notice'

test('a legacy cache or unavailable confirmation receives a neutral status, not a collection warning', () => {
  assert.deepEqual(radarCacheNotice({ sourceComplete: false, sourceWarnings: [] }), {
    tone: 'info', message: '采集状态待确认，当前显示已有资料。',
  })
  assert.equal(radarCacheNotice({ sourceComplete: false, sourceWarnings: [{ reason: 'unknown' }] })?.tone, 'info')
})

test('real partial and unfinished markers keep warnings, even alongside unknown markers', () => {
  const partial = radarCacheNotice({ sourceComplete: false, sourceWarnings: [{ reason: 'unknown' }, { reason: 'partial' }] })
  assert.equal(partial?.tone, 'warning')
  assert.match(partial?.message ?? '', /未取得完整资料/)
  const unfinished = radarCacheNotice({ sourceComplete: false, sourceWarnings: [{ reason: 'unfinished' }] })
  assert.equal(unfinished?.tone, 'warning')
  assert.match(unfinished?.message ?? '', /尚未完成/)
})

test('cache failures and stale results take priority without warning for unrelated sections', () => {
  assert.equal(radarCacheNotice({ failedSections: ['rankWords'] }, ['newWords']), null)
  assert.equal(radarCacheNotice({ failedSections: ['rankWords'], sourceComplete: false }, ['rankWords'])?.tone, 'warning')
  assert.equal(radarCacheNotice({ stale: true, sourceWarnings: [{ reason: 'unknown' }] })?.tone, 'warning')
})

test('a confirmed complete cache or an older server without metadata needs no status notice', () => {
  assert.equal(radarCacheNotice({ sourceComplete: true, sourceWarnings: [] }), null)
  assert.equal(radarCacheNotice(undefined), null)
  assert.equal(radarCacheNotice({}), null)
})

test('workspace suppresses source-only notices without changing global radar behavior or metadata', () => {
  for (const reason of ['partial', 'unfinished', 'unknown']) {
    const metadata = { sourceComplete: false, sourceWarnings: [{ reason }] }
    const original = structuredClone(metadata)
    assert.equal(radarCacheNotice(metadata, ['rankWords'], { showSourceStatus: false }), null)
    assert.notEqual(radarCacheNotice(metadata), null)
    assert.deepEqual(metadata, original)
  }
  assert.equal(radarCacheNotice({ sourceComplete: false }, undefined, { showSourceStatus: false }), null)
})

test('workspace retains stale/cache failure notices even when source status is hidden', () => {
  const options = { showSourceStatus: false }
  assert.equal(radarCacheNotice({ failedSections: ['rankWords'] }, ['rankWords'], options)?.tone, 'warning')
  assert.equal(radarCacheNotice({ stale: true }, ['rankWords'], options)?.tone, 'warning')
  assert.equal(radarCacheNotice({ failedSections: ['rankWords'], sourceWarnings: [{ reason: 'partial' }] }, ['newWords'], options), null)
})
