// 隔离库验证（2026-11-20）：在内存里的 Postgres（PGlite）跑 20261120_keyword_rank_pages.sql，
// 用同一批假数据比较数据库函数算出的「词 → 前 5 个页面」和排名词接口现在的 pickPages 是否完全一样；
// 也检查分批刷新、清理、重复执行迁移、权限。不连生产库、不写任何真实数据。
// 运行：PGLITE_MODULE_PATH=<@electric-sql/pglite 的 dist/index.js> npx tsx scripts/verify-keyword-rank-pages-sql.ts
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { pickPages } from '../lib/agent-ranked-pages'
import { refreshKeywordRankPages } from './refresh-keyword-rank-pages'

type Row = { keyword: string; site_id: string; url: string; title: string; rank_position: number | null; stat_date: string; platform: string; type: string }
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const day = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') - n * 86400_000).toISOString().slice(0, 10)
const sites = [
  { id: '00000000-0000-4000-8000-000000000001', domain: 'www.alpha.com' },
  { id: '00000000-0000-4000-8000-000000000002', domain: 'beta.cn' },
  { id: '00000000-0000-4000-8000-000000000003', domain: 'm.gamma.net' },
  { id: '00000000-0000-4000-8000-000000000004', domain: 'delta.org' },
]
const host = (siteIndex: number) => sites[siteIndex].domain.replace(/^(www|m)\./, '')

// 随机但可重复的假数据：每个词的每一行日期、排名都不一样（避免并列时两边各取一个都算对的情况）。
let seed = 20261120
const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
const words: { keyword: string; category: string; status: string; volume: number }[] = []
const rows: Row[] = []
for (let w = 0; w < 120; w++) {
  const keyword = (w % 7 === 0 ? 'Game ' : '游戏') + w
  const status = w % 23 === 5 ? 'pending' : 'confirmed'
  const category = w % 31 === 7 ? '工具' : w % 2 ? '游戏' : '应用'
  words.push({ keyword, category, status, volume: w % 29 === 3 ? 0 : 1 + rand(1000) })
  const n = w % 11 === 0 ? 0 : 1 + rand(24)
  const ranks = Array.from({ length: 100 }, (_, i) => i + 1).sort(() => rand(3) - 1)
  for (let i = 0; i < n; i++) {
    const s = rand(4), path = `/game/${rand(6)}${rand(2) ? '.html' : '/'}`
    const prefix = ['www.', 'm.', '', 'wap.', 'h5.'][rand(5)]
    const query = rand(5) === 0 ? '?from=baidu' : ''
    const titles = [`${keyword}下载安装`, `${keyword} 官方版下载`, `别的游戏下载`, `${keyword}手机版  最新版`]
    rows.push({
      keyword, site_id: sites[s].id, url: `http://${prefix}${host(s)}${path}${query}`,
      title: titles[rand(titles.length)], rank_position: ranks[i] <= 95 ? ranks[i] : null,
      stat_date: day(i * 2 + (rand(3) === 0 ? 31 : 0)), platform: rand(2) ? 'mobile' : 'pc', type: rand(2) ? 'rankup' : 'rankdown',
    })
  }
}
// 手工写的几种情况：手机版和电脑版是同一页（留电脑版）；同站同标题两个地址（留排名好的）；6 个站以上只给 5 个。
words.push({ keyword: '手工词', category: '游戏', status: 'confirmed', volume: 500 })
rows.push(
  { keyword: '手工词', site_id: sites[0].id, url: 'http://m.alpha.com/g/1.html', title: '手工词下载', rank_position: 3, stat_date: day(1), platform: 'mobile', type: 'rankup' },
  { keyword: '手工词', site_id: sites[0].id, url: 'http://www.alpha.com/g/1.html', title: '手工词下载', rank_position: 8, stat_date: day(2), platform: 'pc', type: 'rankup' },
  { keyword: '手工词', site_id: sites[1].id, url: 'http://beta.cn/a/9.html', title: '手工词 官方版', rank_position: 12, stat_date: day(1), platform: 'mobile', type: 'rankup' },
  { keyword: '手工词', site_id: sites[1].id, url: 'http://beta.cn/b/9.html', title: '手工词 官方版', rank_position: 4, stat_date: day(3), platform: 'mobile', type: 'rankdown' },
  { keyword: '手工词', site_id: sites[2].id, url: 'http://wap.gamma.net/x.html', title: '手工词', rank_position: 1, stat_date: day(1), platform: 'mobile', type: 'rankup' },
  { keyword: '手工词', site_id: sites[3].id, url: 'http://delta.org/1', title: '无关标题', rank_position: 2, stat_date: day(1), platform: 'mobile', type: 'rankup' },
  { keyword: '手工词', site_id: sites[3].id, url: 'http://delta.org/2', title: '手工词合集', rank_position: 30, stat_date: day(4), platform: 'mobile', type: 'rankup' },
  { keyword: '手工词', site_id: sites[3].id, url: 'http://delta.org/3', title: '手工词第三页', rank_position: 31, stat_date: day(5), platform: 'mobile', type: 'rankup' },
  { keyword: '手工词', site_id: sites[3].id, url: 'http://delta.org/4', title: '手工词第四页', rank_position: 32, stat_date: day(6), platform: 'mobile', type: 'rankup' },
)

