import { timingSafeEqual } from 'node:crypto'

// 排名词取词接口（2026-11-19）：奇心 Agent 服务器取「竞品下载站在百度有排名的词」，每个词带着那几个站的页面链接。
// 这些站（网站管理里开了「排名」抓取的）都是下载站，页面链接直接给 Agent 当转写资料，不用再去百度搜。
// 只读；按搜索量从高到低扫「已确认分类」的游戏和应用词，只给搜索量在 maxVolume 以下、至少有 minPages 个不同页面的词；
// 专用密钥认证（和词库补充同一套密钥），不使用登录会话。
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const CATEGORY_TYPE = { 游戏: 'game', 应用: 'app' } as const
type Category = keyof typeof CATEGORY_TYPE

export type RankedPage = { url: string; title: string; site: string; rank: number | null; date: string | null }
export type RankedWord = {
  keyword: string
  contentType: 'game' | 'app'
  category: Category
  subcategory: string | null
  volume: number | null
  pages: RankedPage[]
}

// 查询构造器：只列出这里用到的几个方法，测试里用假的实现。
type Query = PromiseLike<{ data: unknown[] | null; count?: number | null; error: unknown }> & {
  eq(column: string, value: unknown): Query
  in(column: string, values: unknown[]): Query
  gt(column: string, value: unknown): Query
  gte(column: string, value: unknown): Query
  lte(column: string, value: unknown): Query
  not(column: string, operator: string, value: unknown): Query
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): Query
  range(from: number, to: number): Query
  limit(count: number): Query
}
export type RankedPagesService = {
  from(table: string): { select(columns: string, options?: { count: 'exact' }): Query }
}

const MAX_OFFSET = 200_000
const KEYWORD_BATCH = 50 // 每次 .in() 查多少个词（请求地址太长会被拒）
const ROW_LIMIT = 1000

function safeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
function integerParam(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

export function parseRankedPagesQuery(url: URL) {
  return {
    offset: integerParam(url.searchParams.get('offset'), 0, 0, MAX_OFFSET),
    limit: integerParam(url.searchParams.get('limit'), 100, 10, 200),
    maxVolume: integerParam(url.searchParams.get('maxVolume'), 1000, 1, 100_000),
    minPages: integerParam(url.searchParams.get('minPages'), 2, 1, 5),
    days: integerParam(url.searchParams.get('days'), 30, 1, 40),
  }
}

// 页面地址整理：只收 http(s)；去掉 www./m./wap. 前缀和末尾斜杠后算同一页。
export function pageKey(rawUrl: string): { key: string; host: string; href: string } | null {
  let u: URL
  try { u = new URL(rawUrl) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase().replace(/^(www|m|wap)\./, '')
  if (!host.includes('.')) return null
  return { key: host + u.pathname.replace(/\/+$/, ''), host, href: u.href }
}
const normalizeDomain = (domain: string) => domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^(www|m|wap)\./, '').replace(/\/.*$/, '')
const normalizeText = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '')

type RankRow = { keyword: string; url: string | null; title: string | null; rank_position: number | null; stat_date: string | null; site_id: string }

