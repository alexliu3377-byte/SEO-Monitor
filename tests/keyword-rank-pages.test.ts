import assert from 'node:assert/strict'
import test from 'node:test'
import { buildExportCsv } from '../lib/keyword-rank-pages-csv'
import { parseExportQuery, readExportPage, type ExportService } from '../lib/keyword-rank-pages-export'
import { refreshKeywordRankPages } from '../scripts/refresh-keyword-rank-pages'

type Call = { table: string; filters: [string, unknown][]; orders: string[]; range: [number, number] | null }
function exportDb(rows: Record<string, unknown>[], fail = false) {
  const calls: Call[] = []
  const service: ExportService = {
    from(table: string) {
      return {
        select() {
          const call: Call = { table, filters: [], orders: [], range: null }
          calls.push(call)
          const q: any = {
            gt(c: string, v: unknown) { call.filters.push([`gt:${c}`, v]); return q },
            lte(c: string, v: unknown) { call.filters.push([`lte:${c}`, v]); return q },
            order(c: string) { call.orders.push(c); return q },
            range(a: number, b: number) { call.range = [a, b]; return q },
            then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
              if (fail) return Promise.resolve({ data: null, error: { message: 'missing' } }).then(res, rej)
              const max = Number(call.filters.find(f => f[0] === 'lte:volume')?.[1])
              const all = rows.filter(r => (r.volume as number) > 0 && (r.volume as number) <= max)
              const [a, b] = call.range ?? [0, all.length]
              return Promise.resolve({ data: all.slice(a, b + 1), count: all.length, error: null }).then(res, rej)
            },
          }
          return q
        },
      }
    },
  }
  return { service, calls }
}
const page = (n: number, site = 'a.com') => ({ url: `https://www.${site}/g/${n}.html`, title: `标题${n}`, site, rank: n, date: '2026-11-19' })
const row = (keyword: string, volume: number, pages: unknown[], category = '游戏', sub: string | null = '休闲', at = '2026-11-20T03:00:00Z') =>
  ({ keyword, volume, content_category: category, content_subcategory: sub, pages, refreshed_at: at })

test('export: 参数——默认搜索量上限 1000、每页 2000 个，超出范围的拉回范围内', () => {
  assert.deepEqual(parseExportQuery(new URL('https://x.test/api/keyword-rank-pages')), { offset: 0, limit: 2000, maxVolume: 1000 })
  assert.deepEqual(parseExportQuery(new URL('https://x.test/a?offset=-5&limit=99999&maxVolume=0')), { offset: 0, limit: 2000, maxVolume: 1 })
})

test('export: 按搜索量上限筛（含上限），没有链接的词也给（链接数 0），最多 5 个链接，只给链接和标题，不给搜索量', async () => {
  const rows = [
    row('甲游戏', 900, [page(1), page(2, 'b.com'), page(3, 'c.com'), page(4, 'd.com'), page(5, 'e.com'), page(6, 'f.com')]),
    row('乙应用', 1000, [], '应用', null),
    row('丙游戏', 1001, [page(7)]),
    row('丁游戏', 0, [page(8)]),
    row('戊游戏', 50, [{ url: 'javascript:alert(1)', title: 'x' }, page(9)], '游戏', null, '2026-11-20T04:00:00Z'),
  ]
  const { service, calls } = exportDb(rows)
  const r = await readExportPage(service, { offset: 0, limit: 2000, maxVolume: 1000 })
  assert.deepEqual(r.rows.map(x => [x.keyword, x.pageCount]), [['甲游戏', 5], ['乙应用', 0], ['戊游戏', 1]])
  assert.deepEqual(r.rows[1], { keyword: '乙应用', category: '应用', subcategory: null, pageCount: 0, pages: [] })
  assert.deepEqual(Object.keys(r.rows[0].pages[0]).sort(), ['title', 'url'])
  assert.equal(r.end, true); assert.equal(r.total, 3); assert.equal(r.refreshedAt, '2026-11-20T04:00:00Z')
  assert.deepEqual(calls[0].orders, ['content_category', 'keyword'])
  await assert.rejects(readExportPage(exportDb([], true).service, { offset: 0, limit: 10, maxVolume: 1000 }), /export_read_failed/)
})

