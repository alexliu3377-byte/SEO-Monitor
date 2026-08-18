import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import * as iconv from 'iconv-lite'
import { Element } from 'domhandler'
import { createClient } from '@/lib/supabase-server'

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
}

async function loadPage() {
  try {
    const res = await fetch('https://www.3839.com/timeline.html', {
      headers: HEADERS,
      next: { revalidate: 3600 },
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
  return $(li).find('a.btn').text().includes('¥')
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

async function fetchHotChart(): Promise<HaoyouHotItem[]> {
  try {
    const res = await fetch('https://www.3839.com/top/hot.html', {
      headers: HEADERS,
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    const buf = Buffer.from(await res.arrayBuffer())
    const peek = buf.subarray(0, 4096).toString('ascii')
    const meta = peek.match(/<meta[^>]+charset=["']?\s*([^"'\s;>]+)/i)?.[1]?.toLowerCase() ?? 'utf-8'
    const charset = (meta === 'gb2312' || meta === 'gb18030') ? 'gbk' : meta
    const $h = cheerio.load(iconv.decode(buf, charset))

    const items: HaoyouHotItem[] = []
    $h('ul.foreList li, ol li, .rankList li, .list li').each((_, el) => {
      if (items.length >= 20) return false as unknown as void
      const $el = $h(el)
      const name = $el.find('.name em').first().text().trim()
        || $el.find('em').first().text().trim()
        || $el.find('a').first().text().trim()
      if (!name || name.length < 2) return
      const tags = $el.find('p.tags .it').map((_, t) => $h(t).text().trim()).get()
      items.push({ rank: items.length + 1, name, tags })
    })
    return items
  } catch { return [] }
}

export async function GET() {
  // 跟 monthly-trend 同一个门槛——登录即可查，不限 super/admin。之前这里
  // 完全没做校验，无鉴权无限流地代理抓取第三方站点，跟同目录其它图表接口的
  // 设计意图（"要求登录"）不一致。
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const $ = await loadPage()
  if (!$) return NextResponse.json({ upcomingToday: [], upcoming: [], upcomingBaoliao: [], updates: [], hotItems: [] })

  const [hotItems] = await Promise.all([fetchHotChart()])

  const upcomingPanel = parsePanel($, '1')
  const updatesPanel = parsePanel($, '3')

  return NextResponse.json({
    upcomingToday: upcomingPanel.today,
    upcoming: upcomingPanel.upcoming,
    baoliao: [...upcomingPanel.baoliao, ...updatesPanel.baoliao],
    updates: [...updatesPanel.today, ...updatesPanel.upcoming],
    hotItems,
  })
}