async function main() {
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
const db = new PGlite()
const sql = await readFile('supabase/migrations/20261120_keyword_rank_pages.sql', 'utf8')
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table sites(id uuid primary key, domain text not null);
    create table keyword_volume(keyword text not null, volume integer not null, stat_date date not null, content_category text, content_subcategory text, classification_status text not null, primary key(keyword, stat_date));
    create table site_keyword_ranks(id uuid primary key default gen_random_uuid(), site_id uuid not null, keyword text not null, stat_date date not null, platform text not null, type text not null, rank_position integer, prev_rank integer, volume integer, title text, url text);`)
  for (const s of sites) await db.query('insert into sites values ($1,$2)', [s.id, s.domain])
  for (const w of words) await db.query('insert into keyword_volume values ($1,$2,$3,$4,$5,$6)', [w.keyword, w.volume, today, w.category, w.category === '游戏' ? '休闲' : null, w.status])
  for (const r of rows) await db.query('insert into site_keyword_ranks(site_id,keyword,stat_date,platform,type,rank_position,title,url) values ($1,$2,$3,$4,$5,$6,$7,$8)', [r.site_id, r.keyword, r.stat_date, r.platform, r.type, r.rank_position, r.title, r.url])
  await db.exec(sql)
  await db.exec(sql) // 重复执行安全

  // 分批刷新：每批 7 个词，用正式脚本同一段循环代码（只是 rpc 换成直接调数据库）。
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    try {
      const names = Object.keys(args)
      const res = await db.query(`select ${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) as v`, names.map(name => args[name]))
      return { data: (res.rows[0] as { v: unknown }).v, error: null }
    } catch (e) { return { data: null, error: { message: (e as Error).message } } }
  }
  // 先放一个「上一轮」留下、这一轮已经不合格的词，看清理会不会删掉它。
  await db.query(`insert into keyword_rank_pages(keyword, content_category, page_count, pages, refreshed_at) values ('已经不合格的旧词','游戏',0,'[]', now() - interval '2 days')`)
  const result = await refreshKeywordRankPages(rpc, { batch: 7 })
  const eligible = words.filter(w => w.status === 'confirmed' && ['游戏', '应用'].includes(w.category) && w.volume > 0)
  assert.equal(result.words, eligible.length, '每个合格的词都刷新一次，不重复不漏')
  assert.ok(result.batches > 10)
  assert.equal(result.removed, 1, '清理掉这一轮没出现的旧词')

  // 和排名词接口的 pickPages 逐个比：接口按站点、日期从新到旧取最近 30 天有链接的行。
  const since = day(30)
  const siteDomains = new Map(sites.map(s => [s.id, s.domain.toLowerCase().replace(/^(www|m|wap)\./, '')]))
  const table = new Map(((await db.query('select keyword, page_count, pages, content_category from keyword_rank_pages')).rows as { keyword: string; page_count: number; pages: unknown[]; content_category: string }[]).map(r => [r.keyword, r]))
  assert.equal(table.size, eligible.length)
  let compared = 0, withPages = 0
  for (const w of eligible) {
    const own = rows.filter(r => r.keyword === w.keyword && r.stat_date >= since)
      .sort((a, b) => a.site_id.localeCompare(b.site_id) || b.stat_date.localeCompare(a.stat_date))
    const expected = pickPages(w.keyword, own, siteDomains, 5)
    const got = table.get(w.keyword)!
    assert.deepEqual(got.pages, expected, `「${w.keyword}」的页面和接口算的不一样`)
    assert.equal(got.page_count, expected.length)
    if (expected.length) withPages++
    compared++
  }
  assert.ok(withPages > 50 && compared - withPages > 5, `样本要同时有带页面和不带页面的词（${withPages}/${compared}）`)

  const manual = table.get('手工词')!.pages as { url: string; title: string; site: string; rank: number }[]
  assert.equal(manual.length, 5, '超过 5 个只给 5 个')
  assert.ok(manual.some(p => p.url === 'http://www.alpha.com/g/1.html' && p.rank === 3), '手机版和电脑版是同一页：留电脑版地址、排名取最好的')
  assert.ok(!manual.some(p => p.url.includes('wap.')), 'wap. 开头的不要')
  assert.equal(manual.filter(p => p.site === 'beta.cn').length, 1, '同站同标题只留一个')
  assert.deepEqual(manual.slice(0, 3).map(p => p.site).sort(), ['alpha.com', 'beta.cn', 'delta.org'], '每个站先出一个')

  // 只有服务端能调；浏览器端角色不能读表、不能调函数。
  const perm = await db.query(`select
    has_function_privilege('anon','refresh_keyword_rank_pages(text,integer,integer,integer,timestamptz)','EXECUTE') as anon_fn,
    has_function_privilege('authenticated','finish_keyword_rank_pages(timestamptz)','EXECUTE') as auth_fn,
    has_function_privilege('service_role','refresh_keyword_rank_pages(text,integer,integer,integer,timestamptz)','EXECUTE') as service_fn,
    has_table_privilege('anon','keyword_rank_pages','SELECT') as anon_read,
    has_table_privilege('authenticated','keyword_rank_pages','SELECT') as auth_read,
    has_table_privilege('service_role','keyword_rank_pages','SELECT') as service_read`)
  assert.deepEqual(perm.rows, [{ anon_fn: false, auth_fn: false, service_fn: true, anon_read: false, auth_read: false, service_read: true }])

  // 中途失败不删旧数据：清理函数没给 p_run 就报错。
  await assert.rejects(db.query('select finish_keyword_rank_pages(null)'), /p_run is required/)
  console.log(`keyword_rank_pages SQL 和 pickPages 一致：${compared} 个词（${withPages} 个有页面），${result.batches} 批，${rows.length} 行假数据；权限只给 service_role`)
} finally { await db.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
