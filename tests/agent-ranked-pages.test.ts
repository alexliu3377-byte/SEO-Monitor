import assert from 'node:assert/strict'
import test from 'node:test'
import { createRankedPagesHandler, parseRankedPagesQuery, pageKey, pickPages, type RankedPagesService } from '../lib/agent-ranked-pages'
import { allowsServiceAuthPath } from '../lib/service-api-access'

const KEY = 'k'.repeat(32)
type Call = { table: string; filters: [string, unknown][]; range: [number, number] | null }

type Data = {
  words?: Record<string, unknown>[]
  sites?: { id: string; domain: string }[]
  ranks?: Record<string, unknown>[]
  failRanks?: boolean
}
function database(data: Data) {
  const calls: Call[] = []
  const service: RankedPagesService = {
    from(table: string) {
      return {
        select() {
          const call: Call = { table, filters: [], range: null }
          calls.push(call)
          const result = () => {
            if (table === 'keyword_volume') return { data: data.words ?? [], count: (data.words ?? []).length, error: null }
            if (table === 'sites') return { data: data.sites ?? [], error: null }
            if (table === 'site_keyword_ranks') {
              if (data.failRanks) return { data: null, error: { message: 'x' } }
              const site = call.filters.find(f => f[0] === 'eq:site_id')?.[1]
              const kwFilter = call.filters.find(f => f[0] === 'in:keyword')
              if (!kwFilter) return { data: (data.ranks ?? []).filter(r => r.site_id === site).slice(0, 1), error: null }   // 这个站有没有数据
              const kws = kwFilter[1] as string[]
              return { data: (data.ranks ?? []).filter(r => r.site_id === site && kws.includes(r.keyword as string)), error: null }
            }
            return { data: [], error: null }
          }
          const q: any = {
            eq(c: string, v: unknown) { call.filters.push([`eq:${c}`, v]); return q },
            in(c: string, v: unknown[]) { call.filters.push([`in:${c}`, v]); return q },
            gt(c: string, v: unknown) { call.filters.push([`gt:${c}`, v]); return q },
            gte(c: string, v: unknown) { call.filters.push([`gte:${c}`, v]); return q },
            lte(c: string, v: unknown) { call.filters.push([`lte:${c}`, v]); return q },
            not(c: string, o: string, v: unknown) { call.filters.push([`not:${c}:${o}`, v]); return q },
            order() { return q },
            range(a: number, b: number) { call.range = [a, b]; return q },
            limit() { return q },
            then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(result()).then(res, rej) },
          }
          return q
        },
      }
    },
  }
  return { service, calls }
}
const word = (keyword: string, category = '游戏', volume = 300, sub: string | null = null) => ({ keyword, volume, content_category: category, content_subcategory: sub })
const rank = (keyword: string, site_id: string, url: string, title: string, rank_position = 5, stat_date = '2026-11-18') => ({ keyword, site_id, url, title, rank_position, stat_date })
const handler = (data: Data, ...keys: (string | undefined)[]) => {
  const db = database(data)
  return { ...db, GET: createRankedPagesHandler({ getService: () => db.service, getKeys: () => (keys.length ? keys : [KEY]), now: () => Date.parse('2026-11-19T00:00:00Z') }) }
}
const request = (query = '', authorization: string | null = `Bearer ${KEY}`) =>
  new Request(`https://example.test/api/agent/ranked-pages${query}`, { headers: authorization ? { authorization } : {} })

test('ranked pages: 没配置密钥或密钥太短返回 503，密钥不对返回 401，都不查数据库', async () => {
  for (const keys of [[''], ['short'], [undefined]]) {
    const { GET, calls } = handler({}, ...keys)
    assert.equal((await GET(request())).status, 503)
    assert.equal(calls.length, 0)
  }
  const { GET, calls } = handler({})
  assert.equal((await GET(request('', 'Bearer ' + 'z'.repeat(40)))).status, 401)
  assert.equal((await GET(request('', null))).status, 401)
  assert.equal(calls.length, 0)
})

