// Standalone PostgreSQL fixture verification; never connects to production.
// Install @electric-sql/pglite in a temporary directory, then set
// PGLITE_MODULE_PATH to that package's dist/index.js before running this file.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const modulePath = process.env.PGLITE_MODULE_PATH
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : '@electric-sql/pglite')
const db = new PGlite()
const uid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0')
const [group, otherGroup, own, competitor, otherOwn, memberA, memberB, outsider] = [1, 2, 3, 4, 5, 6, 7, 8].map(uid)

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table task_groups (id uuid primary key, site_domains text[]);
  create table task_group_members (group_id uuid, user_id uuid, username text);
  create table sites (id uuid primary key, domain text);
  create table member_claimed_keywords (
    id uuid primary key, group_id uuid, user_id uuid, keyword text, final_keyword text,
    page_url text, operation_type text, submitted_at timestamptz, claimed_date date,
    created_at timestamptz, status text
  );
  create table keyword_signal_rollup (
    site_id uuid, keyword text, type text, last_seen date, latest_rank_position integer,
    latest_prev_rank integer, max_volume integer, latest_url text, latest_title text
  );
  create table site_keyword_ranks (
    id uuid primary key, site_id uuid, keyword text, stat_date date, platform text, rank_position integer
  );
  create table member_rec_dismissals (group_id uuid, user_id uuid, keyword text, dismissed_at timestamptz);
  create table competitor_tracking_records (
    id uuid primary key, site_id uuid, keyword text, discovery_date date,
    operation_type text, search_volume integer, content_type text, rank_position integer,
    rank_volume integer, content_date date, effectiveness text
  );