test('export: 翻页——这一页满了就不算到头，下一页从 nextOffset 接着读', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => row('词' + i, 100 + i, [page(i)]))
  const { service } = exportDb(rows)
  const a = await readExportPage(service, { offset: 0, limit: 2, maxVolume: 1000 })
  assert.equal(a.end, false); assert.equal(a.nextOffset, 2)
  const c = await readExportPage(service, { offset: 4, limit: 2, maxVolume: 1000 })
  assert.equal(c.rows.length, 1); assert.equal(c.end, true)
})

test('export: CSV——带 BOM，表头是 词、游戏/应用、分类、链接数、网站链接、标题；链接用「，」、标题用「｜」隔开；引号转义；公式开头的格子加 \'', () => {
  const csv = buildExportCsv([
    { keyword: 'pubg tool', category: '应用', subcategory: '游戏辅助', pageCount: 2, pages: [{ url: 'https://www.downza.cn/soft/1.html', title: 'Pubg "Tool" 下载' }, { url: 'https://www.f71.com/app/2.html', title: '画质助手' }] },
    { keyword: '=cmd', category: '游戏', subcategory: null, pageCount: 0, pages: [] },
  ])
  assert.ok(csv.startsWith('﻿'))
  const lines = csv.slice(1).trimEnd().split('\r\n')
  assert.equal(lines[0], '"词","游戏/应用","分类","链接数","网站链接","标题"')
  assert.equal(lines[1], '"pubg tool","应用","游戏辅助","2","https://www.downza.cn/soft/1.html，https://www.f71.com/app/2.html","Pubg ""Tool"" 下载｜画质助手"')
  assert.equal(lines[2], '"\'=cmd","游戏","","0","",""')
})

test('refresh: 按词名分批往后翻，全部成功才清理旧词；中途失败、原地踏步都不清理', async () => {
  const words = ['a', 'b', 'c', 'd', 'e']
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const rpc = (fail?: number, stuck = false) => async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    if (fn === 'finish_keyword_rank_pages') return { data: 3, error: null }
    const n = calls.filter(c => c.fn === 'refresh_keyword_rank_pages').length
    if (n === fail) return { data: null, error: { message: 'timeout' } }
    const after = args.p_after as string | null, limit = args.p_limit as number
    const chunk = stuck ? words.slice(0, limit) : words.filter(w => after === null || w > after).slice(0, limit)
    return { data: { words: chunk.length, with_pages: chunk.length - 1, last_keyword: chunk.at(-1) ?? null, done: chunk.length < limit }, error: null }
  }
  const ok = await refreshKeywordRankPages(rpc(), { batch: 2, run: '2026-11-20T03:00:00.000Z' })
  assert.deepEqual(ok, { words: 5, withPages: 2, removed: 3, batches: 3, run: '2026-11-20T03:00:00.000Z' })
  assert.deepEqual(calls.filter(c => c.fn === 'refresh_keyword_rank_pages').map(c => c.args.p_after), [null, 'b', 'd'])
  assert.ok(calls.filter(c => c.fn === 'refresh_keyword_rank_pages').every(c => c.args.p_run === '2026-11-20T03:00:00.000Z' && c.args.p_max === 5 && c.args.p_days === 30))
  assert.equal(calls.at(-1)!.fn, 'finish_keyword_rank_pages')

  calls.length = 0
  await assert.rejects(refreshKeywordRankPages(rpc(2), { batch: 2 }), /第 2 批失败（没删旧数据）：timeout/)
  assert.ok(!calls.some(c => c.fn === 'finish_keyword_rank_pages'))
  calls.length = 0
  await assert.rejects(refreshKeywordRankPages(rpc(undefined, true), { batch: 2 }), /没有往后走/)
  assert.ok(!calls.some(c => c.fn === 'finish_keyword_rank_pages'))
})
