import assert from 'node:assert/strict'
import test from 'node:test'
import { createRadarRefreshScheduler } from '../lib/radar-refresh-scheduler'

function harness() {
  let time = 0
  let visible = true
  let calls = 0
  let queued: (() => void) | undefined
  const scheduler = createRadarRefreshScheduler({
    refresh: () => { calls++ }, visible: () => visible, now: () => time,
    schedule: (callback, delay) => {
      assert.equal(delay, 500)
      assert.equal(queued, undefined)
      queued = callback
      return () => { queued = undefined }
    },
  })
  return { scheduler, calls: () => calls,
    advance: (ms: number) => { time += ms },
    visible: (value: boolean) => { visible = value },
    flush: () => { const callback = queued; queued = undefined; callback?.() },
  }
}

test('focus and timer share freshness; simultaneous wakes issue one refresh', () => {
  const h = harness()
  h.scheduler.wake(); h.flush()
  assert.equal(h.calls(), 0)
  h.advance(60_000)
  h.scheduler.wake(); h.scheduler.wake(); h.flush()
  assert.equal(h.calls(), 1)
  h.scheduler.wake(); h.flush()
  assert.equal(h.calls(), 1)
})

test('a burst of claims produces one refresh without waiting for the polling interval', () => {
  const h = harness()
  for (let i = 0; i < 100; i++) h.scheduler.invalidate()
  h.flush()
  assert.equal(h.calls(), 1)
  h.scheduler.invalidate(); h.flush()
  assert.equal(h.calls(), 2)
})

test('hidden notifications are retained, including a timer hidden before firing', () => {
  const h = harness()
  h.scheduler.invalidate()
  h.visible(false); h.flush()
  h.scheduler.invalidate(); h.flush()
  assert.equal(h.calls(), 0)
  h.visible(true)
  h.scheduler.wake(); h.scheduler.wake(); h.flush()
  assert.equal(h.calls(), 1)
})

test('unmount or group change cancels pending work', () => {
  const h = harness()
  h.scheduler.invalidate(); h.scheduler.dispose(); h.flush()
  h.advance(60_000); h.scheduler.wake(); h.scheduler.invalidate(); h.flush()
  assert.equal(h.calls(), 0)
})