`)
for (const filename of ['20261013_paged_recommendations.sql', '20261013_recommendation_candidate_scope.sql', '20261013_paged_competitor_tracking.sql']) {
  await db.exec(await readFile(new URL('../supabase/migrations/' + filename, import.meta.url), 'utf8'))
}
await db.query('insert into task_groups values ($1, $2), ($3, $4)', [group, ['own.test'], otherGroup, ['friend.test']])
await db.query('insert into task_group_members values ($1,$2,$3),($1,$4,$5)', [group, memberA, 'Alice', memberB, 'Bob'])
await db.query('insert into sites values ($1,$2),($3,$4),($5,$6)', [own, 'own.test', competitor, 'competitor.test', otherOwn, 'friend.test'])

let sequence = 100
async function claim(keyword, { user = memberA, url = 'https://own.test/' + keyword, date = '2026-10-01', operation = '新增', created = date, status = 'submitted' } = {}) {
  await db.query('insert into member_claimed_keywords values ($1,$2,$3,$4,null,$5,$6,$7,$8,$9,$10)',
    [uid(sequence++), group, user, keyword, url, operation, date + 'T00:00:00Z', date, created + 'T00:00:00Z', status])
}
async function signal(keyword, { type = 'rankdown', site = type === 'rankdown' ? own : competitor, date = '2026-10-12', volume = 100, url = 'https://own.test/' + keyword } = {}) {
  await db.query('insert into keyword_signal_rollup values ($1,$2,$3,$4,null,10,$5,$6,$2)',
    [site, keyword, type, date, volume, url])
}
async function page(type = 'rankdown', index = 0, size = 20, users = [memberA, memberB]) {
  const result = await db.query('select get_task_group_recommendations_page($1,$2,$3,$4,$5,$6) as payload',
    [group, users, type, index, size, '2026-10-13'])
  return result.rows[0].payload
}

await claim('shared-keyword', { url: 'https://www.own.test/shared.html' })
await signal('shared-keyword', { volume: 9999, url: 'https://own.test/shared.html' })
await signal('shared-alias', { volume: 50, url: 'https://m.own.test/shared.html' })
await claim('cooling', { date: '2026-10-10', operation: '更新' })
await signal('cooling', { volume: 50000 })
await claim('dismissed')
await signal('dismissed', { volume: 60000 })
await db.query('insert into member_rec_dismissals values ($1,$2,$3,$4)', [group, memberA, 'dismissed', '2099-12-31T00:00:00Z'])
await claim('pending-only', { status: 'pending' })
await signal('pending-only', { volume: 70000 })
await signal('unrelated', { volume: 80000 })
for (let number = 0; number < 25; number++) {
  const keyword = 'page-keyword-' + String(number).padStart(2, '0')
  await claim(keyword)
  await signal(keyword, { volume: 1000 - number })
}
const first = await page()
const second = await page('rankdown', 1)
assert.equal(first.total, 26)
assert.equal(first.rows.length, 20)
assert.equal(second.rows.length, 6)
assert.equal(first.rows[0].keyword, 'shared-alias', 'URL-only matches preserve the existing priority')
assert.equal(first.rows[0].sameUrlCount, 2)
assert.deepEqual(first.rows[0].sameUrlKeywords.map(row => row.keyword), ['shared-keyword', 'shared-alias'])
assert.equal(new Set([...first.rows, ...second.rows].map(row => row.keyword)).size, 26)
assert.deepEqual((await page('rankdown', 99)).rows, [], 'out-of-range pages retain the correct total')
assert.equal((await page('rankdown', 0, 20, [outsider])).total, 0, 'nonmembers passed to SQL cannot leak data')
assert.equal((await page('rankdown', 0, 20, [memberB])).total, 0, 'member scopes are isolated')

await claim('grow')
await signal('grow', { type: 'rankup' })
await claim('already-ranked')
await signal('already-ranked', { type: 'rankup' })
await db.query('insert into site_keyword_ranks values ($1,$2,$3,$4,$5,$6)', [uid(sequence++), own, 'already-ranked', '2026-10-02', 'mobile', 10])
await claim('before-submission')
await signal('before-submission', { type: 'rankup', date: '2026-09-30' })
await claim('latest-owner', { date: '2026-09-01' })
await claim('latest-owner', { user: memberB, date: '2026-10-01' })
await signal('latest-owner', { type: 'rankup' })
await claim('another-own-site')
await signal('another-own-site', { type: 'rankup', site: otherOwn })
await claim('expired')
await signal('expired', { type: 'rankup', date: '2026-09-01' })
await signal('dismissed', { type: 'rankup' })
const up = await page('rankup')
assert.equal(up.total, 2)
assert.deepEqual(up.rows.map(row => row.keyword).sort(), ['grow', 'latest-owner'])
assert.equal(up.rows.find(row => row.keyword === 'latest-owner').memberId, memberB)
assert.equal(up.rows.find(row => row.keyword === 'grow').ownCreatedAt.slice(0, 10), '2026-10-01')
assert.equal((await page('rankup', 0, 20, [memberA])).rows.find(row => row.keyword === 'latest-owner').memberId, memberA,
  'ownership remains scoped to permitted members, matching the original endpoint')

// A new submission increases its cooldown immediately; no result cache can
// leave a submitted recommendation stale.
await claim('grow', { date: '2026-10-13', operation: '更新' })
assert.equal((await page('rankup')).rows.some(row => row.keyword === 'grow'), false)

async function tracking(keyword, date, contentType, rank = 5, volume = 100, effectiveness = '有效') {
  await db.query('insert into competitor_tracking_records values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [uid(sequence++), competitor, keyword, date, '新增', volume, contentType, rank, volume, date, effectiveness])
}
await tracking('changed-type', '2026-10-10', 'app', 2, 1000)
await tracking('changed-type', '2026-10-12', 'game', 3, 2000)
await tracking('became-invalid', '2026-10-10', 'app', 5, 20)
await tracking('became-invalid', '2026-10-13', 'app', null, 20, '无效')
await tracking('null-rank', '2026-10-12', 'app', null, 10)
for (let number = 0; number < 25; number++) await tracking('tracking-' + number, '2026-10-12', 'app', number + 1, 100 * number)
async function trackingPage({ page: index = 0, size = 20, keyword = '', type = '', start = null, end = null, sort = 'discovery_date', direction = 'desc' } = {}) {
  const result = await db.query('select get_competitor_tracking_page($1,$2,$3,$4,$5,$6,$7,$8,$9) as payload',
    [competitor, index, size, keyword, type, start, end, sort, direction])
  return result.rows[0].payload
}
assert.equal((await trackingPage()).total, 28)
assert.equal((await trackingPage()).rows.length, 20)
assert.equal((await trackingPage({ page: 1 })).rows.length, 8)
assert.equal((await trackingPage({ type: 'app', keyword: 'changed-type' })).total, 0,
  'a type filter must not resurrect an old app row when the latest valid row is a game')
assert.equal((await trackingPage({ keyword: 'became-invalid' })).rows[0].discovery_date, '2026-10-10',
  'the page intentionally shows the last genuinely effective row')
assert.equal((await trackingPage({ keyword: 'changed-type', end: '2026-10-10' })).rows[0].content_type, 'app',
  'date bounds apply before deduplication')
const ranked = await trackingPage({ size: 100, sort: 'rank_position', direction: 'asc' })
assert.equal(ranked.rows.at(-1).keyword, 'null-rank', 'nulls stay last for ascending sorts')
assert.equal(ranked.rows.find(row => row.keyword === 'null-rank').score, null)
for (const row of ranked.rows) {
  if (row.rank_position == null) continue
  const base = row.rank_position <= 3 ? 10 : row.rank_position <= 10 ? 8 : row.rank_position <= 20 ? 6 : row.rank_position <= 30 ? 4 : 2
  const score = Math.round((base * (1 + Math.log10((row.rank_volume ?? 0) + 1)) + 1) * 10) / 10
  assert.equal(Number(row.score), score, 'SQL score matches the production outcome score')
}

// A larger history fixture exercises deduplication over daily rows.
const started = performance.now()
await db.query(`
  insert into competitor_tracking_records
  select md5('bulk-' || key || '-' || day)::uuid, $1::uuid,
    'bulk-' || key, date '2026-08-01' + day, '新增', key, 'game', 5, key,
    date '2026-08-01', '有效'
  from generate_series(1, 1000) key cross join generate_series(1, 30) day;
