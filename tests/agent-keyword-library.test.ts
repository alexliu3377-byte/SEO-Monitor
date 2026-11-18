import assert from 'node:assert/strict'
import test from 'node:test'
import { createKeywordLibraryHandler, parseKeywordLibraryQuery, type KeywordLibraryService } from '../lib/agent-keyword-library'
import { allowsServiceAuthPath } from '../lib/service-api-access'

const KEY = 'k'.repeat(32)
type Call = { table: string; columns: string; options: unknown; filters: [string, unknown][]; orders: [string, unknown][]; range: [number, number] | null }

function database(rows: unknown[], options: { count?: number | null; error?: unknown; throws?: boolean } = {}) {
  const calls: Call[] = []
  const service: KeywordLibraryService = {
    from(table) {
      return {
        select(columns, selectOptions) {
          const call: Call = { table, columns, options: selectOptions, filters: [], orders: [], range: null }
          calls.push(call)
          const query = {
            eq(column: string, value: string) { call.filters.push([`eq:${column}`, value]); return query },
            in(column: string, values: string[]) { call.filters.push([`in:${column}`, values]); return query },
            order(column: string, orderOptions: unknown) { call.orders.push([column, orderOptions]); return query },
            range(from: number, to: number) {
              call.range = [from, to]
              if (options.throws) throw new Error('private database diagnostics')
              return Promise.resolve({ data: rows, count: options.count === undefined ? rows.length : options.count, error: options.error ?? null })
            },
          }
          return query
        },
      }
    },
  }
  return { service, calls }
}
const handler = (rows: unknown[], options = {}, ...keys: (string | undefined)[]) => {
  const db = database(rows, options)
  return { ...db, GET: createKeywordLibraryHandler({ getService: () => db.service, getKeys: () => (keys.length ? keys : [KEY]) }) }
}
const request = (query = '', authorization: string | null = `Bearer ${KEY}`) =>
  new Request(`https://example.test/api/agent/keyword-library${query}`, { headers: authorization ? { authorization } : {} })
const row = (keyword: string, category: string, volume: number | null, sub: string | null = null) => ({ keyword, volume, content_category: category, content_subcategory: sub })

test('keyword library feed: 没配置密钥或密钥太短时返回 503，不查数据库', async () => {
  for (const keys of [[''], ['short'], [undefined, undefined], ['', 'short']]) {
    const { GET, calls } = handler([], {}, ...keys)
    const response = await GET(request())
    assert.equal(response.status, 503)
    assert.equal(calls.length, 0)
  }
})

test('keyword library feed: 专用密钥和已有的推荐词密钥都能用；没配置好的那个不算', async () => {
  const OTHER = 'o'.repeat(40)
  const { GET } = handler([], {}, KEY, OTHER)
  assert.equal((await GET(request('', `Bearer ${KEY}`))).status, 200)
  assert.equal((await GET(request('', `Bearer ${OTHER}`))).status, 200)
  assert.equal((await GET(request('', `Bearer ${'z'.repeat(40)}`))).status, 401)
  const only = handler([], {}, undefined, OTHER)
  assert.equal((await only.GET(request('', `Bearer ${OTHER}`))).status, 200)
  assert.equal((await only.GET(request('', `Bearer ${KEY}`))).status, 401)
})

test('keyword library feed: 没带密钥或密钥不对返回 401，不查数据库', async () => {
  const { GET, calls } = handler([])
  assert.equal((await GET(request('', null))).status, 401)
  assert.equal((await GET(request('', 'Bearer wrong'))).status, 401)
  assert.equal((await GET(request('', `Bearer ${'x'.repeat(32)}`))).status, 401)
  assert.equal((await GET(request('', KEY))).status, 401)
  assert.equal(calls.length, 0)
})

