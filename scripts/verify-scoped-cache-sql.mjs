// Local PostgreSQL fixtures and Next header checks. No production connection.
// PGLITE_MODULE_PATH may point to an independently installed temporary package.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PGLITE_MODULE_PATH
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : '@electric-sql/pglite')
const db = new PGlite()
const uid = number => '10000000-0000-4000-8000-' + String(number).padStart(12, '0')
const [a, b, c] = [1, 2, 3].map(uid)
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table task_groups (id uuid primary key);
  create table sites (id uuid primary key, domain text);
  create table raw_keywords (
    id uuid primary key default gen_random_uuid(), keyword text not null, site_id uuid not null,
    content_date date, discovered_at timestamptz not null
  );
  create table keyword_signal_rollup (
    site_id uuid, keyword text, type text, max_volume integer,
    first_seen date, last_seen date, recent_dates date[], primary key(site_id, keyword, type)
  );
  create table weight_history (
    id uuid primary key default gen_random_uuid(), site_id uuid,
    pc_weight integer, mobile_weight integer, record_date date
  );
  create table hot_radar_cache (id text primary key, payload jsonb not null, computed_at timestamptz not null default now());
  create table rank_changes (
    id uuid primary key default gen_random_uuid(), site_id uuid not null, stat_date date not null,
    type text not null, keyword text not null, volume integer check(volume >= 0),
    unique(site_id, stat_date, type, keyword)
  );
  create table site_keyword_ranks (
    id uuid primary key default gen_random_uuid(), site_id uuid not null, stat_date date not null,
    type text not null, platform text not null, keyword text not null, rank_position integer,
    prev_rank integer, volume integer check(volume >= 0), title text, url text,
    unique(site_id, stat_date, type, platform, keyword)
  );
  create table activity_log (id uuid primary key, step text);
