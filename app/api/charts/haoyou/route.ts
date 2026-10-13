import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import * as iconv from 'iconv-lite'
import { Element } from 'domhandler'
import { createClient } from '@/lib/supabase-server'
import { unstable_cache } from 'next/cache'
import {
  parseHaoyouPopularRanking,
  parseHaoyouSearchTrends,
  type HaoyouPopularItem,
} from '@/lib/haoyou-ranking'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.3839.com/',
  'Upgrade-Insecure-Requests': '1',
}

export interface HaoyouItem {
  name: string
  tags: string[]
  score: string
  status: string
  url: string
  btnText: string
  date: string
}

export interface HaoyouHotItem {
  rank: number
  name: string
  tags: string[]
  score: string
  url: string
}

const SIX_HOURS = 21_600

async function loadPage() {
  try {
    const res = await fetch('https://www.3839.com/timeline.html', {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const peek = buf.subarray(0, 4096).toString('ascii')
    const meta = peek.match(/<meta[^>]+charset=["']?\s*([^"'\s;>]+)/i)?.[1]?.toLowerCase() ?? 'utf-8'
    const charset = (meta === 'gb2312' || meta === 'gb18030') ? 'gbk' : meta
    return cheerio.load(iconv.decode(buf, charset))
  } catch { return null }
}

const PC_TAGS = ['pc游戏', '主机游戏', '3ds', 'ps4', 'ps5', 'xbox', 'switch']

function isPc($: ReturnType<typeof cheerio.load>, li: Element): boolean {
  if ($(li).find('.g-type-pc').length) return true
  const tags = $(li).find('p.tags .it').map((_, el) => $(el).text().toLowerCase()).get()
  return tags.some(t => PC_TAGS.includes(t))
}

function isPaid($: ReturnType<typeof cheerio.load>, li: Element): boolean {
  const row = $(li)
  return row.find('[data-price-gid]').length > 0 || /[¥￥]\s*\d|付费|买断制/.test(row.text())
}

function parseItem($: ReturnType<typeof cheerio.load>, li: Element): HaoyouItem | null {
  const name = $(li).find('.name em').text().trim()
  if (!name) return null

  const href = $(li).find('a').first().attr('href') ?? ''
  const url = href.startsWith('http') ? href : 'https:' + href

  const tags = $(li).find('p.tags .it').map((_, el) => $(el).text().trim()).get()

  const score = $(li).find('.score').text().replace(/[^\d.]/g, '').trim()

  // Status is the non-score span inside .info
  let status = ''
  $(li).find('.info span').each((_, el) => {
    if (!$(el).hasClass('score') && !$(el).find('i').length) {
      const t = $(el).text().trim()
      if (t) status = t
    }
  })

  const btnText = $(li).find('a.btn').text().trim()

  return { name, tags, score, status, url, btnText, date: '' }
}

interface ParsedPanel {
  today: HaoyouItem[]
  upcoming: HaoyouItem[]
  baoliao: HaoyouItem[]
}

function parsePanel($: ReturnType<typeof cheerio.load>, panelRel: string): ParsedPanel {
  const panel = $(`.panelList[rel="${panelRel}"]`)
  const today: HaoyouItem[] = []
  const upcoming: HaoyouItem[] = []
  const baoliao: HaoyouItem[] = []

  panel.find('.foreCard').each((_, card) => {
    const $card = $(card)
    const cardRel = $card.attr('rel') || ''
    if (cardRel === 'last7') return // skip past 7 days

    const hdText = $card.find('.foreCard-hd').first().text().trim()
    const dateMatch = hdText.match(/(\d+)月(\d+)日/)
    const date = dateMatch
      ? `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}`
      : ''

    $card.find('.foreList li').each((_, li) => {
      if (cardRel !== 'baoliao' && (isPc($, li as Element) || isPaid($, li as Element))) return
      const item = parseItem($, li as Element)
      if (!item) return
      const stamped = { ...item, date }
      if (cardRel === 'now') today.push(stamped)
      else if (cardRel === 'baoliao') baoliao.push(stamped)
      else upcoming.push(stamped) // tomorrow + beyond
    })
  })

  return { today, upcoming, baoliao }
}

async function fetchHotChart(): Promise<HaoyouPopularItem[]> {
  try {
    const res = await fetch('https://www.3839.com/app/hykb_web/index.php?m=top&ac=rank_list&type=hot2&page=1&offset=0', {
      headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    const payload = await res.json().catch(() => null) as { code?: number; html?: string } | null
    return payload?.code === 100 && payload.html ? parseHaoyouPopularRanking(payload.html) : []
  } catch { return [] }
}

async function fetchSearchTrends() {
  try {
    const response = await fetch('https://www.3839.com/top/hot.html', {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) return []
    const buffer = Buffer.from(await response.arrayBuffer())
    const peek = buffer.subarray(0, 4096).toString('ascii')
    const meta = peek.match(/<meta[^>]+charset=["']?\s*([^"'\s;>]+)/i)?.[1]?.toLowerCase() ?? 'utf-8'
    const charset = (meta === 'gb2312' || meta === 'gb18030') ? 'gbk' : meta
    return parseHaoyouSearchTrends(iconv.decode(buffer, charset))
  } catch { return [] }
}

const readSearch = unstable_cache(async () => {
  const searchItems = await fetchSearchTrends()
  if (!searchItems.length) throw new Error('好游快爆搜索趋势暂未取得资料')
  return { searchItems,updatedAt: new Date().toISOString(),failed: false }
}, ['haoyou-search-success-v3'], { revalidate: SIX_HOURS })

const readHot = unstable_cache(async () => {
  const hotItems = await fetchHotChart()
  if (!hotItems.length) throw new Error('好游快爆热门榜暂时读取失败')
  return { hotItems,updatedAt: new Date().toISOString() }
}, ['haoyou-hot-success-v3'], { revalidate: SIX_HOURS })

const readTimeline = unstable_cache(async (day: string) => {
  void day // Date is part of the cache key: yesterday's “today” cannot leak.
  const $ = await loadPage()
  if (!$ || !$('.panelList').length) throw new Error('好游快爆平台资讯暂时读取失败')
  const upcomingPanel = parsePanel($, '1')
  const updatesPanel = parsePanel($, '3')
  return {
    upcomingToday: upcomingPanel.today,
    upcoming: upcomingPanel.upcoming,
    baoliao: [...upcomingPanel.baoliao, ...updatesPanel.baoliao],
    updates: [...updatesPanel.today, ...updatesPanel.upcoming],
    updatedAt: new Date().toISOString(),
  }
}, ['haoyou-timeline-success-v3'], { revalidate: SIX_HOURS })

export async function GET(request: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (new URL(request.url).searchParams.get('view') === 'search') {
    try { return NextResponse.json(await readSearch()) } catch {
      return NextResponse.json({ searchItems: [],updatedAt: null,failed: true,error: '好游快爆搜索趋势暂未取得资料，请稍后重试' })
    }
  }
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0,10)
  const [timeline, hot] = await Promise.allSettled([readTimeline(day),readHot()])
  const parts = [timeline,hot].filter(part => part.status === 'fulfilled').map(part => part.value)
  const failed = timeline.status === 'rejected' || hot.status === 'rejected'
  return NextResponse.json({
    ...(timeline.status === 'fulfilled' ? timeline.value : { upcomingToday: [],upcoming: [],baoliao: [],updates: [] }),
    hotItems: hot.status === 'fulfilled' ? hot.value.hotItems : [],
    updatedAt: parts.map(part => part.updatedAt).sort()[0] ?? null,
    failed,...(failed ? { error: '部分好游快爆资料暂时读取失败，已取得的资料仍可查看' } : {}),
  })
}
