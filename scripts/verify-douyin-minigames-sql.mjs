import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
const db = new PGlite()
const boards = ['new', 'hot', 'grossing']
const rows = (size = 50, title = '游戏') => boards.flatMap(board => Array.from({ length: size }, (_, index) => ({ board, rank: index + 1,
  gameId: `tt${(index + 1).toString(16).padStart(18, '0')}`, title: `${title}${index + 1}`, summary: '简介' })))
try {
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(await readFile(new URL('../supabase/migrations/20261021_douyin_minigame_rankings.sql', import.meta.url), 'utf8'))
  const call = (time, items) => db.query('select replace_douyin_minigame_rankings($1::timestamptz,$2::jsonb) as accepted', [time, JSON.stringify(items)])
  assert.equal((await call('2026-10-20T01:00:00Z', rows())).rows[0].accepted, 150)
  assert.equal((await call('2026-10-20T01:00:00Z', rows(2, '旧任务'))).rows[0].accepted, 0)
  assert.equal((await call('2026-10-19T01:00:00Z', rows(2, '历史'))).rows[0].accepted, 6)
  await assert.rejects(call('2026-10-20T02:00:00Z', rows().slice(1)))
  await assert.rejects(call('2026-10-20T02:00:00Z', rows().map(row => ({ ...row, gameId: 'bad-id' }))))
  await assert.rejects(call('2026-10-20T02:00:00Z', rows().map(row => ({ ...row, summary: 'x'.repeat(501) }))))
  assert.equal((await db.query("select item_count from douyin_minigame_collections where snapshot_date='2026-10-20'")).rows[0].item_count, 150)
  const page = await db.query("select rank,title from douyin_minigame_rankings where snapshot_date='2026-10-20' and board='new' order by rank offset 20 limit 20")
  assert.equal(page.rows.length, 20); assert.equal(page.rows[0].rank, 21); assert.equal(page.rows[19].rank, 40)
  assert.equal(page.rows[0].title, '游戏21')
  const read=(await db.query("select get_douyin_minigame_page('new',2) as payload")).rows[0].payload
  assert.equal(read.items.length,20);assert.equal(read.items[0].rank,21);assert.equal(read.total,50)
  assert.equal(Date.parse(read.collectedAt),Date.parse('2026-10-20T01:00:00Z'))
  const permission = (await db.query("select has_function_privilege('authenticated','replace_douyin_minigame_rankings(timestamptz,jsonb)','EXECUTE') as browser,has_function_privilege('service_role','replace_douyin_minigame_rankings(timestamptz,jsonb)','EXECUTE') as worker")).rows[0]
  assert.equal(permission.browser, false); assert.equal(permission.worker, true)
  assert.equal((await call('2026-10-20T03:00:00Z', rows(100, '新结果'))).rows[0].accepted, 300)
  assert.equal((await db.query("select count(*)::int as n from douyin_minigame_rankings where snapshot_date='2026-10-20'")).rows[0].n, 300)
  assert.equal((await db.query('select count(*)::int as n from douyin_minigame_collections')).rows[0].n, 2)
  console.log(JSON.stringify({ atomicPublishing: true, rollbackPreservesSuccess: true, staleRunIgnored: true, historicalSnapshotKept: true, databasePaging20: true, serviceOnlyWrites: true, productionWrites: 0 }))
} finally { await db.close() }