`, [competitor])
const bulk = await trackingPage({ keyword: 'bulk-', page: 1 })
assert.equal(bulk.total, 1000)
assert.equal(bulk.rows.length, 20)

// The current page still shows all same-URL terms even when a submitted
// keyword's current ranking URL differs from its originally submitted URL.
await claim('moved-page', { url: 'https://own.test/original-page' })
await signal('moved-page', { url: 'https://own.test/new-page' })
await signal('moved-alias', { url: 'https://own.test/new-page' })
const moved = (await page('rankdown', 0, 100)).rows.find(row => row.keyword === 'moved-page')
assert.equal(moved.sameUrlCount, 2)
assert.deepEqual(moved.sameUrlKeywords.map(row => row.keyword).sort(), ['moved-alias', 'moved-page'])

// An older matched URL must not resurrect a keyword when its newest signal
// across the own-site scope points to a different page.
const secondOwnSite = uid(9)
await db.query('insert into sites values ($1,$2)', [secondOwnSite, 'own-two.test'])
await db.query('update task_groups set site_domains=$1 where id=$2', [['own.test', 'own-two.test'], group])
await claim('old-page-owner', { url: 'https://own.test/old-page' })
await signal('old-page-owner', { url: 'https://own.test/old-page' })
await signal('unsubmitted-alias', { url: 'https://own.test/old-page', date: '2026-10-11' })
await signal('unsubmitted-alias', { site: secondOwnSite, url: 'https://own-two.test/new-page', date: '2026-10-12' })
const latestScope = await page('rankdown', 0, 100)
assert.equal(latestScope.rows.some(row => row.keyword === 'unsubmitted-alias'), false)
assert.equal(latestScope.rows.find(row => row.keyword === 'old-page-owner').sameUrlCount, 1)

// Candidate indexes must keep empty/sparse recommendations independent of
// the size of unrelated site signals.
const noSubmissionMember = uid(99)
await db.query('insert into task_group_members values ($1,$2,$3)', [group, noSubmissionMember, 'No submissions'])
await claim('pending-not-submitted', { user: noSubmissionMember, status: 'pending' })
await db.query(`
  insert into keyword_signal_rollup
  select $1::uuid, 'unrelated-signal-' || key, 'rankdown', '2026-10-12'::date,
    null, 10, 50000, 'https://own.test/unrelated/' || key, 'Unrelated'
  from generate_series(1,100000) key
`, [own])
await db.exec('analyze keyword_signal_rollup; analyze member_claimed_keywords')
const emptyStart = performance.now()
assert.equal((await page('rankdown', 0, 20, [noSubmissionMember])).total, 0)
const emptyMemberMs = Math.round(performance.now() - emptyStart)
const sparseStart = performance.now()
const sparse = await page('rankdown')
assert.equal(sparse.rows.length, 20)
assert.equal(sparse.total, latestScope.total)
const sparseMemberMs = Math.round(performance.now() - sparseStart)
console.log(JSON.stringify({
  passed: true, recommendationRows: first.total, trackingHistoryRows: 30029, trackingDistinctRows: 1000,
  unrelatedSignals: 100000, emptyMemberMs, sparseMemberMs, fixtureMs: Math.round(performance.now() - started),
}))
await db.close()
