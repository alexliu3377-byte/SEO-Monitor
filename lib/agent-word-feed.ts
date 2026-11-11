// 奇心 Agent 推荐词（只读）：把热词雷达和竞品日收里的词整理成一份清单，供各电脑的 Agent 服务器拉取。
// 只读：不写任何表；只返回词、来源、是否热词和原因，不返回站点明细、链接或用户资料。
// 热词判断：搜索量上涨的词；同时出现在 2 个以上站点的新词；昨天在 2 个以上竞品站同时新增的词。其他为普通词。
import { fetchAllRows } from './supabase-paginate'
import type { HotRadarPayload } from './hot-radar'

export interface FeedWord {
  keyword: string
  source: 'hot-radar' | 'competitor-daily'
  hot: boolean
  reason: string
  contentType?: 'game' | 'app' | null
}
export interface WordFeed { date: string; generatedAt: string; words: FeedWord[]; counts: { hot: number; total: number } }
export interface CompetitorKeywordRow { keyword: string; content_type: string | null; site_id: string }

export const WORD_FEED_LIMITS = { volumeRising: 40, newWords: 60, rankWords: 30, streakWords: 30, competitor: 300 } as const

export function malaysiaDate(offsetDays = 0, now = Date.now()): string {
  return new Date(now + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

const keyOf = (keyword: string) => keyword.replace(/\s+/g, '').toLowerCase()
const usable = (keyword: unknown): keyword is string =>
  typeof keyword === 'string' && keyword.trim().length > 0 && keyword.trim().length <= 60 && !keyword.includes('电脑版')

export function buildWordFeed(
  payload: Partial<HotRadarPayload> | null,
  competitor: CompetitorKeywordRow[],
  { date, now = Date.now() }: { date: string; now?: number },
): WordFeed {
  const words = new Map<string, FeedWord>()
  const add = (word: FeedWord) => {
    if (!usable(word.keyword)) return
    const keyword = word.keyword.trim(), key = keyOf(keyword)
    const existing = words.get(key)
    if (!existing) { words.set(key, { ...word, keyword }); return }
    // 同一个词多个来源：只要有一个来源判为热词就算热词，原因合并。
    if (word.hot && !existing.hot) existing.hot = true
    if (!existing.reason.includes(word.reason)) existing.reason += `；${word.reason}`
  }

  const rising = [...(payload?.volumeRisingWords ?? [])].sort((a, b) => (b.netChange ?? 0) - (a.netChange ?? 0)).slice(0, WORD_FEED_LIMITS.volumeRising)
  for (const w of rising) add({ keyword: w.keyword, source: 'hot-radar', hot: true, reason: `热词雷达：搜索量上涨 ${w.netChange ?? w.change ?? ''}`.trim() })
  for (const w of (payload?.newWords ?? []).slice(0, WORD_FEED_LIMITS.newWords)) {
    add({ keyword: w.keyword, source: 'hot-radar', hot: (w.siteCount ?? 0) >= 2, reason: `热词雷达：新词，${w.siteCount ?? 0} 个站出现` })
  }
  for (const w of (payload?.rankWords ?? []).slice(0, WORD_FEED_LIMITS.rankWords)) {
    add({ keyword: w.keyword, source: 'hot-radar', hot: false, reason: `热词雷达：排名词，${w.siteCount ?? 0} 个站` })
  }
  for (const w of (payload?.streakWords ?? []).slice(0, WORD_FEED_LIMITS.streakWords)) {
    add({ keyword: w.keyword, source: 'hot-radar', hot: false, reason: `热词雷达：连续上榜 ${w.streak ?? 0} 天` })
  }

  // 竞品日收：同一个词按出现的竞品站数合并；2 个以上竞品站同一天新增的算热词。
  const byKeyword = new Map<string, { keyword: string; sites: Set<string>; type: 'game' | 'app' | null }>()
  for (const row of competitor) {
    if (!usable(row.keyword)) continue
    const key = keyOf(row.keyword)
    const entry = byKeyword.get(key) ?? { keyword: row.keyword.trim(), sites: new Set<string>(), type: row.content_type === 'game' ? 'game' : row.content_type === 'app' ? 'app' : null }
    entry.sites.add(row.site_id)
    byKeyword.set(key, entry)
  }
  const competitorWords = [...byKeyword.values()].sort((a, b) => b.sites.size - a.sites.size || a.keyword.localeCompare(b.keyword, 'zh-CN')).slice(0, WORD_FEED_LIMITS.competitor)
  for (const w of competitorWords) {
    add({ keyword: w.keyword, source: 'competitor-daily', hot: w.sites.size >= 2, reason: `竞品日收：${date} ${w.sites.size} 个竞品站新增`, contentType: w.type })
  }

  const list = [...words.values()].sort((a, b) => Number(b.hot) - Number(a.hot))
  return { date, generatedAt: new Date(now).toISOString(), words: list, counts: { hot: list.filter(w => w.hot).length, total: list.length } }
}

// 从数据库读取（只读）。竞品站 = 已启用的站点，去掉各任务分组里登记为自己站点的域名。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadWordFeed(db: any, date: string, now = Date.now()): Promise<WordFeed> {
  const { data: cache, error: cacheError } = await db.from('hot_radar_cache').select('payload').eq('id', 'latest').maybeSingle()
  if (cacheError) throw cacheError
  const groups = await fetchAllRows<{ id: string; site_domains: string[] | null }>((from, to) =>
    db.from('task_groups').select('id, site_domains').order('id').range(from, to))
  const ownDomains = new Set(groups.flatMap(g => g.site_domains ?? []).map(d => d.trim().toLowerCase()).filter(Boolean))
  const sites = await fetchAllRows<{ id: string; domain: string }>((from, to) =>
    db.from('sites').select('id, domain').eq('is_enabled', true).order('id').range(from, to))
  const competitorIds = sites.filter(s => !ownDomains.has(String(s.domain).trim().toLowerCase())).map(s => s.id)
  const rows: CompetitorKeywordRow[] = []
  for (let i = 0; i < competitorIds.length; i += 100) {
    rows.push(...await fetchAllRows<CompetitorKeywordRow>((from, to) => db.from('raw_keywords')
      .select('keyword, content_type, site_id').in('site_id', competitorIds.slice(i, i + 100)).eq('content_date', date)
      .not('keyword', 'like', '%电脑版%').order('keyword').order('site_id').order('id').range(from, to)))
  }
  return buildWordFeed(cache?.payload ?? null, rows, { date, now })
}

// 接口处理（便于测试）：只认专用密钥 AGENT_WORD_FEED_SECRET；没设置时接口关闭。
export function createWordFeedHandler({ secret, load, now = () => Date.now() }: {
  secret: string | undefined
  load: (date: string) => Promise<WordFeed>
  now?: () => number
}) {
  return async (req: Request): Promise<Response> => {
    const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
    if (!secret || secret.length < 32) return json(503, { error: '推荐词接口未开启' })
    const auth = req.headers.get('authorization') ?? ''
    if (!safeEqual(auth, `Bearer ${secret}`)) return json(401, { error: 'Unauthorized' })
    const requested = new URL(req.url).searchParams.get('date')
    const yesterday = malaysiaDate(-1, now()), oldest = malaysiaDate(-7, now())
    if (requested && (!/^\d{4}-\d{2}-\d{2}$/.test(requested) || requested < oldest || requested > malaysiaDate(0, now()))) {
      return json(400, { error: '日期只能是最近 7 天内（马来西亚时间）' })
    }
    try {
      return json(200, await load(requested ?? yesterday))
    } catch (error) {
      console.error('Agent word feed failed', error instanceof Error ? error.message : 'Database unavailable')
      return json(503, { error: '推荐词读取失败，请稍后重试' })
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
