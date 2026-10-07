import assert from 'node:assert/strict'
import test from 'node:test'
import { dedupeTrackingTargets, type TrackingTargetRow } from '../lib/tracking-target-dedupe'

function row(overrides: Partial<TrackingTargetRow> = {}): TrackingTargetRow {
  return {
    claim_id: 'a',
    keyword: '画质mxpro官方版',
    final_keyword: '画质mxpro官方版',
    page_url: 'sjwyx.com/ruanjian/140105.html',
    operation_type: '新增',
    submit_date: '2026-09-21',
    ...overrides,
  }
}

test('keeps only the latest claim for the same page and final keyword', () => {
  const original = row()
  const update = row({ claim_id: 'b', operation_type: '更新', submit_date: '2026-09-23' })

  assert.deepEqual(dedupeTrackingTargets([original, update]), [update])
})

test('normalizes URL variants and keyword casing before deduping', () => {
  const original = row({ final_keyword: ' 画质MXPRO官方版 ' })
  const update = row({
    claim_id: 'b',
    page_url: 'https://www.sjwyx.com/ruanjian/140105.html/?source=report',
    operation_type: '更新',
    submit_date: '2026-09-23',
  })

  assert.deepEqual(dedupeTrackingTargets([original, update]), [update])
})

test('does not merge different keywords on the same page', () => {
  const first = row()
  const second = row({ claim_id: 'b', final_keyword: '画质增强工具', submit_date: '2026-09-23' })

  assert.equal(dedupeTrackingTargets([first, second]).length, 2)
})

test('does not merge rows without a page URL', () => {
  const first = row({ page_url: null })
  const second = row({ claim_id: 'b', page_url: null, submit_date: '2026-09-23' })

  assert.equal(dedupeTrackingTargets([first, second]).length, 2)
})
