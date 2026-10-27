import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
// In-memory PostgreSQL only; deliberately no URL/key or production connection.
const db = new PGlite()
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table user_profiles(id uuid primary key, role text, is_active boolean);
    create table development_requests(id uuid primary key, submitter_role text, latest_message_at timestamptz, latest_message_author_id uuid);
    create table development_request_message_reads(request_id uuid, user_id uuid, last_read_at timestamptz, primary key(request_id,user_id));
    grant select on all tables in schema public to service_role;`)
  for (const [n, role, active] of [[1, 'normal', true], [2, 'admin', true], [3, 'super', true], [4, 'normal', false]]) {
    await db.query('insert into user_profiles values ($1,$2,$3)', [id(n), role, active])
  }
  await db.query(`insert into development_requests
    select gen_random_uuid(), 'normal', '2026-10-27T01:00:00Z'::timestamptz, $1::uuid from generate_series(1,3001)`, [id(9)])
  await db.query(`insert into development_requests values
    ($1,'super','2026-10-27T01:00:00Z',$6),
    ($2,'normal','2026-10-27T01:00:00Z',$7),
    ($3,'normal','2026-10-27T01:00:00Z',null),
    ($4,'normal','2026-10-27T01:00:00Z',$6),
    ($5,'normal',null,$6)`, [id(10),id(11),id(12),id(13),id(14),id(9),id(1)])
  await db.query(`insert into development_request_message_reads values ($1,$2,'2026-10-27T09:00:00+08:00')`, [id(13),id(1)])
  const sql = await readFile(new URL('../supabase/migrations/20261027054828_feedback_unread_count.sql', import.meta.url), 'utf8')
  await db.exec(sql)
  await db.exec(sql) // Repeat application must preserve results and permissions.
  const rights = (await db.query(`select has_function_privilege('anon','get_feedback_unread_count(uuid)','execute') as anon,
    has_function_privilege('authenticated','get_feedback_unread_count(uuid)','execute') as authenticated,
    has_function_privilege('service_role','get_feedback_unread_count(uuid)','execute') as service`)).rows[0]
  assert.deepEqual(rights, { anon: false, authenticated: false, service: true })
  assert.equal((await db.query(`select prosecdef from pg_proc where proname='get_feedback_unread_count'`)).rows[0].prosecdef, false)
  await db.exec('set role service_role')
  for (const [viewer, expected] of [[1,3001],[2,3003],[3,3004],[4,0]]) {
    const result = await db.query('select get_feedback_unread_count($1) as count', [id(viewer)])
    assert.equal(Number(result.rows[0].count), expected)
  }
  await db.exec('reset role; set role authenticated')
  await assert.rejects(db.query('select get_feedback_unread_count($1)', [id(1)]), /permission denied/)
  console.log(JSON.stringify({ passed: true, overRestLimit: 3001, roleScopes: 4, serviceOnly: true, repeatSafe: true, productionWrites: 0 }))
} finally { await db.close() }
