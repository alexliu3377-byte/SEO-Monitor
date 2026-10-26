import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { environmentSnapshotResponse } from '../lib/environment-snapshot'
import { monthlyTrendResponse } from '../lib/monthly-trend-data'

test('scheduled heavy caches run on runner and not Vercel refresh endpoints', () => {
  for (const file of ['derived-crawl-data', 'group-tracking-cache', 'environment-snapshot']) {
    const workflow = readFileSync(`.github/workflows/${file}.yml`, 'utf8')
    assert.match(workflow, /scripts\/refresh-derived-cache\.ts/)
    assert.doesNotMatch(workflow, /\/api\/(tracking-cache\/refresh|charts\/monthly-trend|environment\/daily-snapshot)/)
    assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/)
  }
  for (const file of ['derived-crawl-data', 'group-tracking-cache']) {
    assert.match(readFileSync(`.github/workflows/${file}.yml`, 'utf8'), /max-parallel: 2/)
  }
})

test('shared worker engines never require request cookies or proxy authentication', () => {
  for (const file of ['lib/environment-snapshot.ts', 'lib/monthly-trend-data.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /supabase-server|next\/headers|auth\.getUser/)
  }
  for (const file of ['app/api/charts/monthly-trend/route.ts', 'app/api/environment/daily-snapshot/route.ts']) {
    assert.match(readFileSync(file, 'utf8'), /auth\.getUser/)
  }
})

test('invalid environment dates fail before any database operation', async () => {
  for (const date of ['2026-02-30', '2026-13-01', 'yesterday', '2026-10-26T01:00:00Z']) {
    const service = new Proxy({}, { get() { throw new Error('Unexpected DB query') } })
    assert.equal((await environmentSnapshotResponse(service, date)).status, 400)
  }
})

test('environment input failures do not publish false zero counts', async () => {
  let writes = 0
  const query = { select() { return this }, eq() { return Promise.resolve({ data: [], error: null }) }, upsert() { writes++; throw new Error('Unexpected write') } }
  const service = { from() { return query }, async rpc() { return { data: null, error: { message: 'database unavailable' } } } }
  await assert.rejects(environmentSnapshotResponse(service, '2026-10-25'), /input query failed/)
  assert.equal(writes, 0)
})

test('environment aggregates preserve counts over the REST cap and publish the expected UTC day', async () => {
  const writes: { table: string; value: any }[] = []
  const service = {
    async rpc(name: string) {
      return { error: null, data: name === 'environment_rank_counts'
        ? [{ site_id: 'a', up_count: 5000, down_count: 6000 }]
        : [{ site_id: 'a', game_count: 3000, app_count: 1000 }] }
    },
    from(table: string) {
      assert.notEqual(table, 'raw_keywords')
      return {
        date: '',
        select() { return this },
        eq(_field: string, date: string) { this.date = date; return this },
        then(resolve: (result: unknown) => void) {
          resolve({ error: null, data: table === 'weight_history'
            ? [{ site_id: 'a', pc_weight: 1, mobile_weight: 1 }]
            : [{ site_id: 'a', index_count: this.date === '2026-10-25' ? 120 : 100 }] })
        },
        async upsert(value: unknown) { writes.push({ table, value }); return { error: null } },
      }
    },
  }
  const response = await environmentSnapshotResponse(service, '2026-10-25')
  const body = await response.json()
  assert.equal(body.total_rankup, 5000)
  assert.equal(body.total_rankdown, 6000)
  assert.equal(body.avg_index_change_pct, 20)
  assert.equal(body.weekday, 0)
  assert.equal(writes.at(-1)?.table, 'environment_daily')
})

test('monthly worker preserves authorization and future archive protection', async () => {
  const service = new Proxy({}, { get() { throw new Error('Unexpected DB query') } })
  assert.equal((await monthlyTrendResponse(service, new URLSearchParams({ refresh: '1' }))).status, 403)
  assert.equal((await monthlyTrendResponse(service, new URLSearchParams({ month: '2999-01' }), true)).status, 400)
})

test('radar only materializes the selected section and numbers the limited page', () => {
  const sql = readFileSync('supabase/migrations/20261026_radar_narrow_materialization.sql', 'utf8')
  assert.doesNotMatch(sql, /select \* from radar_daily_cache|rows as materialized|filtered as materialized|select item,row_number\(\) over\(order by/)
  assert.match(sql, /payload->\(case p_tab/)
  assert.match(sql, /paged as materialized/)
  assert.match(sql, /offset \(select page::bigint\*size from options\)/)
  assert.match(sql, /limit \(select size from options\)/)
  assert.match(sql, /row_number\(\) over\(\) as position from paged/)
  assert.doesNotMatch(sql, /delete from|update radar_daily_cache|truncate|alter default privileges/i)
})
