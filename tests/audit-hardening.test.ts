import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSafeRemoteUrl } from '../lib/safe-remote-url'
import { normalizeDomains, normalizeTaskGroupMembers } from '../lib/task-group-data'
import {
  KEYWORD_EXPORT_OWNER_ID,
  canVerifyExportPurpose,
  isKeywordExportOwner,
} from '../lib/kw-export-owner'

const blockedUrls = [
  'file:///etc/passwd',
  'http://localhost/admin',
  'http://127.0.0.1/',
  'http://10.1.2.3/',
  'http://169.254.169.254/latest/meta-data/',
  'http://192.168.1.1/',
  'http://[::1]/',
  'http://user:password@example.com/',
  'https://example.com:8443/',
]

for (const url of blockedUrls) {
  test(`SSRF guard rejects ${url}`, async () => {
    await assert.rejects(() => assertSafeRemoteUrl(url))
  })
}

test('domain normalization removes schemes, paths and duplicates', () => {
  assert.deepEqual(
    normalizeDomains([' HTTPS://Example.COM/path ', 'example.com.', 'api.example.com']),
    ['example.com', 'api.example.com']
  )
})

test('task-group members use canonical profile names', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const service = {
    from: () => ({
      select: () => ({
        in: async () => ({ data: [{ id, username: 'Canonical Name' }], error: null }),
      }),
    }),
  }
  const result = await normalizeTaskGroupMembers(service, [
    { user_id: id, username: 'Stale Name', member_type: 'both' },
  ])
  assert.equal(result.error, undefined)
  assert.equal(result.members[0].username, 'Canonical Name')
  assert.equal(result.members[0].member_type, 'both')
})

test('keyword exports allow only the configured owner id', () => {
  assert.equal(isKeywordExportOwner(KEYWORD_EXPORT_OWNER_ID), true)
  assert.equal(isKeywordExportOwner('11111111-1111-4111-8111-111111111111'), false)
  assert.equal(isKeywordExportOwner(null), false)
  assert.equal(canVerifyExportPurpose(KEYWORD_EXPORT_OWNER_ID, 'super', 'keyword-volume'), true)
  assert.equal(canVerifyExportPurpose('11111111-1111-4111-8111-111111111111', 'super', 'keyword-volume'), false)
  assert.equal(canVerifyExportPurpose('11111111-1111-4111-8111-111111111111', 'super', 'rank-history'), true)
  assert.equal(canVerifyExportPurpose(KEYWORD_EXPORT_OWNER_ID, 'normal', 'rank-history'), false)
})
