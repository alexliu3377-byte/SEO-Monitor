import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { overwriteError, parseOverwriteRequest, validateOverwriteUrl } from '../lib/submission-overwrite'
import { isIncrementalOperation, submissionOperationPriority } from '../lib/submission-operation'
import { computeRowScore } from '../lib/tracking-summary'
import { applyClaimRealtimeEvent } from '../lib/claimed-task-realtime'

test('overwrite accepts a precise page URL, preserves path casing and query identity', () => {
  assert.equal(validateOverwriteUrl(' https://www.f71.com/game/ABC.html?item=1#details '), 'https://www.f71.com/game/ABC.html?item=1')
  assert.equal(validateOverwriteUrl('f71.com/game/453744.html'), 'f71.com/game/453744.html')
  for (const input of ['', '453744', 'javascript:alert(1)', 'file:///C:/secret', 'https://a:b@site.com/page', 'https://site.com/bad url', 'x'.repeat(2049), null]) {
    assert.throws(() => validateOverwriteUrl(input))
  }
})

test('overwrite request never trusts client ownership, URL, date, source or volume', () => {
  const body = { claimId: '12345678-1234-4234-8234-123456789abc', version: 'a'.repeat(32), keyword: ' 新覆盖词 ',
    userId: 'other-member', pageUrl: 'different-page', submittedAt: '1999-01-01', source: '竞品涨排名', volume: 9999 }
  assert.deepEqual(parseOverwriteRequest(body), { claimId: body.claimId, version: body.version, keyword: '新覆盖词' })
  for (const keyword of ['', ' '.repeat(10), 'x'.repeat(201), 'bad\nword', 'bad\0word', 1]) {
    assert.throws(() => parseOverwriteRequest({ ...body, keyword }))
  }
  assert.throws(() => parseOverwriteRequest({ ...body, version: '' }))
  assert.throws(() => parseOverwriteRequest({ ...body, claimId: 'not-id' }))
})

test('stale overwrites and duplicate conflicts explain recovery without claiming success', () => {
  assert.equal(overwriteError({ code: '40001', message: 'OVERWRITE_STALE' }).status, 409)
  assert.equal(overwriteError({ code: '23505' }).status, 409)
  assert.equal(overwriteError({ code: '42501' }).status, 403)
  assert.equal(overwriteError({ code: 'PGRST202' }).status, 503)
  assert.equal(overwriteError({ message: 'OVERWRITE_NOT_FOUND' }).status, 404)
})

test('normal report privacy remains separate from exact-URL all-member overwrite lookup', () => {
  const lookup = readFileSync(new URL('../app/api/task-groups/[id]/submission-overwrite/route.ts', import.meta.url), 'utf8')
  const outcomes = readFileSync(new URL('../app/api/task-groups/[id]/outcomes/route.ts', import.meta.url), 'utf8')
  assert.match(lookup, /getTrendCaller/)
  assert.match(lookup, /canAccessTaskGroup/)
  assert.match(lookup, /p_actor_id: caller\.id/)
  assert.match(lookup, /p_group_id: groupId/)
  assert.match(outcomes, /p_visible_user_id: canSeeAll \? null : userId/)
  assert.match(outcomes, /if \(!canSeeAll\) rows = rows\.filter\(r => r\.user_id === userId\)/)
})

test('migration keeps overwrite history private and preserves original submission identity', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261014_submission_overwrite.sql', import.meta.url), 'utf8')
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all on public\.submission_overwrite_history from public, anon, authenticated/)
  assert.match(sql, /md5\(to_jsonb\(v_before\)::text\) <> p_expected_version/)
  assert.match(sql, /'Asia\/Kuala_Lumpur'/)
  assert.match(sql, /source = '手动添加'/)
  assert.match(sql, /where keyword = v_keyword/)
  assert.match(sql, /before_submission, after_submission, before_tracking/)
  const claimUpdate = sql.split('update public.member_claimed_keywords set')[1].split('returning *')[0]
  assert.doesNotMatch(claimUpdate, /page_url\s*=/)
  assert.match(claimUpdate, /operation_type = '覆盖'/)
  assert.match(sql, /OVERWRITE_CACHE_STALE/)
})

test('overwrite is distinct from new content and uses incremental scoring', () => {
  assert.equal(isIncrementalOperation('覆盖'), true)
  assert.equal(isIncrementalOperation('新增'), false)
  assert.ok(submissionOperationPriority('覆盖') > submissionOperationPriority('更新'))
  assert.equal(computeRowScore(5, 5, 10000, false, '覆盖', '2026-10-14', null), 0)
  assert.equal(computeRowScore(5, 10, 10000, false, '覆盖', '2026-10-14', null), computeRowScore(5, 10, 10000, false, '更新', '2026-10-14', null))
})

test('realtime overwrite removes former-owner task and inserts/updates the new owner metadata', () => {
  const original = { id: 'c1', keyword: '旧词', user_id: 'old', status: 'submitted', claimed_date: '2026-10-12', source: '交叉词' }
  const replacement = { ...original, user_id: 'new', keyword: '覆盖词', source: '手动添加', claimed_date: '2026-10-14' }
  assert.deepEqual(applyClaimRealtimeEvent([original], 'UPDATE', replacement, 'old', '2026-10-14'), [])
  assert.deepEqual(applyClaimRealtimeEvent<typeof original>([], 'UPDATE', replacement, 'new', '2026-10-14'), [replacement])
  assert.deepEqual(applyClaimRealtimeEvent([original], 'UPDATE', replacement, 'new', '2026-10-14'), [replacement])
  assert.deepEqual(applyClaimRealtimeEvent([replacement], 'DELETE', replacement, 'new', '2026-10-14'), [])
  const pending = { ...original, status: 'pending' }
  assert.deepEqual(applyClaimRealtimeEvent([pending], 'UPDATE', pending, 'old', '2026-10-14'), [pending])
})
