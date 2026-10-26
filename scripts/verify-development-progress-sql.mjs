import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
const db = new PGlite()
const actor = '00000000-0000-4000-8000-000000000001'
const release = '00000000-0000-4000-8000-000000000002'
const plannedRelease = '00000000-0000-4000-8000-000000000003'
const payload = { title: '测试事项', description: '测试过程保留', owner_name: '负责人', stage: 'pending', checklist: [], blocker: '', next_step: '', test_notes: '', deployment_notes: '' }
async function save(id, revision, data, target = null) {
  return (await db.query('select save_development_task($1,$2,$3,$4,$5,$6) as task', [id, revision, actor, JSON.stringify(data), '测试进展', target])).rows[0].task
}
async function rejects(code, operation) {
  await assert.rejects(operation, error => error.code === code)
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table user_profiles(id uuid primary key,username text,role text,is_active boolean);
    create table development_releases(id uuid primary key,version text,status text);
    insert into user_profiles values('${actor}','项目负责人','super',true);
    insert into development_releases values('${release}','v0.0.1','completed'),('${plannedRelease}','v0.0.2','planned');
    grant select on user_profiles,development_releases to service_role;`)
  await db.exec(await readFile(new URL('../supabase/migrations/20261026_development_progress.sql', import.meta.url), 'utf8'))
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await rejects('42501', () => db.query('select * from development_tasks'))
    await rejects('42501', () => save(null, 0, payload))
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  let task = await save(null, 0, payload)
  assert.equal(task.revision, 1)
  assert.equal(task.started_at, null)
  await rejects('40001', () => save(task.id, 0, payload))
  await rejects('22023', () => save(task.id, 1, { ...payload, stage: 'live' }))
  await rejects('22023', () => save(task.id, 1, payload, release))
  await rejects('22023', () => save(task.id, 1, { ...payload, stage: 'paused' }))
  const checklist = [{ id: '00000000-0000-4000-8000-000000000004', text: '完成检查', done: true }]
  task = await save(task.id, 1, { ...payload, stage: 'development', checklist })
  assert.ok(task.started_at)
  assert.equal(task.tested_at, null)
  await rejects('22023', () => save(task.id, 2, { ...payload, stage: 'ready', checklist }))
  await rejects('22023', () => save(task.id, 2, { ...payload, stage: 'ready', checklist: [...checklist, ...checklist], test_notes: '测试通过' }))
  task = await save(task.id, 2, { ...payload, stage: 'ready', checklist, test_notes: '测试通过' })
  assert.ok(task.tested_at)
  assert.equal(task.deployed_at, null)
  task = await save(task.id, 3, { ...payload, stage: 'live', checklist, test_notes: '测试通过', deployment_notes: '线上验证通过' })
  assert.ok(task.deployed_at)
  await rejects('22023', () => save(task.id, 4, payload, plannedRelease))
  task = await save(task.id, 4, null, release)
  assert.equal(task.release_id, release)
  await rejects('22023', () => save(task.id, 5, payload))
  await rejects('42501', () => db.exec('update development_task_events set note=\'伪造\''))
  await rejects('42501', () => db.exec('delete from development_task_events'))
  const history = (await db.query('select snapshot from development_task_events where task_id=$1 order by id', [task.id])).rows
  assert.equal(history.length, 5)
  assert.equal(history[0].snapshot.stage, 'pending')
  assert.equal(history[4].snapshot.release_id, release)
  assert.deepEqual((await db.query('select development_task_counts() as counts')).rows[0].counts, {})
  await save(null, 0, { ...payload, stage: 'cancelled', blocker: '已取消' })
  for (let i = 0; i < 11; i++) await save(null, 0, payload)
  assert.equal((await db.query('select development_task_counts() as counts')).rows[0].counts.pending, 11)
  assert.equal((await db.query('select id from development_tasks where release_id is null and stage<>\'cancelled\' order by updated_at desc,id offset 10 limit 10')).rows.length, 1)
  assert.equal((await db.query('select count(*)::int as n from development_releases')).rows[0].n, 2)
  console.log(JSON.stringify({ developmentProgress: true, atomicHistory: true, optimisticLocking: true, browserAccessDenied: true, testAndDeployGates: true, appendOnly: true, linkedHistoryPreserved: true, pagination: true, productionWrites: 0 }))
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code, where: error.where }))
  process.exitCode = 1
} finally { await db.close() }