test('keyword library feed: 只取已确认的游戏和应用，按搜索量从高到低，不分站点也不看补充状态', async () => {
  const { GET, calls } = handler([row('元梦之星', '游戏', 90000, '休闲'), row('TapTap', '游戏', 50000, '游戏盒子'), row('微信', '应用', null, '社交')], { count: 1234 })
  const response = await GET(request('?limit=3'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.words, [
    { keyword: '元梦之星', contentType: 'game', category: '游戏', subcategory: '休闲', volume: 90000 },
    { keyword: 'TapTap', contentType: 'game', category: '游戏', subcategory: '游戏盒子', volume: 50000 },
    { keyword: '微信', contentType: 'app', category: '应用', subcategory: '社交', volume: null },
  ])
  assert.equal(body.total, 1234)
  assert.equal(body.order, 'volume_desc')
  const call = calls[0]
  assert.equal(call.table, 'keyword_volume')
  assert.deepEqual(call.filters, [['eq:classification_status', 'confirmed'], ['in:content_category', ['游戏', '应用']]])
  assert.deepEqual(call.orders, [['volume', { ascending: false, nullsFirst: false }], ['keyword', { ascending: true }]])
  assert.deepEqual(call.range, [0, 2])
  // 不读、不筛站点和补充状态的字段
  assert.ok(!/layout/.test(call.columns))
  assert.ok(!call.filters.some(([name]) => /layout/.test(name)))
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('keyword library feed: 分类、条数、起点参数；条数最多 500，起点从 0 起', async () => {
  assert.deepEqual(parseKeywordLibraryQuery(new URL('https://x.test/?category=游戏')), { categories: ['游戏'], limit: 200, offset: 0 })
  assert.deepEqual(parseKeywordLibraryQuery(new URL('https://x.test/?category=app&limit=9999&offset=-5')), { categories: ['应用'], limit: 500, offset: 0 })
  assert.deepEqual(parseKeywordLibraryQuery(new URL('https://x.test/?category=all&limit=0&offset=400')), { categories: ['游戏', '应用'], limit: 1, offset: 400 })
  assert.deepEqual(parseKeywordLibraryQuery(new URL('https://x.test/?limit=abc')), { categories: ['游戏', '应用'], limit: 200, offset: 0 })
  assert.equal(parseKeywordLibraryQuery(new URL('https://x.test/?category=专题')), null)
  const { GET, calls } = handler([])
  assert.equal((await GET(request('?category=专题'))).status, 400)
  assert.equal(calls.length, 0)
  await GET(request('?category=应用&limit=50&offset=100'))
  assert.deepEqual(calls[0].filters[1], ['in:content_category', ['应用']])
  assert.deepEqual(calls[0].range, [100, 149])
})

test('keyword library feed: 不合格的行（空词、过长、有控制字符、别的分类）直接丢掉', async () => {
  const { GET } = handler([
    row('正常的词', '游戏', 10),
    row('   ', '游戏', 10),
    row('长'.repeat(101), '游戏', 10),
    row('带<尖括号>', '应用', 10),
    row('专题词', '专题', 10),
    { keyword: 123, volume: 1, content_category: '游戏' },
    null,
    row('  有空格的词  ', '应用', Number.NaN, '  '),
  ])
  const body = await (await GET(request())).json()
  assert.deepEqual(body.words.map((word: { keyword: string }) => word.keyword), ['正常的词', '有空格的词'])
  assert.equal(body.words[1].volume, null)
  assert.equal(body.words[1].subcategory, null)
})

test('keyword library feed: 数据库出错只返回通用提示，不泄露内部信息', async () => {
  for (const options of [{ error: { message: 'private database diagnostics' } }, { throws: true }]) {
    const { GET } = handler([], options)
    const response = await GET(request())
    assert.equal(response.status, 503)
    assert.ok(!(await response.text()).includes('private'))
  }
})

test('keyword library feed: 这个路径走密钥认证，不走登录；同目录别的路径不放行', () => {
  assert.equal(allowsServiceAuthPath('/api/agent/keyword-library'), true)
  assert.equal(allowsServiceAuthPath('/api/agent/word-feed'), true)
  assert.equal(allowsServiceAuthPath('/api/agent/other'), false)
  assert.equal(allowsServiceAuthPath('/api/agent'), false)
})
