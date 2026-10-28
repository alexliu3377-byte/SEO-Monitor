import assert from 'node:assert/strict'
import test from 'node:test'
import { deferredRequest } from '../lib/deferred-request'

test('rapid input sends only the final request after 300ms', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: string[] = [], received: string[] = []
  let settled = 0
  const start = (text: string) => deferredRequest({ delayMs: 300,
    request: async () => { sent.push(text); return text },
    success: value => { received.push(value) }, failure: error => assert.fail(String(error)),
    settled: () => { settled++ },
  })
  const cancel = start('old')
  t.mock.timers.tick(100); cancel()
  start('new')
  t.mock.timers.tick(299)
  assert.deepEqual(sent, [])
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.deepEqual(sent, ['new'])
  assert.deepEqual(received, ['new'])
  assert.equal(settled, 1)
})

for (const fails of [false, true]) {
  test(`cancelled in-flight ${fails ? 'failure' : 'success'} cannot update data, error or loading`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let resolve!: (value: string) => void
    let reject!: (error: Error) => void
    let signal!: AbortSignal
    const pending = new Promise<string>((yes, no) => { resolve = yes; reject = no })
    const cancel = deferredRequest({ delayMs: 300,
      request: s => { signal = s; return pending },
      success: () => assert.fail('stale success'), failure: () => assert.fail('stale error'),
      settled: () => assert.fail('stale loading update'),
    })
    t.mock.timers.tick(300); cancel()
    assert.equal(signal.aborted, true)
    if (fails) reject(new Error('late failure')); else resolve('late result')
    await Promise.resolve()
  })
}

test('active failure is reported and finishes loading', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const error = new Error('offline')
  let received: unknown, settled = false
  deferredRequest({ delayMs: 300, request: async () => { throw error },
    success: () => assert.fail('unexpected success'), failure: value => { received = value },
    settled: () => { settled = true },
  })
  t.mock.timers.tick(300); await Promise.resolve()
  assert.equal(received, error)
  assert.equal(settled, true)
})
