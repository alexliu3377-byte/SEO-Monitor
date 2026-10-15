import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canClaimDistributedKeyword, distributedRecipientLabel, parseDistributedRecipients } from '../lib/distributed-recipients'

const a = '11111111-1111-4111-8111-111111111111'
const b = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const c = '33333333-3333-4333-8333-333333333333'

test('existing and explicitly all-group distributions remain unrestricted', () => {
  assert.equal(parseDistributedRecipients(undefined), null)
  assert.equal(parseDistributedRecipients(null), null)
  assert.equal(canClaimDistributedKeyword(null, a), true)
  assert.equal(canClaimDistributedKeyword(undefined, b), true)
  assert.equal(canClaimDistributedKeyword(null, ''), false)
})

test('specific recipients are normalized/deduplicated and an empty selection fails closed', () => {
  assert.deepEqual(parseDistributedRecipients([b.toUpperCase(), a, b]), [a, b])
  for (const value of [[], '', 'all', [null], ['invalid'], [a, 1], Array(201).fill(a)]) {
    assert.throws(() => parseDistributedRecipients(value))
  }
  assert.equal(canClaimDistributedKeyword([], a), false)
  assert.equal(canClaimDistributedKeyword([a], b), false)
  assert.equal(canClaimDistributedKeyword([a, b], b), true)
  assert.equal(canClaimDistributedKeyword([a, b], c), false)
})

test('recipient labels use group member names, not raw ids or another group member fallback', () => {
  const members = [{ user_id: a, username: 'Xingyi' }, { user_id: b, username: 'Joanne' }]
  assert.equal(distributedRecipientLabel(null, members), '全组')
  assert.equal(distributedRecipientLabel([a, b], members), 'Xingyi、Joanne')
  assert.equal(distributedRecipientLabel([c], members), '已移出组员')
})

test('member distribution filtering happens server-side before rows are returned', () => {
  const route = readFileSync(new URL('../app/api/task-groups/[id]/distributed/route.ts', import.meta.url), 'utf8')
  assert.match(route, /if \(!canSeeAll\) query = query\.or\(`recipient_user_ids\.is\.null,recipient_user_ids\.cs\.\{\$\{user\.id\}\}`\)/)
  assert.match(route, /parseDistributedRecipients\(recipientUserIds\)/)
  assert.match(route, /memberIds\.has\(id\) \|\| !activeIds\.has\(id\)/)
  assert.match(route, /recipient_user_ids: recipients/)
  assert.match(route, /'Cache-Control': 'private, no-store'/)
})

test('proxy claims check the recipient, and the database closes reassignment/bypass races', () => {
  const api = readFileSync(new URL('../app/api/task-groups/[id]/claimed/route.ts', import.meta.url), 'utf8')
  assert.match(api, /canClaimDistributedKeyword\(word\.recipient_user_ids, targetUserId\)/)
  const sql = readFileSync(new URL('../supabase/migrations/20261015_distributed_recipients.sql', import.meta.url), 'utf8')
  assert.match(sql, /new\.user_id=any\(v_recipients\)/)
  assert.match(sql, /for share/)
  assert.match(sql, /DISTRIBUTED_RECIPIENT_FORBIDDEN/)
  assert.match(sql, /revoke all on public\.distributed_keywords from public, anon, authenticated/)
  assert.match(sql, /old\.source='分发词' and old\.status<>'dismissed'/)
})
