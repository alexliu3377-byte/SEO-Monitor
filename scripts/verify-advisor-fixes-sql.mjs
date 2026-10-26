import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
const db = new PGlite()
const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')
try {
  await db.exec('create role anon; create role authenticated; create role service_role;')
  const files = ['20261026_advisor_function_permissions', '20261026_service_rpc_explicit_permissions']
  const signatures = new Set()
  for (const file of files) {
    const sql = await migration(file)
    for (const match of sql.matchAll(/public\.(\w+)\(([^)]*)\)/g)) signatures.add(`${match[1]}(${match[2]})`)
  }
  for (const signature of signatures) {
    const trigger = /^(prevent_duplicate_active_group_claim|prevent_excluded_keyword_volume|sync_development_request_message_stats)\(/.test(signature)
    await db.exec(`create function public.${signature} ${trigger
      ? "returns trigger language plpgsql security definer as 'begin new.value := new.value + 1; return new; end;'"
      : "returns int language sql security definer as 'select 1'"}; grant execute on function public.${signature} to anon,authenticated,service_role;`)
  }
  await db.exec(`create table trigger_probe(value int); grant insert,select on trigger_probe to authenticated;
    create trigger check_probe before insert on trigger_probe for each row execute function prevent_excluded_keyword_volume();`)
  for (const file of files) await db.exec(await migration(file))
  await db.exec('set role authenticated; insert into trigger_probe values (1); reset role;')
  assert.equal((await db.query('select value from trigger_probe')).rows[0].value, 2)
  for (const signature of signatures) {
    const { rows } = await db.query(`select has_function_privilege('anon',$1,'execute') as anon,
      has_function_privilege('authenticated',$1,'execute') as authenticated,
      has_function_privilege('service_role',$1,'execute') as service`, [`public.${signature}`])
    assert.deepEqual(rows[0], { anon: false, authenticated: false, service: true })
  }
  await db.exec(`
    create table site_keyword_ranks(stat_date date);
    create index site_keyword_ranks_date on site_keyword_ranks(stat_date);
    create index idx_site_keyword_ranks_stat_date on site_keyword_ranks(stat_date);
    create table task_group_members(group_id uuid,user_id uuid,primary key(group_id,user_id));
    create unique index task_group_members_group_user_unique on task_group_members(group_id,user_id);
    create table user_site_access(user_id uuid,site_id uuid,primary key(user_id,site_id));
    create unique index user_site_access_user_site_unique on user_site_access(user_id,site_id);
    create table rank_changes(site_id uuid,type text,stat_date date);
    create table raw_keywords(site_id uuid,content_type text,content_date date);
  `)
  await db.exec(await migration('20261026_remove_verified_duplicate_indexes'))
  const indexes = (await db.query(`select indexname from pg_indexes where schemaname='public' order by indexname`)).rows.map(r => r.indexname)
  assert.deepEqual(indexes, ['idx_site_keyword_ranks_stat_date','task_group_members_pkey','user_site_access_pkey'])
  await db.exec(await migration('20261026_environment_aggregates'))
  await db.exec(`insert into rank_changes select '00000000-0000-0000-0000-000000000001','rankup','2026-10-25' from generate_series(1,2501);
    insert into raw_keywords values ('00000000-0000-0000-0000-000000000001','game','2026-10-25');`)
  assert.equal(Number((await db.query(`select up_count from environment_rank_counts('2026-10-25')`)).rows[0].up_count), 2501)
  assert.equal(Number((await db.query(`select game_count from environment_content_counts('2026-10-01','2026-10-25')`)).rows[0].game_count), 1)
  console.log(JSON.stringify({ serviceOnlyFunctions: signatures.size, triggersStillRun: true, duplicateIndexesRemoved: 3, primaryKeysPreserved: true, environmentNotTruncated: true, productionWrites: 0 }))
} finally { await db.close() }
