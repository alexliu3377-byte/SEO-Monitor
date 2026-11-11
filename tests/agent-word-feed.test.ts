import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWordFeed, createWordFeedHandler, malaysiaDate, type WordFeed } from '../lib/agent-word-feed'
import { allowsServiceAuthPath } from '../lib/service-api-access'

const now = Date.parse('2026-11-11T04:00:00.000Z') // 马来西亚 2026-11-11 12:00
const secret = 'a'.repeat(40)

test('推荐词：搜索量上涨、多站新词、多竞品站新增算热词；同词合并；电脑版排除', () => {
  const feed = buildWordFeed({
    volumeRisingWords: [{ keyword: '甲游戏', volume: 900, prevVolume: 100, change: 800, baselineVolume: 100, baselineDate: '2026-11-01', netChange: 800, last_date: '2026-11-10', sites: [], rankTrend: null }],
    newWords: [
      { keyword: '乙游戏', count: 3, siteCount: 3, sites: ['a', 'b', 'c'], last_date: '2026-11-10', first_date: '2026-11-09' },
      { keyword: '丙游戏', count: 1, siteCount: 1, sites: ['a'], last_date: '2026-11-10', first_date: '2026-11-10' },
    ],
    rankWords: [{ keyword: '甲游戏', siteCount: 2, volume: 900, sites: [], last_date: '', first_date: '', rankDays: 3 }],
    streakWords: [],
  }, [
    { keyword: '丁游戏', content_type: 'game', site_id: 's1' },
    { keyword: '丁游戏', content_type: 'game', site_id: 's2' },
    { keyword: '戊应用', content_type: 'app', site_id: 's1' },
    { keyword: '己游戏电脑版', content_type: 'game', site_id: 's1' },
  ], { date: '2026-11-10', now })
  const by = Object.fromEntries(feed.words.map(w => [w.keyword, w]))
  assert.equal(by['甲游戏'].hot, true)
  assert.match(by['甲游戏'].reason, /搜索量上涨.*；.*排名词/)
  assert.equal(by['乙游戏'].hot, true)
  assert.equal(by['丙游戏'].hot, false)
  assert.equal(by['丁游戏'].hot, true)
  assert.equal(by['丁游戏'].contentType, 'game')
  assert.equal(by['戊应用'].hot, false)
  assert.equal(by['己游戏电脑版'], undefined)
  assert.deepEqual(feed.counts, { hot: 3, total: 5 })
  assert.equal(feed.words[0].hot, true, '热词排在前面')
})

test('推荐词接口：没设密钥就关闭；密钥不对 401；默认取马来西亚昨天；日期只能最近 7 天', async () => {
  const dates: string[] = []
  const load = async (date: string): Promise<WordFeed> => { dates.push(date); return { date, generatedAt: '', words: [], counts: { hot: 0, total: 0 } } }
  const req = (auth: string | null, query = '') => new Request('https://x.test/api/agent/word-feed' + query, { headers: auth ? { authorization: auth } : {} })
  assert.equal((await createWordFeedHandler({ secret: undefined, load, now: () => now })(req('Bearer x'))).status, 503)
  assert.equal((await createWordFeedHandler({ secret: 'short', load, now: () => now })(req('Bearer short'))).status, 503)
  const handler = createWordFeedHandler({ secret, load, now: () => now })
  assert.equal((await handler(req(null))).status, 401)
  assert.equal((await handler(req('Bearer ' + 'b'.repeat(40)))).status, 401)
  const ok = await handler(req('Bearer ' + secret))
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  assert.deepEqual(dates, ['2026-11-10'])
  assert.equal((await handler(req('Bearer ' + secret, '?date=2026-11-01'))).status, 400)
  assert.equal((await handler(req('Bearer ' + secret, '?date=bad'))).status, 400)
  assert.equal((await handler(req('Bearer ' + secret, '?date=2026-11-08'))).status, 200)
  const failing = createWordFeedHandler({ secret, load: async () => { throw new Error('db down') }, now: () => now })
  assert.equal((await failing(req('Bearer ' + secret))).status, 503)
  assert.equal(malaysiaDate(-1, now), '2026-11-10')
})

test('推荐词接口在服务访问白名单里（不需要用户登录，但要专用密钥）', () => {
  assert.equal(allowsServiceAuthPath('/api/agent/word-feed'), true)
  assert.equal(allowsServiceAuthPath('/api/agent/other'), false)
})