`)
for (const filename of ['20261013_group_hot_radar_cache.sql', '20261013_scoped_hot_radar.sql', '20261013_crawl_atomic_rank.sql']) {
  await db.exec(await readFile(new URL('../supabase/migrations/' + filename, import.meta.url), 'utf8'))
}
await db.query('insert into sites values ($1,$2),($3,$4),($5,$6)', [a, 'a.com', b, 'www.b.com', c, 'c.com'])
const { rows: [{ today }] } = await db.query("select (now() at time zone 'Asia/Kuala_Lumpur')::date::text as today")
function day(offset) {
  const date = new Date(today + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
async function raw(site, keyword, offset, discoveredOffset = offset) {
  await db.query('insert into raw_keywords (site_id,keyword,content_date,discovered_at) values ($1,$2,$3,$4)',
    [site, keyword, day(offset), day(discoveredOffset) + 'T10:00:00+08:00'])
}
async function rank(site, keyword, volume, offsets, lastOffset = Math.max(...offsets)) {
  await db.query('insert into keyword_signal_rollup values ($1,$2,$3,$4,$5,$6,$7)',
    [site, keyword, 'rankup', volume, day(-60), day(lastOffset), offsets.map(day)])
}
async function radar(rankDomains = [], newDomains = [], limit = 2000) {
  const { rows } = await db.query('select compute_scoped_hot_radar($1,$2,$3,$4) as payload',
    [rankDomains, newDomains, day(-30), limit])
  return rows[0].payload
}
async function wordlib(domains = []) {
  const { rows } = await db.query('select compute_scoped_wordlib($1) as payload', [domains])
  return rows[0].payload
}

await raw(a, 'shared-new', -12)
await raw(a, 'shared-new', -8)
await raw(b, 'shared-new', -1)
await raw(c, 'shared-new', -20)
await raw(a, 'selected-hidden', -1)
await raw(a, 'too-old', -40)
for (let i = 0; i < 5; i++) {
  await raw(b, 'global-top', 0)
  await raw(c, 'global-top', 0)
}
await rank(a, 'shared-rank', 10, [-35, -20, -15, -10])
await rank(b, 'shared-rank', 99999, [-29, -28, -5, -2, -1, 0])
await rank(a, 'selected-hidden', 20, [-2, -1])
await rank(c, 'unrelated-rank', 5000, [-20, -10, -5, -2, -1, 0])
const scoped = await radar(['a.com'], ['a.com'])
const sharedNew = scoped.newWords.find(row => row.keyword === 'shared-new')
assert.deepEqual(sharedNew, { keyword: 'shared-new', count: 2, siteCount: 1, sites: ['a.com'], first_date: day(-12), last_date: day(-8) })
assert.equal(scoped.newWords.some(row => row.keyword === 'too-old'), false)
const sharedRank = scoped.rankWords.find(row => row.keyword === 'shared-rank')
assert.equal(sharedRank.volume, 10)
assert.equal(sharedRank.siteCount, 1)
assert.equal(sharedRank.rankDays, 3)
assert.equal(sharedRank.first_date, day(-20))
assert.equal(sharedRank.last_date, day(-10))
assert.deepEqual(sharedRank.sites, ['a.com'])
assert.equal(scoped.streakWords.find(row => row.keyword === 'shared-rank').streak, 3)
assert.equal(scoped.streakWords.every(row => row.domain === 'a.com'), true)
const global = await radar()
assert.equal(global.rankWords.find(row => row.keyword === 'shared-rank').rankDays, 6)
assert.equal(global.rankWords.find(row => row.keyword === 'shared-rank').first_date, day(-29))
assert.equal(global.rankWords.find(row => row.keyword === 'shared-rank').last_date, day(0))
assert.equal(global.newWords.find(row => row.keyword === 'shared-new').count, 4)
assert.equal((await radar([], [], 1)).newWords.some(row => row.keyword === 'selected-hidden'), false)
assert.equal((await radar(['a.com'], ['a.com'], 1)).newWords[0].keyword, 'selected-hidden')
assert.equal((await radar(['a.com'], ['a.com'], 1)).rankWords[0].keyword, 'selected-hidden')
assert.deepEqual((await radar(['no-such-site.test'], ['no-such-site.test'])).newWords, [])
assert.equal((await radar(['b.com'], ['b.com'])).rankWords[0].sites[0], 'www.b.com', 'normalized filters match www domains')

await raw(a, 'foo', -9)
await raw(a, 'foo', -8)
await raw(a, 'foobar', -7)
await raw(b, 'foobar', -3)
await raw(b, 'foobarPro', -2)
await raw(c, 'fooExtra', 0)
await raw(c, 'bar', -1)
await raw(c, 'barPlus', 0)
const aLibrary = await wordlib(['a.com'])
const scopedBase = aLibrary.find(row => row.keyword === 'foo')
assert.deepEqual(scopedBase, { keyword: 'foo', long_tail_count: 2, site_count: 1, sites: ['a.com'], last_date: day(-7) })
const bLibrary = await wordlib(['b.com'])
assert.equal(bLibrary.some(row => row.keyword === 'foo'), false)
assert.equal(bLibrary.find(row => row.keyword === 'foobar').long_tail_count, 2)
assert.deepEqual(bLibrary.find(row => row.keyword === 'foobar').sites, ['www.b.com'])
const globalLibrary = await wordlib()
assert.equal(globalLibrary.some(row => row.keyword === 'foobar'), false,
  'scoped bases are computed from source terms; filtering the global library would lose this base')
assert.equal(globalLibrary.find(row => row.keyword === 'foo').long_tail_count, 4)

async function replace(target, rows) {
  return db.query('select replace_crawl_rank_rows($1,$2,$3,$4) as written', [a, today, target, JSON.stringify(rows)])
}
const rankRow = (keyword, volume = 20) => ({ site_id: a, stat_date: today, type: 'rankup', keyword, volume })
const titleRow = (keyword, volume = 20, platform = 'mobile', type = 'rankup') => ({
  ...rankRow(keyword, volume), type, platform, rank_position: 5, prev_rank: 10, title: 'test title', url: 'https://a.com/game/test.html',
})
await db.query('insert into rank_changes(site_id,stat_date,type,keyword,volume) values ($1,$2,$3,$4,$5)', [a, today, 'rankup', 'old-valid', 10])
await assert.rejects(replace('rank_changes', [rankRow('insert-rejected', -1)]), /check constraint/)
assert.equal((await db.query("select count(*)::int as count from rank_changes where keyword='old-valid'")).rows[0].count, 1,
  'a failed insert rolls back the delete')
assert.equal((await replace('rank_changes', [])).rows[0].written, 0)
assert.equal((await db.query("select count(*)::int as count from rank_changes where keyword='old-valid'")).rows[0].count, 1)
await assert.rejects(replace('rank_changes', [{ ...rankRow('wrong-site'), site_id: b }]), /Invalid rank row scope/)
await assert.rejects(replace('rank_changes', [{ ...rankRow('wrong-date'), stat_date: day(-1) }]), /Invalid rank row scope/)
await assert.rejects(db.query('select replace_crawl_rank_rows($1,$2,$3,null)', [a, today, 'rank_changes']), /array/)
await replace('rank_changes', [rankRow('new-valid')])
assert.equal((await db.query("select count(*)::int as count from rank_changes where keyword='old-valid'")).rows[0].count, 0)

await replace('site_keyword_ranks', [titleRow('old-mobile'), titleRow('old-pc', 30, 'pc'), titleRow('old-down', 40, 'mobile', 'rankdown')])
await assert.rejects(replace('site_keyword_ranks', [titleRow('rejected-mobile', -1)]), /check constraint/)
assert.equal((await db.query("select count(*)::int as count from site_keyword_ranks where keyword='old-mobile'")).rows[0].count, 1)
await replace('site_keyword_ranks', [titleRow('new-mobile')])
assert.deepEqual((await db.query('select keyword from site_keyword_ranks order by keyword')).rows.map(row => row.keyword), ['new-mobile', 'old-down', 'old-pc'],
  'replacing one collected platform/type preserves the other platform and direction')
assert.equal((await replace('site_keyword_ranks', [])).rows[0].written, 0)
assert.equal((await db.query('select count(*)::int as count from site_keyword_ranks')).rows[0].count, 3)

for (const signature of [
  'compute_scoped_hot_radar(text[],text[],date,integer)', 'compute_scoped_wordlib(text[])',
  'replace_crawl_rank_rows(uuid,date,text,jsonb)',
]) {
  const { rows } = await db.query('select has_function_privilege($1,$2,$3) as allowed', ['service_role', signature, 'EXECUTE'])
  assert.equal(rows[0].allowed, true)
  for (const role of ['anon', 'authenticated']) {
    const result = await db.query('select has_function_privilege($1,$2,$3) as allowed', [role, signature, 'EXECUTE'])
    assert.equal(result.rows[0].allowed, false, role + ' cannot invoke ' + signature)
  }
}
for (const table of ['group_hot_radar_cache', 'wordlib_cache']) {
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed', [role, table, 'SELECT'])).rows[0].allowed, false)
  }
}
await db.query('insert into weight_history(site_id,pc_weight,mobile_weight,record_date) values($1,1,2,$2),($1,3,4,$3),($4,5,6,$3)', [a, day(-2), day(-1), b])
await db.exec(`
  alter table weight_history enable row level security;
  grant select on weight_history to authenticated;
  create policy selected_site_only on weight_history for select to authenticated
    using (site_id = '10000000-0000-4000-8000-000000000001'::uuid);
  set role authenticated;
