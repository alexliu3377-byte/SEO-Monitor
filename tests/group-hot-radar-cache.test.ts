import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshGroupHotRadarCache, groupHotRadarFilterHash } from '../lib/group-hot-radar-cache'

function mockDatabase(filtered = true, failed = false) {
  const global = { newWords: [{ keyword: '全局词',count: 99 }],rankWords: [],streakWords: [],volumeRisingWords: [{ keyword: '搜索量词',netChange: 10 }] }
  const scoped = {
    newWords: [{ keyword: '只在选站出现的词',count: 1,siteCount: 1,sites: ['a.com'],first_date: '2026-10-12',last_date: '2026-10-12' }],
    rankWords: [{ keyword: '选站涨词',rankDays: 2,volume: 50,sites: ['b.com'] }],streakWords: [],
  }
  const writes: unknown[] = []
  const calls: { name: string; args: unknown }[] = []
  const db = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: null,data:
        table === 'task_groups' ? { rank_domains: filtered ? ['B.COM'] : [],new_domains: filtered ? ['https://a.com/'] : [] } :
        table === 'wordlib_cache' ? { payload: [{ keyword: '全局词库' }] } : { payload: global,computed_at: '2026-10-13T01:00:00Z' },
      }) }) }),
      upsert: async (row: unknown) => { writes.push(row);return { error: null } },
    }),
    rpc: async (name: string,args: unknown) => {
      calls.push({ name,args })
      return { data: name === 'compute_scoped_hot_radar' ? scoped : [{ keyword: '选站词库',long_tail_count: 2 }],error: failed ? new Error('database unavailable') : null }
    },
  }
  return { db,writes,calls,global,scoped }
}

test('group rebuild uses selected-site aggregation rather than filtering a truncated global list', async () => {
  const { db,writes,calls,global,scoped } = mockDatabase()
  const result = await refreshGroupHotRadarCache(db,'group-a')
  assert.deepEqual(result?.payload.newWords,scoped.newWords)
  assert.deepEqual(result?.payload.rankWords,scoped.rankWords)
  assert.deepEqual(result?.payload.volumeRisingWords,global.volumeRisingWords)
  assert.deepEqual(result?.wordlib_payload,[{ keyword: '选站词库',long_tail_count: 2 }])
  assert.deepEqual(calls[0].args,{ p_rank_domains: ['b.com'],p_new_domains: ['a.com'],p_limit: 2000 })
  assert.equal(writes.length,1)
})

test('empty selections reuse shared results without recalculating the same SQL for every group', async () => {
  const { db,calls,global } = mockDatabase(false)
  const result = await refreshGroupHotRadarCache(db,'group-a')
  assert.deepEqual(result?.payload,global)
  assert.equal(calls.length,0)
})

test('a failed selected-site aggregation does not overwrite the previous group cache', async () => {
  const { db,writes } = mockDatabase(true,true)
  await assert.rejects(refreshGroupHotRadarCache(db,'group-a'),/database unavailable/)
  assert.equal(writes.length,0)
})

test('cache version hash is stable across formatting and selection order', () => {
  assert.equal(
    groupHotRadarFilterHash({ rankDomains: ['www.B.com','a.com'],newDomains: ['C.com'] }),
    groupHotRadarFilterHash({ rankDomains: ['https://a.com/','b.com'],newDomains: ['c.com'] }),
  )
})
