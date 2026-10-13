import assert from 'node:assert/strict'
import test from 'node:test'
import { monthlyTrendArchiveState } from '../lib/monthly-trend-archive'

test('a completed month remains rebuildable only while its first day is retained', () => {
  assert.equal(monthlyTrendArchiveState('2026-10', '2026-11-01'), 'rebuildable')
  assert.equal(monthlyTrendArchiveState('2026-10', '2026-11-10'), 'rebuildable')
  assert.equal(monthlyTrendArchiveState('2026-10', '2026-11-11'), 'expired')
  assert.equal(monthlyTrendArchiveState('2026-09', '2026-10-13'), 'expired')
})

test('final archives remain available after the source detail is deleted', () => {
  assert.equal(monthlyTrendArchiveState('2026-01', '2026-10-13', true), 'archived')
  assert.equal(monthlyTrendArchiveState('2026-09', '2026-10-13', true), 'archived')
})

test('a nonfinal old snapshot is not evidence of complete monthly data', () => {
  assert.equal(monthlyTrendArchiveState('2026-08', '2026-10-13', false), 'expired')
})

test('current months are rebuildable and future months are rejected', () => {
  assert.equal(monthlyTrendArchiveState('2026-10', '2026-10-31'), 'rebuildable')
  assert.equal(monthlyTrendArchiveState('2026-11', '2026-10-31'), 'future')
  assert.equal(monthlyTrendArchiveState('2026-11', '2026-10-31', true), 'future')
})

test('the retention boundary works across years and leap days', () => {
  assert.equal(monthlyTrendArchiveState('2025-12', '2026-01-10'), 'rebuildable')
  assert.equal(monthlyTrendArchiveState('2025-12', '2026-01-11'), 'expired')
  assert.equal(monthlyTrendArchiveState('2024-02', '2024-03-12'), 'rebuildable')
  assert.equal(monthlyTrendArchiveState('2024-02', '2024-03-13'), 'expired')
})