`)
const visibleWeights = await db.query('select * from get_latest_visible_site_weights()')
assert.equal(visibleWeights.rows.length, 1)
assert.equal(visibleWeights.rows[0].pc_weight, 3)
assert.equal(visibleWeights.rows[0].site_id, a)
await db.exec('reset role')
await db.close()

// Use Next's own path matcher and response-header overwrite order, rather than
// assuming that adding a second CSP header combines its permissions.
const require = createRequire(import.meta.url)
const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match')
const config = require('../next.config.js')
const previousEnvironment = process.env.NODE_ENV
process.env.NODE_ENV = 'production'
const headerRules = await config.headers()
process.env.NODE_ENV = previousEnvironment
function headersFor(path) {
  const headers = new Map()
  for (const rule of headerRules) {
    if (getPathMatch(rule.source)(path)) {
      for (const header of rule.headers) headers.set(header.key.toLowerCase(), header.value)
    }
  }
  return headers
}
for (const path of ['/page-studio', '/page-studio/editor/project-id', '/page-studio/projects/project-id']) {
  const csp = headersFor(path).get('content-security-policy')
  assert.equal(csp.includes("img-src 'self' data: blob: https:"), true)
  assert.equal(csp.includes("frame-src 'self' blob: https://challenges.cloudflare.com"), true)
  assert.equal(csp.includes("'unsafe-eval'"), false)
  assert.equal(csp.includes("object-src 'none'"), true)
}
for (const path of ['/login', '/content/research', '/content/task-groups', '/api/hot-radar']) {
  const csp = headersFor(path).get('content-security-policy')
  assert.equal(csp.includes("img-src 'self' data: blob: https://images.unsplash.com"), true)
  assert.equal(csp.includes("frame-src 'self'"), false)
}
assert.equal(headersFor('/api/hot-radar').get('cache-control'), 'private, no-store, max-age=0')
console.log(JSON.stringify({ passed: true, scopedRadar: true, scopedWordlib: true, atomicRollback: true, emptyPreservesData: true, rpcPermissions: true, weightRls: true, editorHeaderOverride: true }))