test('ranked pages: 查询参数有范围：搜索量上限默认 1000、至少 2 个页面、每次最多扫 200 个词', () => {
  const d = parseRankedPagesQuery(new URL('https://x.test/a'))
  assert.deepEqual(d, { offset: 0, limit: 100, maxVolume: 1000, minPages: 2, days: 30 })
  const big = parseRankedPagesQuery(new URL('https://x.test/a?limit=9999&maxVolume=0&minPages=99&days=999&offset=-5'))
  assert.deepEqual(big, { offset: 0, limit: 200, maxVolume: 1, minPages: 5, days: 40 })
})

test('ranked pages: 带页面的词按搜索量顺序返回，页面不够 minPages 的不返回；自己的站点也算；排名表里没数据的站不查', async () => {
  const { GET, calls } = handler({
    words: [word('塔防传奇', '游戏', 900), word('云盘', '应用', 500), word('孤页游戏', '游戏', 300)],
    sites: [{ id: 's1', domain: 'a-down.com' }, { id: 's2', domain: 'b-down.com' }, { id: 'own', domain: 'mine.com' }, { id: 'empty', domain: 'nodata.com' }],
    ranks: [
      rank('塔防传奇', 's1', 'https://m.a-down.com/game/1.html', '塔防传奇下载'),
      rank('塔防传奇', 's2', 'https://www.b-down.com/g/9', '塔防传奇安卓版', 3),
      rank('塔防传奇', 'own', 'https://mine.com/x', '自己的页面'),
      rank('云盘', 's1', 'https://a-down.com/app/7.html', '云盘下载'),
      rank('孤页游戏', 's1', 'https://a-down.com/game/2.html', '孤页游戏下载'),
    ],
  })
  const body = await (await GET(request())).json()
  assert.deepEqual(body.words.map((w: { keyword: string }) => w.keyword), ['塔防传奇'])   // 云盘、孤页游戏只有 1 个页面
  const w = body.words[0]
  assert.equal(w.contentType, 'game'); assert.equal(w.volume, 900)
  assert.deepEqual(w.pages.map((p: { site: string }) => p.site).sort(), ['a-down.com', 'b-down.com', 'mine.com'])   // 自己的站点 mine.com 也在
  const rankCalls = calls.filter(c => c.table === 'site_keyword_ranks' && c.filters.some(f => f[0] === 'in:keyword'))
  assert.equal(rankCalls.some(c => c.filters.some(f => f[0] === 'eq:site_id' && f[1] === 'empty')), false)   // 没有数据的站不查词
  await GET(request())   // 第二次请求：站点列表用缓存，不再逐站查有没有数据
  assert.equal(calls.filter(c => c.table === 'sites').length, 1)
  assert.equal(body.scanned, 3); assert.equal(body.nextOffset, 3); assert.equal(body.end, true)
  const one = await (await GET(request('?minPages=1'))).json()
  assert.deepEqual(one.words.map((x: { keyword: string }) => x.keyword), ['塔防传奇', '云盘', '孤页游戏'])
})

test('ranked pages: 只查「已确认分类的游戏和应用词、搜索量 1 到上限」；排名表只看有链接、最近 N 天的（手机版电脑版都要）', async () => {
  const { GET, calls } = handler({ words: [word('塔防传奇')], sites: [{ id: 's1', domain: 'a-down.com' }], ranks: [] })
  await GET(request('?maxVolume=500&days=10&offset=200&limit=50'))
  const lib = calls.find(c => c.table === 'keyword_volume')!
  assert.deepEqual(lib.filters, [['eq:classification_status', 'confirmed'], ['in:content_category', ['游戏', '应用']], ['gt:volume', 0], ['lte:volume', 500]])
  assert.deepEqual(lib.range, [200, 249])
  const rk = calls.find(c => c.table === 'site_keyword_ranks')!
  assert.ok(rk.filters.some(f => f[0] === 'eq:site_id' && f[1] === 's1'))
  assert.equal(rk.filters.some(f => f[0] === 'eq:platform'), false)   // 手机版和电脑版的排名都要
  assert.ok(rk.filters.some(f => f[0] === 'not:url:is'))
  assert.ok(rk.filters.some(f => f[0] === 'gte:stat_date' && f[1] === '2026-11-09'))
})

