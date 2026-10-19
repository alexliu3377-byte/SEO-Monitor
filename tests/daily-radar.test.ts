import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { radarDate, radarDates, validRadarDate } from '../lib/radar-dates'
import { radarScope, refreshDailyRadarCaches } from '../lib/radar-daily'
import { isUpdateTask, normalizeTaskUrl, taskClaimIdentity } from '../lib/task-claim-identity'

test('radar dates retain exactly seven dates including today in Malaysia time', () => {
  const now = Date.parse('2026-10-18T16:00:00Z')
  assert.equal(radarDate(0, now), '2026-10-19')
  assert.equal(radarDate(-1, now), '2026-10-18')
  assert.deepEqual(radarDates(now), ['2026-10-19','2026-10-18','2026-10-17','2026-10-16','2026-10-15','2026-10-14','2026-10-13'])
  assert.equal(validRadarDate('2026-10-13',now),true)
  for (const date of ['2026-10-20','2026-10-12','2026-10-11','2026-02-30','2026-10-19T00:00:00Z','']) assert.equal(validRadarDate(date,now),false)
})

test('update claims match pages, not another page with the same keyword', () => {
  assert.equal(normalizeTaskUrl('https://www.f71.com/app/1.html#section'), 'f71.com/app/1.html')
  assert.equal(taskClaimIdentity('词甲','https://www.f71.com/app/1.html','更新'),taskClaimIdentity('词乙','http://m.f71.com/app/1.html','更新'))
  assert.notEqual(taskClaimIdentity('7723游戏盒','f71.com/app/1.html','更新'),taskClaimIdentity('7723游戏盒','f71.com/app/2.html','更新'))
  assert.equal(taskClaimIdentity('小红书',null,'新增'),'keyword:小红书')
  assert.equal(isUpdateTask(null,'跌词更新'),true)
  assert.equal(isUpdateTask('覆盖'),true)
  assert.equal(normalizeTaskUrl('https://user:password@example.com/a'),'')
  assert.notEqual(normalizeTaskUrl('https://example.com:8080/a'),normalizeTaskUrl('https://example.com:8443/a'))
})

test('backfill builds every date and distinct group scope once, then prunes only caches', async () => {
  const calls: { name: string; args?: Record<string, unknown> }[] = []
  const db = {
    from: (table: string) => {
      assert.equal(table,'task_groups')
      return { select: async () => ({ data: [
        { id:'a',rank_domains:['B.COM'],new_domains:['a.com'] },
        { id:'b',rank_domains:['b.com'],new_domains:['a.com'] },
        { id:'c',rank_domains:[],new_domains:[] },
      ],error:null }) }
    },
    rpc: async (name: string,args?: Record<string,unknown>) => { calls.push({name,args});return {data:name.startsWith('prune')?2:{counts:{}},error:null} },
  }
  const result = await refreshDailyRadarCaches(db,{days:7})
  assert.deepEqual(result,{dates:7,scopes:2,refreshed:14,removed:2})
  assert.equal(calls.at(-1)?.name,'prune_daily_radar_cache')
  assert.deepEqual([...new Set(calls.slice(0,-1).map(c=>c.args?.p_date))],radarDates().reverse())
  assert.equal(radarScope(['B.COM'],['a.com']).key,radarScope(['b.com'],['a.com']).key)
})

test('page GET reads a bounded cache page and never rebuilds it inside Vercel', () => {
  const source = readFileSync('app/api/radar-daily/route.ts','utf8')
  assert.match(source,/auth\.getUser/)
  assert.match(source,/canAccessTaskGroup/)
  assert.match(source,/validRadarDate/)
  assert.match(source,/rpc\('get_daily_radar_page'/)
  assert.doesNotMatch(source,/rpc\('refresh|refreshDailyRadarCaches/)
  assert.match(source,/private, no-store/)
})
