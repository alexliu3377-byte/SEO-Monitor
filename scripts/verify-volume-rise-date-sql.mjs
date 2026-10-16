// Isolated PostgreSQL fixture only; never connects to production.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
const db = new PGlite()
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.keyword_volume (
      keyword text primary key, volume bigint not null, prev_volume bigint,
      volume_change bigint, stat_date date, baseline_volume bigint not null default 0,
      net_volume_change bigint generated always as (volume-baseline_volume) stored,
      latest_trend text, last_volume_increase_date date
    );
    insert into keyword_volume(keyword,volume,prev_volume,volume_change,stat_date,baseline_volume,last_volume_increase_date)
    values ('known',100,90,10,current_date-2,50,current_date-2),
           ('unknown',100,90,10,current_date-2,50,null),
           ('stale',100,90,10,current_date,50,current_date-1);
  `)
  const migration = await readFile(new URL('../supabase/migrations/20261016_keyword_volume_rise_date.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  const get = async keyword => (await db.query('select *,last_volume_increase_date::text as rise_date from keyword_volume where keyword=$1', [keyword])).rows[0]
  const today = (await db.query("select (now() at time zone 'Asia/Kuala_Lumpur')::date::text as date")).rows[0].date
  const original = await get('known')
  assert.equal((await get('unknown')).rise_date, null) // no invented legacy history
  await db.query("update keyword_volume set stat_date=$1 where keyword='known'", [today])
  assert.equal((await get('known')).rise_date, original.rise_date) // fresh crawl, no rise
  await db.exec("update keyword_volume set volume=90, latest_trend='rankup' where keyword='known'")
  assert.equal((await get('known')).rise_date, original.rise_date) // decline and rank changes are not volume rises
  await db.exec("update keyword_volume set last_volume_increase_date='2099-01-01' where keyword='known'")
  assert.equal((await get('known')).rise_date, original.rise_date) // client cannot fake a discovery
  await db.exec("update keyword_volume set volume=120 where keyword='known'")
  assert.equal((await get('known')).rise_date, today)
  assert.equal((await get('known')).net_volume_change, 70)
  await db.query("insert into keyword_volume(keyword,volume,stat_date,last_volume_increase_date) values ('known',120,$1,'2099-01-01') on conflict(keyword) do update set volume=excluded.volume,stat_date=excluded.stat_date", [today])
  assert.equal((await get('known')).rise_date, today) // repeated same-day cross-site upsert
  await db.exec("update keyword_volume set volume=150,stat_date=current_date-5 where keyword='stale'")
  assert.notEqual((await get('stale')).rise_date, today) // late old-date observation
  await db.exec("insert into keyword_volume(keyword,volume,stat_date,last_volume_increase_date) values ('first',200,current_date,'2099-01-01')")
  assert.equal((await get('first')).rise_date, null) // first value is not an increase
  await db.exec(migration) // idempotent and must preserve observed dates
  assert.equal((await get('known')).rise_date, today)
  assert.equal((await get('unknown')).rise_date, null)
  console.log(JSON.stringify({ volumeRiseDateSql: true, discoveryUsesMalaysiaDate: true,
    repeatedCrawlsKeepDate: true, legacyDatesInvented: false, cumulativeUnchanged: true, productionWrites: 0 }))
} finally { await db.close() }