// 一个词的页面：同一页合并（取最好的名次、最近的日期）；标题里有这个词的排前面，其次名次靠前、日期新；每个站先出一个页面，凑不够再补同站的。最多 max 个。
export function pickPages(keyword: string, rows: RankRow[], siteDomains: Map<string, string>, max = 6): RankedPage[] {
  const merged = new Map<string, RankedPage & { siteId: string }>()
  for (const row of rows) {
    if (!row.url) continue
    const page = pageKey(row.url)
    if (!page) continue
    const rank = Number.isInteger(row.rank_position) && (row.rank_position as number) > 0 ? (row.rank_position as number) : null
    const date = typeof row.stat_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.stat_date) ? row.stat_date : null
    const title = String(row.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
    const old = merged.get(page.key)
    if (!old) { merged.set(page.key, { url: page.href, title, site: siteDomains.get(row.site_id) ?? page.host, rank, date, siteId: row.site_id }); continue }
    if (rank !== null && (old.rank === null || rank < old.rank)) old.rank = rank
    if (date && (!old.date || date > old.date)) { old.date = date; if (title) old.title = title; old.url = page.href }
  }
  const kw = normalizeText(keyword)
  const sorted = [...merged.values()].sort((a, b) =>
    Number(normalizeText(b.title).includes(kw)) - Number(normalizeText(a.title).includes(kw)) ||
    (a.rank ?? 999) - (b.rank ?? 999) ||
    String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
    a.url.localeCompare(b.url))
  const out: (RankedPage & { siteId: string })[] = []
  const seenSites = new Set<string>()
  for (const p of sorted) if (!seenSites.has(p.siteId) && out.length < max) { seenSites.add(p.siteId); out.push(p) }
  for (const p of sorted) if (!out.includes(p) && out.length < max) out.push(p)
  return out.map(({ siteId: _siteId, ...page }) => page)
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

// getKeys：允许的密钥（和词库补充一样：专用密钥，或已有的推荐词密钥），任何一个对得上就行；没有一个配置好（至少 24 位）接口就关闭。
export function createRankedPagesHandler(deps: { getService: () => RankedPagesService; getKeys: () => (string | undefined)[]; now?: () => number }) {
  return async function GET(request: Request) {
    const expected = deps.getKeys().map(key => (key ?? '').trim()).filter(key => key.length >= 24)
    if (expected.length === 0) return Response.json({ error: '排名词取词密钥尚未配置' }, { status: 503, headers })
    const authorization = request.headers.get('authorization') ?? ''
    const actual = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    const matched = expected.map(key => safeEqual(actual, key)).some(Boolean)
    if (!matched) return Response.json({ error: '排名词取词认证失败' }, { status: 401, headers })

    const query = parseRankedPagesQuery(new URL(request.url))
    try {
      const service = deps.getService()
      // 1) 按搜索量从高到低扫一段已确认分类的游戏和应用词（搜索量 1 到上限）。
      const library = await service.from('keyword_volume')
        .select('keyword, volume, content_category, content_subcategory', { count: 'exact' })
        .eq('classification_status', 'confirmed')
        .in('content_category', ['游戏', '应用'])
        .gt('volume', 0)
        .lte('volume', query.maxVolume)
        .order('volume', { ascending: false, nullsFirst: false })
        .order('keyword', { ascending: true })
        .range(query.offset, query.offset + query.limit - 1)
      if (library.error) return Response.json({ error: '排名词读取失败，请稍后重试' }, { status: 503, headers })
      const scannedRows = (library.data ?? []) as Record<string, unknown>[]

      const base = new Map<string, Omit<RankedWord, 'pages'>>()
      for (const item of scannedRows) {
        const keyword = typeof item.keyword === 'string' ? item.keyword.trim() : ''
        const category = item.content_category
        if (!keyword || keyword.length > 100 || /[\u0000-\u001f<>]/.test(keyword)) continue
        if (category !== '游戏' && category !== '应用') continue
        const volume = typeof item.volume === 'number' && Number.isFinite(item.volume) ? item.volume : null
        const subcategory = typeof item.content_subcategory === 'string' && item.content_subcategory.trim() ? item.content_subcategory.trim() : null
        base.set(keyword, { keyword, contentType: CATEGORY_TYPE[category], category, subcategory, volume })
      }
      const keywords = [...base.keys()]

      let words: RankedWord[] = []
      if (keywords.length) {
        // 2) 开了「排名」抓取的站点，去掉自己的站点（任务分组里填的）——自己站的页面不能当资料。
        const [siteResult, ownResult] = await Promise.all([
          service.from('sites').select('id, domain').eq('has_rank_title', true),
          service.from('task_groups').select('site_domains'),
        ])
        if (siteResult.error || ownResult.error) return Response.json({ error: '排名词读取失败，请稍后重试' }, { status: 503, headers })
        const own = new Set<string>()
        for (const group of (ownResult.data ?? []) as { site_domains: string[] | null }[]) for (const d of group.site_domains ?? []) own.add(normalizeDomain(d))
        const siteDomains = new Map<string, string>()
        for (const site of (siteResult.data ?? []) as { id: string; domain: string }[]) {
          if (site?.id && site.domain && !own.has(normalizeDomain(site.domain))) siteDomains.set(site.id, normalizeDomain(site.domain))
        }
        // 3) 每个站点、每 50 个词查一次排名表（用「站点+词」的索引），只要手机版、有页面链接、最近 days 天的。
        const since = new Date((deps.now?.() ?? Date.now()) - query.days * 86_400_000).toISOString().slice(0, 10)
        const batches: string[][] = []
        for (let i = 0; i < keywords.length; i += KEYWORD_BATCH) batches.push(keywords.slice(i, i + KEYWORD_BATCH))
        const jobs = [...siteDomains.keys()].flatMap(siteId => batches.map(batch => ({ siteId, batch })))
        const results = await mapLimit(jobs, 8, async ({ siteId, batch }) => {
          const r = await service.from('site_keyword_ranks')
            .select('keyword, url, title, rank_position, stat_date, site_id')
            .eq('site_id', siteId).eq('platform', 'mobile')
            .not('url', 'is', null)
            .gte('stat_date', since)
            .in('keyword', batch)
            .order('stat_date', { ascending: false })
            .limit(ROW_LIMIT)
          return r.error ? null : ((r.data ?? []) as RankRow[])
        })
        // 有一个查询失败就整体报错：不拿残缺的页面当完整的（少了某个站的页面，词会被误判成页面不够）。
        if (results.some(r => r === null)) return Response.json({ error: '排名词读取失败，请稍后重试' }, { status: 503, headers })
        const byKeyword = new Map<string, RankRow[]>()
        for (const rows of results as RankRow[][]) for (const row of rows) {
          const list = byKeyword.get(row.keyword)
          if (list) list.push(row); else byKeyword.set(row.keyword, [row])
        }
        words = keywords.flatMap(keyword => {
          const pages = pickPages(keyword, byKeyword.get(keyword) ?? [], siteDomains)
          return pages.length >= query.minPages ? [{ ...base.get(keyword)!, pages }] : []
        })
      }
      const scanned = scannedRows.length
      return Response.json({
        words, offset: query.offset, scanned, nextOffset: query.offset + scanned,
        end: scanned < query.limit, total: library.count ?? 0, maxVolume: query.maxVolume, minPages: query.minPages, order: 'volume_desc',
      }, { headers })
    } catch {
      return Response.json({ error: '排名词读取失败，请稍后重试' }, { status: 503, headers })
    }
  }
}
