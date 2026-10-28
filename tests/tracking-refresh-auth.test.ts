import assert from 'node:assert/strict'
import test from 'node:test'
import { GET } from '../app/api/tracking-cache/refresh/route'

test('tracking rebuild rejects browser sessions and invalid service credentials before database access', async t => {
  const previous = process.env.CRON_SECRET
  t.after(() => {
    if (previous === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  })
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network permitted') })
  process.env.CRON_SECRET = 'offline-test-secret'
  const credentials: Record<string, string>[] = [{ cookie: 'session=admin' }, { authorization: 'Bearer wrong' }]
  for (const query of ['', '?groupId=00000000-0000-0000-0000-000000000001']) {
    for (const headers of credentials) {
      const response = await GET(new Request(`https://example.test/api/tracking-cache/refresh${query}`, { headers }))
      assert.equal(response.status, 403)
    }
  }
  delete process.env.CRON_SECRET
  const response = await GET(new Request('https://example.test/api/tracking-cache/refresh', {
    headers: { authorization: 'Bearer undefined' },
  }))
  assert.equal(response.status, 403)
  assert.equal(network.mock.calls.length, 0)
})
