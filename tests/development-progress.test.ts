import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { checklistProgress, localDevelopmentDate, parseDevelopmentTask } from '../lib/development-progress'

const input = () => ({ title: '开发进度', description: '保留从想法到上线的过程', owner_name: '负责人', stage: 'development',
  checklist: [{ id: '00000000-0000-4000-8000-000000000001', text: '实现', done: false }],
  blocker: '', next_step: '', test_notes: '', deployment_notes: '' })
test('checklist completion is independent of deployment stage, without invented percentages', () => {
  assert.deepEqual(checklistProgress([]), { total: 0, completed: 0, percent: 0 })
  assert.deepEqual(checklistProgress([input().checklist[0]]), { total: 1, completed: 0, percent: 0 })
  assert.equal(checklistProgress([{ ...input().checklist[0], done: true }]).percent, 100)
  assert.ok(parseDevelopmentTask({ ...input(), checklist: [{ ...input().checklist[0], done: true }] }).data)
})
test('test and deployment evidence gate later stages, pause and cancellation need reasons', () => {
  for (const stage of ['ready', 'live']) assert.ok(parseDevelopmentTask({ ...input(), stage }).error)
  const ready = { ...input(), stage: 'ready', checklist: [{ ...input().checklist[0], done: true }], test_notes: '验收通过' }
  assert.ok(parseDevelopmentTask(ready).data)
  assert.ok(parseDevelopmentTask({ ...ready, stage: 'live' }).error)
  assert.ok(parseDevelopmentTask({ ...ready, stage: 'live', deployment_notes: '部署成功，线上验证通过' }).data)
  for (const stage of ['paused', 'cancelled']) {
    assert.ok(parseDevelopmentTask({ ...input(), stage }).error)
    assert.ok(parseDevelopmentTask({ ...input(), stage, blocker: '等待后续评估' }).data)
  }
})
test('invalid checklist structures and overlong fields are rejected, never silently truncated', () => {
  const item = input().checklist[0]
  for (const checklist of [[{ ...item, done: 'yes' }], [item, item], [{ ...item, id: 'x' }], [{ ...item, text: ' ' }], new Array(31).fill(item)]) {
    assert.ok(parseDevelopmentTask({ ...input(), checklist }).error)
  }
  assert.ok(parseDevelopmentTask({ ...input(), title: 'x'.repeat(121) }).error)
  assert.ok(parseDevelopmentTask({ ...input(), stage: 'completed' }).error)
  assert.ok(parseDevelopmentTask({ ...input(), title: '  ' }).error)
  assert.equal(parseDevelopmentTask({ ...input(), title: ' 测试 ' }).data?.title, '测试')
})
test('release dates follow UTC+8 even before UTC midnight', () => {
  assert.equal(localDevelopmentDate(new Date('2026-10-25T17:00:00Z')), '2026-10-26')
})
test('progress routes preserve reader and project-owner write boundaries and use bounded pages', () => {
  const auth = readFileSync('lib/development-log-auth.ts', 'utf8')
  assert.match(auth, /auth\.getUser\(\)/)
  assert.match(auth, /profile\.is_active === false/)
  assert.match(auth, /canReadDevelopmentLog\(profile.role\)/)
  assert.match(auth, /write && !canManageDevelopmentLog\(user.id\)/)
  for (const name of ['app/api/development-log/tasks/route.ts', 'app/api/development-log/tasks/[id]/route.ts']) {
    const source = readFileSync(name, 'utf8')
    assert.match(source, /authorizeDevelopmentLog\(true\)/)
    assert.match(source, /p_actor: auth.user!\.id/)
    assert.match(source, /\.range\(/)
    assert.match(source, /save_development_task/)
    assert.doesNotMatch(source, /\.delete\(/)
  }
})
test('database progress history is atomic, append-only and not executable by browser roles', () => {
  const sql = readFileSync('supabase/migrations/20261026_development_progress.sql', 'utf8')
  assert.match(sql, /for update/)
  assert.match(sql, /raise serialization_failure/)
  assert.match(sql, /snapshot\)\s+values\(t.id,p_actor,actor_name,trim\(p_note\),to_jsonb\(t\)\)/)
  assert.match(sql, /revoke all on public.development_task_events from service_role/)
  assert.match(sql, /grant select,insert on public.development_task_events to service_role/)
  assert.match(sql, /save_development_task[^;]+from public,anon,authenticated/)
  assert.match(sql, /status='completed'/)
  assert.doesNotMatch(sql, /update public.development_releases|delete from|development_requests/)
})