test('ranked pages: 排名表查询失败就整体报错，不拿残缺页面当完整的；不泄露数据库信息', async () => {
  const { GET } = handler({ words: [word('塔防传奇')], sites: [{ id: 's1', domain: 'a.com' }], failRanks: true })
  const res = await GET(request())
  assert.equal(res.status, 503)
  assert.deepEqual(await res.json(), { error: '排名词读取失败，请稍后重试' })
})

test('ranked pages: 页面整理——www./m./wap. 和末尾斜杠算同一页；标题带词的排前面；每个站先出一个', () => {
  assert.equal(pageKey('https://m.a-down.com/g/1/')?.key, pageKey('http://www.a-down.com/g/1')?.key)
  assert.equal(pageKey('javascript:alert(1)'), null)
  assert.equal(pageKey('https://localhost/x'), null)
  const sites = new Map([['s1', 'a-down.com'], ['s2', 'b-down.com']])
  const pages = pickPages('塔防传奇', [
    rank('塔防传奇', 's1', 'https://a-down.com/g/1', '无关标题', 1),
    rank('塔防传奇', 's1', 'https://m.a-down.com/g/1/', '塔防传奇下载', 4, '2026-11-17'),   // 同一页：合并，取最好名次 1、最近日期
    rank('塔防传奇', 's1', 'https://a-down.com/g/2', '塔防传奇破解版', 2),
    rank('塔防传奇', 's2', 'https://b-down.com/g/3', '塔防传奇下载', 9),
  ], sites)
  assert.equal(pages.length, 3)
  assert.equal(pages[0].site, 'a-down.com')        // 标题带词、名次最好
  assert.equal(pages[1].site, 'b-down.com')        // 第二个站排第二（每个站先出一个）
  assert.equal(pages.filter(p => p.url.includes('/g/1')).length, 1)
  assert.equal(pages.find(p => p.url.includes('/g/1'))?.rank, 1)
})

test('ranked pages: 同一页有手机版和电脑版地址时留电脑版的', () => {
  const sites = new Map([['s1', 'a-down.com']])
  const pages = pickPages('塔防传奇', [
    rank('塔防传奇', 's1', 'https://m.a-down.com/g/1.html', '塔防传奇下载', 3),
    rank('塔防传奇', 's1', 'https://www.a-down.com/g/1.html', '塔防传奇下载', 5),
  ], sites)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].url, 'https://www.a-down.com/g/1.html')
  assert.equal(pages[0].rank, 3)   // 名次取最好的
})

test('ranked pages: 同一个站、标题一样的页面只留一个（名次最好的）', () => {
  const sites = new Map([['s1', 'a-down.com']])
  const pages = pickPages('塔防传奇', [
    rank('塔防传奇', 's1', 'https://a-down.com/az/1.html', '塔防传奇下载', 11),
    rank('塔防传奇', 's1', 'https://a-down.com/an/1.html', '塔防传奇下载', 4),
    rank('塔防传奇', 's1', 'https://a-down.com/an/2.html', '塔防传奇安卓版', 8),
  ], sites)
  assert.equal(pages.length, 2)
  assert.equal(pages.find(p => p.title === '塔防传奇下载')?.rank, 4)
})

test('ranked pages: 在服务接口白名单里（用专用密钥，不走登录）', () => {
  assert.equal(allowsServiceAuthPath('/api/agent/ranked-pages'), true)
  assert.equal(allowsServiceAuthPath('/api/agent/other'), false)
})
