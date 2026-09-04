import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSafeRemoteUrl } from '../lib/safe-remote-url'
import { normalizeDomains, normalizeTaskGroupMembers } from '../lib/task-group-data'
import { fetchAllRows } from '../lib/supabase-paginate'
import { filterTaskGroupsForCaller, groupMatchesAssignedSites } from '../lib/task-group-access'
import {
  KEYWORD_EXPORT_OWNER_ID,
  canVerifyExportPurpose,
  isKeywordExportOwner,
} from '../lib/kw-export-owner'
import { buildCachedMemberSummary, type EnrichedTrackRow } from '../lib/group-tracking-cache'
import { canOffboardUser } from '../lib/user-offboarding'
import {
  canManageDevelopmentLog,
  canReadDevelopmentLog,
  canSubmitDevelopmentRequest,
  cleanStringList,
  isDevelopmentRequestStatus,
  isReleaseStatus,
} from '../lib/development-log'
import { PROJECT_OWNER_ID } from '../lib/project-owner'

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

test('task-group site matching normalizes URLs and requires an assigned site', () => {
  assert.equal(groupMatchesAssignedSites(['https://www.example.com/path'], ['example.com']), true)
  assert.equal(groupMatchesAssignedSites(['other.example.com'], ['example.com']), false)
  assert.equal(groupMatchesAssignedSites([], ['example.com']), false)
})

test('task-group visibility follows super, admin-site and member scopes', () => {
  const groups = [
    { id: 'group-a', site_domains: ['a.example.com'] },
    { id: 'group-b', site_domains: ['b.example.com'] },
  ]
  const members = [{ group_id: 'group-b', user_id: 'member-1' }]

  assert.deepEqual(filterTaskGroupsForCaller(groups, members, 'super-1', 'super').map(group => group.id), ['group-a', 'group-b'])
  assert.deepEqual(filterTaskGroupsForCaller(groups, members, 'admin-1', 'admin', ['a.example.com']).map(group => group.id), ['group-a'])
  assert.deepEqual(filterTaskGroupsForCaller(groups, members, 'admin-1', 'admin').map(group => group.id), [])
  assert.deepEqual(filterTaskGroupsForCaller(groups, members, 'member-1', 'normal').map(group => group.id), ['group-b'])
})

test('employee offboarding follows role boundaries and never allows self-offboarding', () => {
  assert.equal(canOffboardUser('super-1', 'super', 'admin-1', 'admin'), true)
  assert.equal(canOffboardUser('admin-1', 'admin', 'member-1', 'normal'), true)
  assert.equal(canOffboardUser('admin-1', 'admin', 'admin-2', 'admin'), false)
  assert.equal(canOffboardUser('member-1', 'normal', 'member-2', 'normal'), false)
  assert.equal(canOffboardUser('super-1', 'super', 'super-1', 'super'), false)
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

test('development log permissions separate readers, submitters and owner management', () => {
  assert.equal(canReadDevelopmentLog('normal'), false)
  assert.equal(canReadDevelopmentLog('admin'), true)
  assert.equal(canReadDevelopmentLog('super'), true)
  assert.equal(canSubmitDevelopmentRequest('admin'), false)
  assert.equal(canSubmitDevelopmentRequest('super'), true)
  assert.equal(canManageDevelopmentLog(PROJECT_OWNER_ID), true)
  assert.equal(canManageDevelopmentLog('11111111-1111-4111-8111-111111111111'), false)
})

test('development log accepts only known statuses and normalizes list input', () => {
  assert.equal(isReleaseStatus('completed'), true)
  assert.equal(isReleaseStatus('blocked'), false)
  assert.equal(isDevelopmentRequestStatus('blocked'), true)
  assert.equal(isDevelopmentRequestStatus('unknown'), false)
  assert.deepEqual(cleanStringList([' first ', '', 7, 'second']), ['first', 'second'])
})

test('Supabase pagination reads beyond the per-request row cap', async () => {
  const source = Array.from({ length: 6505 }, (_, id) => ({ id }))
  const requestedRanges: [number, number][] = []
  const rows = await fetchAllRows<{ id: number }>(async (from, to) => {
    requestedRanges.push([from, to])
    return { data: source.slice(from, to + 1), error: null }
  }, { pageSize: 3000 })

  assert.equal(rows.length, 6505)
  assert.deepEqual(rows.map(row => row.id), source.map(row => row.id))
  assert.deepEqual(requestedRanges, [[0, 2999], [3000, 5999], [6000, 8999]])
})

test('paged tracking cache summary preserves ranking, index and environment scoring rules', () => {
  const base = {
    id: 'record-1', claim_id: 'claim-1', user_id: 'user-1', keyword: 'keyword',
    final_keyword: null, page_url: null, operation_type: '新增', search_volume: 20,
    submit_date: '2026-09-01', record_date: '2026-09-04', is_indexed: true,
    index_first_seen: null, index_disappeared: null, rank_keyword: 'ranked keyword',
    rank_position: 5, prev_rank_position: null, rank_volume: 100, rank_date: '2026-09-04',
    effectiveness: '获取排名', username: 'Alex', rank_change: null, env_excluded: false,
    source: '推荐', bestRankPosition: 5, totalRankVolume: 100, score: 12,
    updateEffectBreakdown: null,
    rank_matches: [{ keyword: 'ranked keyword', rank_position: 5, prev_rank_position: null, volume: 100, isNewRank: true }],
  } satisfies EnrichedTrackRow
  const rows: EnrichedTrackRow[] = [
    base,
    {
      ...base,
      id: 'record-2', claim_id: 'claim-2', keyword: 'indexed keyword',
      rank_keyword: null, rank_position: null, rank_volume: 0,
      effectiveness: '获取收录', source: '词库', search_volume: 30,
      bestRankPosition: null, totalRankVolume: 0, score: 4,
      env_excluded: true, rank_matches: [],
    },
  ]

  const summary = buildCachedMemberSummary(rows, 'user-1', 'Alex')
  assert.equal(summary.submitted.total, 2)
  assert.equal(summary.ranked.total, 1)
  assert.equal(summary.ranked.totalVolume, 100)
  assert.equal(summary.ranked.buckets[0].count, 1)
  assert.equal(summary.indexed.count, 1)
  assert.equal(summary.indexed.volume, 30)
  assert.equal(summary.totalScore, 12)
})
