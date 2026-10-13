// Isolated PostgreSQL verification; this script never contacts production.
// Set PGLITE_MODULE_PATH to a temporary @electric-sql/pglite dist/index.js.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
const db = new PGlite()
const group = '00000000-0000-4000-8000-000000000001'
const missingGroup = '00000000-0000-4000-8000-000000000002'
const signature = 'get_wordlib_cache_page(uuid,text,integer,integer,text,date,date,date,integer,integer,text,text,text,date)'
const item = (keyword, count = 2, sites = ['a.test'], date = '2026-10-12') => ({
  keyword, long_tail_count: count, site_count: sites.length, sites, last_date: date,
})

async function page({ groupId = null, hash = null, index = 0, size = 20, keyword = '',
  date = null, start = null, end = null, minLongTail = 2, minSites = 1,
  site = '', sort = 'date', direction = 'desc' } = {}) {
  const { rows } = await db.query('select get_wordlib_cache_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as result',
    [groupId, hash, index, size, keyword, date, start, end, minLongTail, minSites, site, sort, direction, '2026-10-13'])
  return rows[0].result
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table wordlib_cache(id text primary key, payload jsonb, computed_at timestamptz);
    create table group_hot_radar_cache(group_id uuid primary key, wordlib_payload jsonb, filter_hash text, computed_at timestamptz);
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261013_wordlib_pagination.sql', import.meta.url), 'utf8'))
  const missing = await page()
  assert.equal(missing.cacheReady, false, 'missing global cache must not masquerade as generated empty data')
  assert.deepEqual(missing.data, [])

  const fixture = [
    item('昨日高长尾', 10, ['a.test', 'b.test']),
    item('今天批次', 20, ['a.test'], '2026-10-13'),
    item('较旧内容', 99, ['b.test', 'c.test', 'd.test'], '2026-10-11'),
    item('100%_游戏', 5, ['EXAMPLE.Test']),
    item('低于门槛', 1),
    ...Array.from({ length: 25 }, (_, n) => item('分页-' + String(n).padStart(2, '0'), 2)),
  ]
  await db.query('insert into wordlib_cache values ($1,$2,$3)', ['latest', JSON.stringify(fixture), '2026-10-13T00:05:00Z'])
  const first = await page()
  const second = await page({ index: 1 })
  assert.equal(first.cacheReady, true)
  assert.equal(first.total, 29)
  assert.equal(first.data.length, 20)
  assert.equal(second.data.length, 9)
  assert.equal(new Set([...first.data, ...second.data].map(row => row.keyword)).size, first.total)
  assert.equal(first.data[0].keyword, '今天批次')
  assert.equal(first.data[0].last_date, '2026-10-13', 'the raw last_date is preserved, only the filtering date is normalized')
  assert.deepEqual(first.availableDates, ['2026-10-12', '2026-10-11'])
  assert.equal(first.availableSites.includes('d.test'), true, 'site/date metadata covers the full cache')
  assert.deepEqual(Object.keys(first.data[0]).sort(), ['keyword', 'last_date', 'long_tail_count', 'site_count', 'sites'])
  const outside = await page({ index: 500 })
  assert.equal(outside.total, 29)
  assert.deepEqual(outside.data, [])

  const yesterday = await page({ date: '2026-10-12', size: 100 })
  assert.equal(yesterday.total, 28, 'today batches match yesterday before pagination')
  assert.equal(yesterday.data.some(row => row.keyword === '今天批次'), true)
  assert.equal((await page({ date: '2026-10-13' })).total, 0)
  assert.deepEqual((await page({ start: '2026-10-11', end: '2026-10-11' })).data.map(row => row.keyword), ['较旧内容'])
  assert.deepEqual((await page({ keyword: '%_' })).data.map(row => row.keyword), ['100%_游戏'], 'search wildcards must stay literal')
  assert.deepEqual((await page({ site: 'example' })).data.map(row => row.keyword), ['100%_游戏'], 'site search is case-insensitive substring matching')
  assert.deepEqual((await page({ site: '%' })).data, [], 'site wildcard characters also remain literal')
  assert.deepEqual((await page({ minLongTail: 10, minSites: 2 })).data.map(row => row.keyword), ['昨日高长尾', '较旧内容'])
  assert.deepEqual((await page({ sort: 'longTailCount', direction: 'desc', size: 2 })).data.map(row => row.keyword), ['较旧内容', '今天批次'])
  assert.deepEqual((await page({ sort: 'siteCount', direction: 'desc', size: 2 })).data.map(row => row.keyword), ['较旧内容', '昨日高长尾'])
  assert.equal((await page({ sort: 'date', direction: 'asc', size: 1 })).data[0].keyword, '较旧内容')
  const ascending = await page({ sort: 'keyword', direction: 'asc', size: 100 })
  const descending = await page({ sort: 'keyword', direction: 'desc', size: 100 })
  assert.deepEqual(descending.data.map(row => row.keyword), ascending.data.map(row => row.keyword).reverse())

  await db.query('insert into group_hot_radar_cache values ($1,$2,$3,$4)',
    [group, JSON.stringify([item('该组专属词', 4, ['group.test'])]), 'valid-hash', '2026-10-13T00:10:00Z'])
  assert.deepEqual((await page({ groupId: group, hash: 'valid-hash' })).data.map(row => row.keyword), ['该组专属词'])
  assert.equal((await page({ groupId: group, hash: 'old-hash' })).cacheReady, false, 'edited filters cannot use a stale scope')
  assert.equal((await page({ groupId: group })).cacheReady, false, 'group requests require the server-calculated hash')
  assert.equal((await page({ groupId: missingGroup, hash: 'valid-hash' })).cacheReady, false)
  await db.query('update group_hot_radar_cache set wordlib_payload=$1 where group_id=$2', ['[]', group])
  const empty = await page({ groupId: group, hash: 'valid-hash' })
  assert.equal(empty.cacheReady, true, 'a computed empty scope is valid and should not rebuild repeatedly')
  assert.equal(empty.total, 0)

  for (const role of ['anon', 'authenticated', 'service_role']) {
    const { rows } = await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, signature])
    assert.equal(rows[0].allowed, role === 'service_role', 'the RPC is callable only by the service role')
  }

  // Similar row count and payload size to production. Matching a late row
  // proves filters apply across all cache records, not only the first page.
  await db.exec(`
    update wordlib_cache set payload = (
      select jsonb_agg(jsonb_build_object(
        'keyword', case when n=13913 then 'rare-outside-first-page' else '历史关键词-' || lpad(n::text, 5, '0') end,
        'long_tail_count', 2+(n%99), 'site_count', 4,
        'sites', jsonb_build_array('a.long-domain.test','b.long-domain.test','c.long-domain.test','d.long-domain.test'),
        'last_date', (date '2026-10-12'-(n%30))::text
      )) from generate_series(1,13913) n
    ) where id='latest';
  `)
  await page()
  const elapsed = []
  let productionLike
  for (let run = 0; run < 5; run++) {
    const started = performance.now()
    productionLike = await page({ index: run })
    elapsed.push(Math.round(performance.now() - started))
  }
  assert.equal(productionLike.total, 13913)
  assert.equal(productionLike.data.length, 20)
  assert.deepEqual((await page({ keyword: 'rare-outside-first-page' })).data.map(row => row.keyword), ['rare-outside-first-page'])
  assert.deepEqual((await page({ keyword: 'RARE-OUTSIDE-FIRST-PAGE' })).data.map(row => row.keyword), ['rare-outside-first-page'],
    'keyword search preserves the hot-radar UI case-insensitive behavior')
  const filteredLarge = await page({ keyword: '历史关键词-13', date: '2026-10-12', minLongTail: 50 })
  assert.equal(filteredLarge.data.every(row => row.long_tail_count >= 50 && row.last_date === '2026-10-12'), true)
  const { rows } = await db.query('select octet_length(payload::text) as bytes from wordlib_cache where id=$1', ['latest'])
  console.log(JSON.stringify({ ok: true, rows: 13913, cacheBytes: rows[0].bytes,
    pageBytes: JSON.stringify(productionLike).length, queryTimesMs: elapsed }, null, 2))
} finally {
  await db.close()
}
