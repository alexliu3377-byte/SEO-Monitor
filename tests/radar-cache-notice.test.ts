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
