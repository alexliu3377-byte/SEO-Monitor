import * as cheerio from 'cheerio'
import * as iconv from 'iconv-lite'

export interface PageEntry {
  title: string
  date?: string
  url: string
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

export function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function randomDelay(minMs: number, maxMs: number) {
  return new Promise((r) => setTimeout(r, minMs + Math.floor(Math.random() * (maxMs - minMs))))
}

function getBrowserHeaders() {
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Referer': 'https://www.baidu.com/',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
  }
}

const DOWNLOAD_KEYWORDS = [
  '手机版', '安卓版', 'ios版', '苹果版', '下载', 'app', 'apk',
  '电脑版', 'pc版', '破解版', '免费版', '中文版', '汉化版',
  '老版本', '网页版', 'h5版', '不用登录', '离线版',
]

// Build headers that look like same-site navigation (avoids 403 from Referer/Sec-Fetch-Site checks)
function getSiteHeaders(url: string, cookieJar?: string): Record<string, string> {
  const origin = new URL(url).origin
  const h: Record<string, string> = {
    ...getBrowserHeaders(),
    Referer: origin + '/',
    'Sec-Fetch-Site': 'same-origin',
  }
  if (cookieJar) h['Cookie'] = cookieJar
  return h
}

// Warm-up headers: simulate direct URL visit (no Referer, Sec-Fetch-Site: none)
function getDirectHeaders(): Record<string, string> {
  const { Referer: _r, 'Sec-Fetch-Site': _s, ...base } = getBrowserHeaders()
  return { ...base, 'Sec-Fetch-Site': 'none' }
}

// Fetch HTML with automatic charset detection (handles GBK/GB2312 sites)
async function fetchHtmlDecoded(url: string, headers: Record<string, string>): Promise<{ ok: boolean; html: string; status?: number; setCookies: string[] }> {
  try {
    const res = await fetch(url, { headers, next: { revalidate: 0 }, signal: AbortSignal.timeout(10000) })
    const setCookies = res.headers.getSetCookie?.() ?? []
    if (!res.ok) return { ok: false, html: '', status: res.status, setCookies }
    const buffer = Buffer.from(await res.arrayBuffer())
    // ASCII-safe peek to detect charset without corrupting data
    const peek = buffer.subarray(0, 4096).toString('ascii')
    const ctCharset = (res.headers.get('content-type') || '').match(/charset=([^\s;]+)/i)?.[1]?.toLowerCase()
    const metaCharset = peek.match(/<meta[^>]+charset=["']?\s*([^"'\s;>]+)/i)?.[1]?.toLowerCase()
    const raw = ctCharset || metaCharset || 'utf-8'
    const charset = (raw === 'gb2312' || raw === 'gb18030') ? 'gbk' : raw
    return { ok: true, html: iconv.decode(buffer, charset), setCookies }
  } catch {
    return { ok: false, html: '', setCookies: [] }
  }
}

// Fetch HTML list page and extract titles/dates
export async function fetchHtmlList(
  url: string,
  titleSelector: string,
  dateSelector: string
): Promise<PageEntry[]> {
  const { ok, html, status } = await fetchHtmlDecoded(url, getSiteHeaders(url))
  if (!ok) throw new Error(`Failed to fetch HTML list: ${status}`)
  const $ = cheerio.load(html)

  const entries: PageEntry[] = []
  const titleEls = $(titleSelector)

  titleEls.each((_, el) => {
    const title = $(el).text().trim()
    const href = $(el).attr('href') || $(el).closest('a').attr('href') || $(el).find('a').first().attr('href') || ''
    const fullUrl = href.startsWith('http') ? href : new URL(href, url).href

    let date: string | undefined
    if (dateSelector) {
      let container = $(el).closest('li, article, .item, tr, p, dd')
      if (!container.length) container = $(el).closest('div').parent()
      const dateEl = container.find(dateSelector).first()
      if (dateEl.length) date = dateEl.text().trim()
    }

    if (title) entries.push({ title, date, url: fullUrl })
  })

  return entries
}

// Try to find the "next page" link on a page
function findNextPageUrl($: ReturnType<typeof cheerio.load>, currentUrl: string): string | null {
  const nextTexts = ['下一页', '下一頁', '>', '›', '»', 'Next', 'next']
  for (const text of nextTexts) {
    let el = $(`a`).filter((_, node) => $(node).text().trim() === text).first()
    if (!el.length) el = $(`a[class*="next"]`).first()
    if (el.length) {
      const href = el.attr('href')
      if (href && !href.includes('javascript') && !href.startsWith('#')) {
        return href.startsWith('http') ? href : new URL(href, currentUrl).href
      }
    }
  }
  return null
}

// Parse a date string like "2026-06-09 17:04", "2026/06/09", "26-07-01", or Chinese relative times to YYYY-MM-DD
function parseEntryDateStr(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  // 4-digit year: 2026-07-01
  const m = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // 2-digit year: 26-07-01 → 2026-07-01
  const m2 = dateStr.match(/^(\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (m2) return `20${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`
  // Relative times (MYT UTC+8)
  const myt = (offsetDays: number) => new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
  if (/^\d+(?:分钟|小时)前$/.test(dateStr)) return myt(0)
  if (dateStr === '昨天' || dateStr === '一天前') return myt(-1)
  const daysAgo = dateStr.match(/^(\d+)天前$/)
  if (daysAgo) return myt(-parseInt(daysAgo[1]))
  // MM-DD anywhere in the string (e.g. "07-20", "更新：06-28")
  const md = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})/)
  if (md) {
    const mm = parseInt(md[1]); const dd = parseInt(md[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const todayMYT = myt(0)
      const year = todayMYT.slice(0, 4)
      const candidate = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      return candidate <= todayMYT ? candidate : `${parseInt(year) - 1}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }
  return null
}

export interface HtmlSource {
  url: string
  titleSelector: string
  dateSelector: string
  urlSelector?: string
}

// Fetch multiple HTML sources (each with own selectors) with auto-pagination
// Stops when all entries on a page are older than cutoffDateStr
export async function fetchHtmlListPages(
  sources: HtmlSource[],
  cutoffDateStr: string,
  maxPages = 5,
  skipPageDelay = false
): Promise<PageEntry[]> {
  const all: PageEntry[] = []

  for (const source of sources) {
    let currentUrl: string | null = source.url
    let page = 0

    // Warm-up request to root domain so sites with cookie challenges serve real content
    let cookieJar = ''
    try {
      const origin = new URL(source.url).origin
      const { setCookies } = await fetchHtmlDecoded(origin, getDirectHeaders())
      if (setCookies.length) {
        cookieJar = setCookies.map((c) => c.split(';')[0]).join('; ')
        await randomDelay(1000, 2000)
      }
    } catch { /* warmup failure is non-fatal */ }

    while (currentUrl && page < maxPages) {
      page++
      try {
        const { ok, html, setCookies } = await fetchHtmlDecoded(currentUrl, getSiteHeaders(currentUrl, cookieJar || undefined))

        // Accumulate cookies for subsequent page requests
        if (setCookies.length) {
          const fresh = setCookies.map((c) => c.split(';')[0]).join('; ')
          cookieJar = cookieJar ? `${cookieJar}; ${fresh}` : fresh
        }

        if (!ok) break
        const $ = cheerio.load(html)

        const pageEntries: PageEntry[] = []
        $(source.titleSelector).each((_, el) => {
          const title = $(el).text().trim()
          const defaultHref = $(el).attr('href') || $(el).closest('a').attr('href') || $(el).find('a').first().attr('href') || ''
          let href = defaultHref
          if (source.urlSelector) {
            let container = $(el).closest('li, article, .item, tr, p, dd')
            if (!container.length) container = $(el).closest('div').parent()
            href = container.find(source.urlSelector).first().attr('href') || ''
          }
          const fullUrl = href.startsWith('http') ? href : (href ? new URL(href, currentUrl!).href : '')
          let date: string | undefined
          if (source.dateSelector) {
            let container = $(el).closest('li, article, .item, tr, p, dd')
            if (!container.length) container = $(el).closest('div').parent()
            const dateEl = container.find(source.dateSelector).first()
            if (dateEl.length) date = dateEl.text().trim()
          }
          if (title) pageEntries.push({ title, date, url: fullUrl })
        })

        all.push(...pageEntries)

        const datedEntries = pageEntries.map((e) => parseEntryDateStr(e.date)).filter(Boolean) as string[]
        if (datedEntries.length > 0 && datedEntries.every((d) => d < cutoffDateStr)) break
        // Entries with an unparseable date still get kept below (better to risk
        // including something stale than silently drop something genuinely new
        // when the date text just wasn't in a recognized format) — but if EVERY
        // entry on this page failed to parse a date, the date_selector is most
        // likely broken outright, not just hitting an odd format. In that case
        // don't compound it by fetching maxPages worth of content that can't be
        // freshness-checked at all — stop after this page.
        if (pageEntries.length > 0 && datedEntries.length === 0) break

        currentUrl = findNextPageUrl($, currentUrl)
        if (currentUrl && !skipPageDelay) await randomDelay(10000, 15000)
      } catch {
        break
      }
    }
  }

  return all.filter((e) => {
    const d = parseEntryDateStr(e.date)
    return !d || d >= cutoffDateStr
  })
}

// Fetch a JSON API that returns HTML fragments in a `html` field.
// URL template must contain {page} placeholder (e.g. https://api.example.com/more?page={page}&cid=1).
// Pagination stops when `data.more === 0`, `more === 0`, or the html field is empty.
export async function fetchJsonHtmlPages(
  urlTemplate: string,
  titleSelector: string,
  dateSelector: string,
  urlSelector: string | undefined,
  cutoffDateStr: string,
  maxPages = 30,
): Promise<PageEntry[]> {
  const all: PageEntry[] = []
  const origin = new URL(urlTemplate.replace('{page}', '1')).origin

  for (let page = 1; page <= maxPages; page++) {
    const url = urlTemplate.replace('{page}', String(page))
    try {
      const headers: Record<string, string> = {
        'User-Agent': randomUA(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': origin + '/',
        'X-Requested-With': 'XMLHttpRequest',
      }
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
      if (!res.ok) break

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await res.json()
      const html: string = json?.data?.html ?? json?.html ?? ''
      const more: number = json?.data?.more ?? json?.more ?? 0

      if (!html.trim()) break

      const $ = cheerio.load(html)
      const pageEntries: PageEntry[] = []

      $(titleSelector).each((_, el) => {
        const title = $(el).text().trim()
        let href = $(el).attr('href') || ''
        if (urlSelector) {
          let container = $(el).closest('li, article, .item, tr, p, dd')
          if (!container.length) container = $(el).closest('div').parent()
          href = container.find(urlSelector).first().attr('href') || href
        }
        const fullUrl = href.startsWith('http') ? href : (href ? new URL(href, origin).href : '')

        let date: string | undefined
        if (dateSelector) {
          let container = $(el).closest('li, article, .item, tr, p, dd')
          if (!container.length) container = $(el).closest('div').parent()
          const dateEl = container.find(dateSelector).first()
          if (dateEl.length) date = dateEl.text().trim()
        }

        if (title) pageEntries.push({ title, date, url: fullUrl })
      })

      all.push(...pageEntries)

      if (more === 0) break

      // Stop early if all dated entries on this page are older than the cutoff
      const datedOnPage = pageEntries.map((e) => parseEntryDateStr(e.date)).filter(Boolean) as string[]
      if (datedOnPage.length > 0 && datedOnPage.every((d) => d < cutoffDateStr)) break
      // Every entry on this page failed to parse a date at all — the date_selector
      // is most likely broken, not just hitting an odd format. Don't compound it
      // by fetching up to maxPages (30 for this JSON mode) worth of unverifiable
      // content — stop after this page. See fetchHtmlListPages for the same guard.
      if (pageEntries.length > 0 && datedOnPage.length === 0) break

      await randomDelay(2000, 4000)
    } catch {
      break
    }
  }

  return all.filter((e) => {
    const d = parseEntryDateStr(e.date)
    return !d || d >= cutoffDateStr
  })
}

// Clean title by removing v-prefixed version numbers and everything after them.
// e.g. "使命召唤v2.3.1安卓版" → "使命召唤"
//      "我的世界1.20.4中文版v1.20.4" → "我的世界1.20.4中文版"
//      "守护者最新版" → unchanged (no v prefix)
export function cleanTitle(title: string, enableVersionClean: boolean): string {
  if (!enableVersionClean) return title
  return title.replace(/\s*[vV]\d+(?:\.\d+)*.*/g, '').replace(/\s{2,}/g, ' ').trim()
}

// Filter keywords that contain download-related attributes
export function filterDownloadKeywords(keywords: string[]): string[] {
  return keywords.filter((kw) =>
    DOWNLOAD_KEYWORDS.some((dk) => kw.toLowerCase().includes(dk.toLowerCase()))
  )
}

function parseIpRange(text: string): { min: number; max: number; avg: number } {
  const parts = text.replace(/,/g, '').split('~').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
  if (parts.length === 0) return { min: 0, max: 0, avg: 0 }
  const min = parts[0]
  const max = parts.length > 1 ? parts[1] : parts[0]
  return { min, max, avg: Math.round((min + max) / 2) }
}

// Fetch weight, index count, and IP data from aizhan.com (single request)
export async function fetchAizhanData(domain: string): Promise<{
  pc: number; mobile: number; indexCount: number
  pcIpMin: number; pcIpMax: number; pcIpAvg: number
  mobileIpMin: number; mobileIpMax: number; mobileIpAvg: number
}> {
  const empty = { pc: 0, mobile: 0, indexCount: 0, pcIpMin: 0, pcIpMax: 0, pcIpAvg: 0, mobileIpMin: 0, mobileIpMax: 0, mobileIpAvg: 0 }
  try {
    const res = await fetch(`https://www.aizhan.com/cha/${domain}/`, {
      headers: { ...getBrowserHeaders(), Referer: 'https://www.aizhan.com/' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return empty
    const html = await res.text()
    const $ = cheerio.load(html)

    const pc = parseInt($('#baidurank_br img').attr('alt') || '0', 10)
    const mobile = parseInt($('#baidurank_mbr img').attr('alt') || '0', 10)
    const indexRaw = $('#shoulu1_baidu a').first().text().replace(/[^0-9]/g, '')
    const indexCount = parseInt(indexRaw || '0', 10)
    const pcRange = parseIpRange($('#baidurank_ip').text())
    const mobileRange = parseIpRange($('#baidurank_m_ip').text())

    return {
      pc: isNaN(pc) ? 0 : pc,
      mobile: isNaN(mobile) ? 0 : mobile,
      indexCount: isNaN(indexCount) ? 0 : indexCount,
      pcIpMin: pcRange.min, pcIpMax: pcRange.max, pcIpAvg: pcRange.avg,
      mobileIpMin: mobileRange.min, mobileIpMax: mobileRange.max, mobileIpAvg: mobileRange.avg,
    }
  } catch {
    return empty
  }
}

function getRankHeaders(ua: string) {
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://baidurank.aizhan.com/',
  }
}

// Parse a rankup/rankdown listing page's <tbody> rows (keyword + volume only).
// Shared by the fetch-based path (fetchRankPage) and the Playwright-based path
// in lib/crawler-browser.ts, which navigates the same pages with a real browser.
export function parseSimpleRankRows(html: string): { keyword: string; volume: number }[] {
  const $ = cheerio.load(html)
  const results: { keyword: string; volume: number }[] = []
  $('tbody tr').each((_, tr) => {
    const keyword = $(tr).find('td.title a').first().text().trim()
    const volume = parseInt($(tr).find('td.ip').eq(2).text().trim(), 10) || 0
    if (keyword) results.push({ keyword, volume })
  })
  return results
}

// Parse a rankup/rankdown listing page's <tbody> rows, including rank position
// and title/url columns. Shared by fetchRankdownPage/fetchRankupPage (fetch-based)
// and the Playwright-based path in lib/crawler-browser.ts.
export function parseTitledRankRows(html: string): { keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[] {
  const $ = cheerio.load(html)
  const results: { keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[] = []
  $('tbody tr').each((_, tr) => {
    const keyword = $(tr).find('td.title a').first().text().trim()
    const rank_position = parseRankPosition($(tr).find('td.ip').eq(0).text().trim())
    const prev_rank = parseRankPosition($(tr).find('td.ip').eq(1).text().trim())
    const volume = parseInt($(tr).find('td.ip').eq(2).text().trim(), 10) || 0
    // Title is the 6th column (index 5); falls back to last td
    const titleTd = $(tr).find('td').eq(5)
    const title = (titleTd.length ? titleTd : $(tr).find('td').last()).text().trim()
    // URL is the href on the 标题 column anchor (second td.title in the row)
    const url = $(tr).find('td.title').last().find('a').first().attr('href') || ''
    if (keyword) results.push({ keyword, volume, title, url, rank_position, prev_rank })
  })
  return results
}

async function fetchRankPage(
  domain: string,
  type: string,
  rankPos: number,
  date: string,
  page: number,
  cookie = '',
  ua: string,
  isToday = false
): Promise<{ keyword: string; volume: number }[] | null> {
  const suffix = page === 1 ? '' : `${page}/`
  // Today's aizhan URLs omit the date segment for both rankup and rankdown
  const url = isToday
    ? `https://baidurank.aizhan.com/mobile/${domain}/${type}/${rankPos}/${suffix}`
    : `https://baidurank.aizhan.com/mobile/${domain}/${type}/${rankPos}/${date}/${suffix}`
  try {
    const headers: Record<string, string> = { ...getRankHeaders(ua) }
    if (cookie) headers['Cookie'] = cookie

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 0 },
    })
    if (!res.ok) return []
    const html = await res.text()

    // Detect anti-bot JS challenge: sets a cookie and redirects
    // Handle both first-time (no cookie) and cookie-expiry (new challenge with existing cookie)
    const cookieMatch = html.match(/\.cookie\s*=\s*"([^"]+)"/)
    if (cookieMatch) {
      const challengeCookie = cookieMatch[1].split(';')[0]
      if (challengeCookie === cookie) return []  // same cookie returned — stuck, bail out
      return fetchRankPage(domain, type, rankPos, date, page, challengeCookie, ua, isToday)
    }

    // 检测登录墙：返回了登录页而非排名数据（null = 被拦截，区别于 [] = 无数据）
    if (!html.includes('<tbody') && (html.includes('login_fixedt') || html.includes('wic_login') || html.includes('请登录'))) {
      return null
    }

    return parseSimpleRankRows(html)
  } catch {
    return []
  }
}

// Pre-fetch the JS challenge cookie for a domain so all subsequent requests
// can skip the challenge round-trip (aizhan added this protection ~2026-06-19).
// Cookie has path=/ and max-age=300, so it's valid for all pages of the same domain.
async function prefetchRankCookie(domain: string, type: string, date: string, ua: string, overrideUrl?: string): Promise<string> {
  try {
    const url = overrideUrl ?? `https://baidurank.aizhan.com/mobile/${domain}/${type}/1/${date}/`
    const res = await fetch(url, { headers: getRankHeaders(ua), signal: AbortSignal.timeout(8000), next: { revalidate: 0 } })
    const html = await res.text()
    const m = html.match(/\.cookie\s*=\s*"([^"]+)"/)
    return m ? m[1].split(';')[0] : ''
  } catch {
    return ''
  }
}

// Fetch all rank changes (涨入 or 跌出) for a domain on a given date.
// The 5 rank positions run in parallel; within each position pages are fetched
// sequentially with 300ms delay and stop as soon as a page returns empty.
// A single UA is chosen per call so retries (in route.ts) naturally rotate to a fresh UA.
export async function fetchRankChanges(
  domain: string,
  date: string,
  type: 'rankup' | 'rankdown'
): Promise<{ keyword: string; volume: number }[]> {
  const ua = randomUA()
  const todayMY = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const isToday = date === todayMY
  const prefetchOverride = isToday
    ? `https://baidurank.aizhan.com/mobile/${domain}/${type}/1/`
    : undefined
  const sharedCookie = await prefetchRankCookie(domain, type, date, ua, prefetchOverride)

  const allResults = await Promise.all(
    [1, 2, 3, 4, 5].map(async (rankPos) => {
      const entries: { keyword: string; volume: number }[] = []
      for (let page = 1; page <= 15; page++) {
        const pageEntries = await fetchRankPage(domain, type, rankPos, date, page, sharedCookie, ua, isToday)
        if (pageEntries === null) throw new Error('AIZHAN_LOGIN_WALL')
        if (pageEntries.length === 0) break
        entries.push(...pageEntries.filter((e) => e.volume > 0))
        if (page < 15) await new Promise((r) => setTimeout(r, 300))
      }
      return entries
    })
  )

  // Dedup by keyword — same keyword can rank in multiple positions, keep highest volume
  const seen = new Map<string, number>()
  for (const e of allResults.flat()) {
    if (!seen.has(e.keyword) || e.volume > (seen.get(e.keyword) ?? 0)) {
      seen.set(e.keyword, e.volume)
    }
  }
  return Array.from(seen.entries()).map(([keyword, volume]) => ({ keyword, volume }))
}

// Fetch one page of rankdown results including the title column (标题).
// Today's aizhan URL omits the date segment: /rankdown/{rankPos}/{page}/
// Past dates include it:                      /rankdown/{rankPos}/{date}/{page}/
async function fetchRankdownPage(
  domain: string,
  rankPos: number,
  date: string,
  page: number,
  cookie = '',
  ua: string,
  isToday = false,
  platform: 'mobile' | 'pc' = 'mobile'
): Promise<{ keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[]> {
  const pageSuffix = page === 1 ? '' : `${page}/`
  const prefix = platform === 'pc' ? 'baidu' : 'mobile'
  const reqUrl = isToday
    ? `https://baidurank.aizhan.com/${prefix}/${domain}/rankdown/${rankPos}/${pageSuffix}`
    : `https://baidurank.aizhan.com/${prefix}/${domain}/rankdown/${rankPos}/${date}/${pageSuffix}`
  try {
    const headers: Record<string, string> = { ...getRankHeaders(ua) }
    if (cookie) headers['Cookie'] = cookie
    const res = await fetch(reqUrl, { headers, signal: AbortSignal.timeout(8000), next: { revalidate: 0 } })
    if (!res.ok) return []
    const html = await res.text()
    const cookieMatch = html.match(/\.cookie\s*=\s*"([^"]+)"/)
    if (cookieMatch) {
      const challengeCookie = cookieMatch[1].split(';')[0]
      if (challengeCookie === cookie) return []
      return fetchRankdownPage(domain, rankPos, date, page, challengeCookie, ua, isToday, platform)
    }
    return parseTitledRankRows(html)
  } catch {
    return []
  }
}

// Fetch all rankdown (跌出) keywords for a domain on a given date, including page title.
// Crawls all 5 rank positions in parallel, deduped by keyword (highest volume wins).
export async function fetchRankdownWithTitle(
  domain: string,
  date: string,
  platform: 'mobile' | 'pc' = 'mobile'
): Promise<{ keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[]> {
  const ua = randomUA()
  const todayMY = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const isToday = date === todayMY
  const prefix = platform === 'pc' ? 'baidu' : 'mobile'
  const prefetchUrl = isToday
    ? `https://baidurank.aizhan.com/${prefix}/${domain}/rankdown/1/`
    : undefined
  const sharedCookie = await prefetchRankCookie(domain, 'rankdown', date, ua, prefetchUrl)

  const allResults = await Promise.all(
    [1, 2, 3, 4, 5].map(async (rankPos) => {
      const entries: { keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[] = []
      for (let page = 1; page <= 15; page++) {
        const pageEntries = await fetchRankdownPage(domain, rankPos, date, page, sharedCookie, ua, isToday, platform)
        if (pageEntries.length === 0) break
        entries.push(...pageEntries)
        if (page < 15) await new Promise((r) => setTimeout(r, 300))
      }
      return entries
    })
  )

  const seen = new Map<string, { volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }>()
  for (const e of allResults.flat()) {
    const cur = seen.get(e.keyword)
    if (!cur || e.volume > cur.volume) seen.set(e.keyword, { volume: e.volume, title: e.title, url: e.url, rank_position: e.rank_position, prev_rank: e.prev_rank })
  }
  return Array.from(seen.entries())
    .map(([keyword, { volume, title, url, rank_position, prev_rank }]) => ({ keyword, volume, title, url, rank_position, prev_rank }))
    .sort((a, b) => b.volume - a.volume)
}

// Fetch one page of rankup results including the title column (标题).
async function fetchRankupPage(
  domain: string,
  rankPos: number,
  date: string,
  page: number,
  cookie = '',
  ua: string,
  isToday = false,
  platform: 'mobile' | 'pc' = 'mobile'
): Promise<{ keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[]> {
  const pageSuffix = page === 1 ? '' : `${page}/`
  const prefix = platform === 'pc' ? 'baidu' : 'mobile'
  const reqUrl = isToday
    ? `https://baidurank.aizhan.com/${prefix}/${domain}/rankup/${rankPos}/${pageSuffix}`
    : `https://baidurank.aizhan.com/${prefix}/${domain}/rankup/${rankPos}/${date}/${pageSuffix}`
  try {
    const headers: Record<string, string> = { ...getRankHeaders(ua) }
    if (cookie) headers['Cookie'] = cookie
    const res = await fetch(reqUrl, { headers, signal: AbortSignal.timeout(8000), next: { revalidate: 0 } })
    if (!res.ok) return []
    const html = await res.text()
    const cookieMatch = html.match(/\.cookie\s*=\s*"([^"]+)"/)
    if (cookieMatch) {
      const challengeCookie = cookieMatch[1].split(';')[0]
      if (challengeCookie === cookie) return []
      return fetchRankupPage(domain, rankPos, date, page, challengeCookie, ua, isToday, platform)
    }
    return parseTitledRankRows(html)
  } catch {
    return []
  }
}

// Fetch all rankup (涨入) keywords for a domain on a given date, including page title.
export async function fetchRankupWithTitle(
  domain: string,
  date: string,
  platform: 'mobile' | 'pc' = 'mobile'
): Promise<{ keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[]> {
  const ua = randomUA()
  const prefix = platform === 'pc' ? 'baidu' : 'mobile'
  const todayMY = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const isToday = date === todayMY
  const prefetchUrl = isToday
    ? `https://baidurank.aizhan.com/${prefix}/${domain}/rankup/1/`
    : undefined
  const sharedCookie = await prefetchRankCookie(domain, 'rankup', date, ua, prefetchUrl)

  const allResults = await Promise.all(
    [1, 2, 3, 4, 5].map(async (rankPos) => {
      const entries: { keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[] = []
      for (let page = 1; page <= 15; page++) {
        const pageEntries = await fetchRankupPage(domain, rankPos, date, page, sharedCookie, ua, isToday, platform)
        if (pageEntries.length === 0) break
        entries.push(...pageEntries)
        if (page < 15) await new Promise((r) => setTimeout(r, 300))
      }
      return entries
    })
  )

  const seen = new Map<string, { volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }>()
  for (const e of allResults.flat()) {
    const cur = seen.get(e.keyword)
    if (!cur || e.volume > cur.volume) seen.set(e.keyword, { volume: e.volume, title: e.title, url: e.url, rank_position: e.rank_position, prev_rank: e.prev_rank })
  }
  return Array.from(seen.entries())
    .map(([keyword, { volume, title, url, rank_position, prev_rank }]) => ({ keyword, volume, title, url, rank_position, prev_rank }))
    .sort((a, b) => b.volume - a.volume)
}

// Parse rank position text like "第11名" → 11; "50名外" / unknown → null
function parseRankPosition(text: string): number | null {
  const m = text.match(/第(\d+)名/)
  return m ? parseInt(m[1], 10) : null
}

async function fetchRankPositionPage(
  domain: string,
  type: 'rankup' | 'rankdown',
  platform: 'mobile' | 'pc',
  rankPos: number,
  date: string,
  page: number,
  cookie = '',
  ua: string,
  isToday = false
): Promise<{ keyword: string; volume: number; rank_position: number | null; prev_rank: number | null }[] | null> {
  const pageSuffix = page === 1 ? '' : `${page}/`
  const prefix = platform === 'pc' ? 'baidu' : 'mobile'
  const url = isToday
    ? `https://baidurank.aizhan.com/${prefix}/${domain}/${type}/${rankPos}/${pageSuffix}`
    : `https://baidurank.aizhan.com/${prefix}/${domain}/${type}/${rankPos}/${date}/${pageSuffix}`
  try {
    const headers: Record<string, string> = { ...getRankHeaders(ua) }
    if (cookie) headers['Cookie'] = cookie
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000), next: { revalidate: 0 } })
    if (!res.ok) return []
    const html = await res.text()
    const cookieMatch = html.match(/\.cookie\s*=\s*"([^"]+)"/)
    if (cookieMatch) {
      const challengeCookie = cookieMatch[1].split(';')[0]
      if (challengeCookie === cookie) return []
      return fetchRankPositionPage(domain, type, platform, rankPos, date, page, challengeCookie, ua, isToday)
    }
    if (!html.includes('<tbody') && (html.includes('login_fixedt') || html.includes('wic_login') || html.includes('请登录'))) {
      return null
    }
    const $ = cheerio.load(html)
    const results: { keyword: string; volume: number; rank_position: number | null; prev_rank: number | null }[] = []
    $('tbody tr').each((_, tr) => {
      const keyword = $(tr).find('td.title a').first().text().trim()
      const newRankText = $(tr).find('td.ip').eq(0).text().trim()
      const prevRankText = $(tr).find('td.ip').eq(1).text().trim()
      const volume = parseInt($(tr).find('td.ip').eq(2).text().trim(), 10) || 0
      if (keyword) results.push({
        keyword,
        volume,
        rank_position: parseRankPosition(newRankText),
        prev_rank: parseRankPosition(prevRankText),
      })
    })
    return results
  } catch {
    return []
  }
}

// Fetch all rank position entries (涨入 or 跌出) for a domain, including volume=0.
// Supports both mobile (/mobile/) and PC (/baidu/) platforms.
// Returns rank_position (新排名) and prev_rank (原排名) parsed from the table.
export async function fetchRankPositions(
  domain: string,
  date: string,
  type: 'rankup' | 'rankdown',
  platform: 'mobile' | 'pc'
): Promise<{ keyword: string; volume: number; rank_position: number | null; prev_rank: number | null }[]> {
  const ua = randomUA()
  const prefix = platform === 'pc' ? 'baidu' : 'mobile'
  const todayMY = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const isToday = date === todayMY
  const prefetchUrl = isToday
    ? `https://baidurank.aizhan.com/${prefix}/${domain}/${type}/1/`
    : `https://baidurank.aizhan.com/${prefix}/${domain}/${type}/1/${date}/`
  const sharedCookie = await prefetchRankCookie(domain, type, date, ua, prefetchUrl)

  const allResults = await Promise.all(
    [1, 2, 3, 4, 5].map(async (rankPos) => {
      const entries: { keyword: string; volume: number; rank_position: number | null; prev_rank: number | null }[] = []
      for (let page = 1; page <= 15; page++) {
        const pageEntries = await fetchRankPositionPage(domain, type, platform, rankPos, date, page, sharedCookie, ua, isToday)
        if (pageEntries === null) throw new Error('AIZHAN_LOGIN_WALL')
        if (pageEntries.length === 0) break
        entries.push(...pageEntries)
        if (page < 15) await new Promise((r) => setTimeout(r, 300))
      }
      return entries
    })
  )

  // Dedup by keyword — keep highest volume; ties prefer lower (better) rank_position
  const seen = new Map<string, { volume: number; rank_position: number | null; prev_rank: number | null }>()
  for (const e of allResults.flat()) {
    const cur = seen.get(e.keyword)
    const betterRank = e.rank_position !== null && (cur?.rank_position === null || (cur?.rank_position ?? Infinity) > e.rank_position)
    if (!cur || e.volume > cur.volume || (e.volume === cur.volume && betterRank)) {
      seen.set(e.keyword, { volume: e.volume, rank_position: e.rank_position, prev_rank: e.prev_rank })
    }
  }
  return Array.from(seen.entries()).map(([keyword, v]) => ({ keyword, ...v }))
}

// @deprecated use fetchAizhanData instead
export async function fetchAizhanWeight(domain: string): Promise<{ pc: number; mobile: number }> {
  const { pc, mobile } = await fetchAizhanData(domain)
  return { pc, mobile }
}

export interface BaiduIndexedPage {
  url: string          // display URL from mu attribute (e.g. "www.example.com/page/title")
  title: string        // page title
  snippet: string      // description snippet (≤200 chars)
  baiduDateStr: string | null  // actual date in YYYY-MM-DD (converted from "3天前", "2026年6月1日" etc.)
}

// Convert Baidu relative/Chinese date text to YYYY-MM-DD using MYT (UTC+8)
function parseBaiduRelativeDate(text: string): string | null {
  const nowMYT = Date.now() + 8 * 3600000
  const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

  const daysAgo = text.match(/^(\d+)天前$/)
  // Baidu uses ordinal counting: today=1, yesterday=2天前, day-before=3天前, so subtract N-1 days
  if (daysAgo) return toDate(nowMYT - (parseInt(daysAgo[1]) - 1) * 86400000)
  if (/^\d+(?:小时|分钟)前$/.test(text)) return toDate(nowMYT)
  if (text === '昨天') return toDate(nowMYT - 86400000)
  const m1 = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/)
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return null
}

export type BaiduIndexFailReason = 'captcha' | 'no_content' | 'http_error' | 'empty_results' | null

// Fetch Baidu site: search results to discover ALL currently indexed pages.
// Uses pn= parameter for reliable pagination (no time filter, no page cap).
// Stops only when a page returns 0 results, a captcha is hit, or an HTTP error occurs.
// onPageResults: optional callback invoked after each page — enables incremental saving
//   so partial crawls (timeout mid-way) still persist what was collected.
export async function fetchBaiduIndexPages(
  domain: string,
  onPageResults?: (batch: BaiduIndexedPage[]) => Promise<void>,
  initialCookie?: string,
  customBaseUrl?: string,
): Promise<{ pages: BaiduIndexedPage[]; failReason: BaiduIndexFailReason }> {
  const results: BaiduIndexedPage[] = []
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()
  const domainRoot = domain.replace(/^www\./i, '').toLowerCase()
  const datePattern = /^\d+(?:天|小时|分钟)前$|^昨天$|^\d{4}年\d{1,2}月\d{1,2}日$|^\d{4}-\d{2}-\d{2}$/

  // If user provided cookies, use them directly; otherwise pre-fetch Baidu homepage to acquire session cookies
  let sessionCookie = initialCookie?.trim() ?? ''
  let cookieSource: 'caller' | 'auto-fallback' = sessionCookie ? 'caller' : 'auto-fallback'
  if (!sessionCookie) {
    try {
      const homeRes = await fetch('https://www.baidu.com/', {
        headers: { ...getBrowserHeaders(), Referer: 'https://www.baidu.com/' },
        signal: AbortSignal.timeout(8000),
      })
      const setCookies = homeRes.headers.getSetCookie?.() ?? []
      sessionCookie = setCookies.map((c: string) => c.split(';')[0]).join('; ')
    } catch { /* ignore — proceed without cookie */ }
  }
  // Diagnostic (2026-07-27): fingerprint only (name count + total length), never the raw cookie value.
  const cookieNames = sessionCookie ? sessionCookie.split(';').map((c) => c.trim().split('=')[0]).join(',') : '(none)'
  console.log(`    [${domain}] cookie来源=${cookieSource} 字段数=${sessionCookie ? sessionCookie.split(';').length : 0} 长度=${sessionCookie.length} names=${cookieNames}`)

  let failReason: BaiduIndexFailReason = null
  let consecutiveDupPages = 0
  let prevPageUrlSet = new Set<string>()  // URLs from the previous page for loop detection

  // Use caller-supplied URL (e.g. a specific Baidu search with gpc/ct filters) when provided;
  // otherwise plain site: query without extra params — matches what a user types in Baidu.
  const baseUrl = customBaseUrl ?? `https://www.baidu.com/s?wd=${encodeURIComponent(`site:${domain}`)}`

  for (let page = 0; page < 500; page++) {
    const pn = page * 10
    const currentUrl = pn === 0 ? baseUrl : `${baseUrl}&pn=${pn}`
    const referer = page === 0 ? 'https://www.baidu.com/' : `${baseUrl}&pn=${(page - 1) * 10}`
    try {
      const headers: Record<string, string> = { ...getBrowserHeaders(), Referer: referer }
      if (sessionCookie) headers['Cookie'] = sessionCookie

      const fetchStartedAt = new Date().toISOString()
      const { ok, html, setCookies } = await fetchHtmlDecoded(currentUrl, headers)
      if (!ok || !html) {
        failReason = 'http_error'
        console.log(`    [${domain}] 第${page}页 ${fetchStartedAt} ✗ http_error（ok=${ok} htmlLen=${html?.length ?? 0}）`)
        break
      }

      // Update session cookie from each page's Set-Cookie (Baidu rotates anti-bot tokens per request)
      if (setCookies.length > 0) {
        const newPairs = setCookies.map((c: string) => c.split(';')[0]).join('; ')
        sessionCookie = sessionCookie ? `${sessionCookie}; ${newPairs}` : newPairs
      }

      if (html.includes('百度安全验证') || html.includes('verify')) {
        failReason = 'captcha'
        console.log(`    [${domain}] 第${page}页 ${fetchStartedAt} ✗ captcha拦截`)
        break
      }
      if (!html.includes('content_left')) {
        failReason = 'no_content'
        console.log(`    [${domain}] 第${page}页 ${fetchStartedAt} ✗ no_content（无content_left，htmlLen=${html.length}）`)
        break
      }

      const $ = cheerio.load(html)
      let rawCount = 0   // how many results Baidu actually returned (before dedup)
      let pageCount = 0  // how many new unique results added this page

      // Find titles first, then walk up to the nearest [mu] container.
      // This handles any nesting depth — sitelinks and regular results alike.
      const thisPageUrlSet = new Set<string>()
      $('#content_left h3 a').each((_, titleEl) => {
        const $titleEl = $(titleEl)
        const titleText = $titleEl.text().replace(/\s+/g, ' ').trim()
        if (!titleText) return
        rawCount++  // count ALL results Baidu returned, even duplicates

        // Walk up to find the ancestor with the real URL in mu attribute (before dedup checks,
        // so we can track all URLs on this page for loop detection)
        const $container = $titleEl.closest('[mu]')
        if (!$container.length) return

        const mu = ($container.attr('mu') || '').trim()
        if (!mu || !mu.toLowerCase().includes(domainRoot)) return
        const displayUrl = mu.replace(/^https?:\/\//i, '')
        thisPageUrlSet.add(displayUrl)

        if (seenTitles.has(titleText)) return
        if (seenUrls.has(displayUrl)) return

        seenUrls.add(displayUrl)
        seenTitles.add(titleText)

        // Snippet: new Baidu uses summary-text class; fall back to abstract or longest block
        let snippet = $container.find('[class*="summary-text"]').first().text().replace(/\s+/g, ' ').trim()
        if (!snippet) snippet = $container.find('[class*="abstract"]').first().text().replace(/\s+/g, ' ').trim()
        if (!snippet) {
          $container.find('p, span').each((_, p) => {
            const t = $(p).text().replace(/\s+/g, ' ').trim()
            if (t.length > 20 && t.length > snippet.length && !t.includes(domainRoot) && !t.includes('baidu')) snippet = t
          })
        }
        if (snippet.length > 200) snippet = snippet.slice(0, 200) + '…'

        // Date: extract raw text then convert to YYYY-MM-DD
        let rawDateText: string | null = null
        const prefixTime = $container.find('[class*="prefix-time"]').first().text().trim()
        if (prefixTime && datePattern.test(prefixTime)) {
          rawDateText = prefixTime
        } else {
          $container.find('span, em').each((_, el) => {
            if (rawDateText) return false
            const t = $(el).text().trim()
            if (datePattern.test(t)) rawDateText = t
          })
        }
        const baiduDateStr = rawDateText ? parseBaiduRelativeDate(rawDateText) : null

        results.push({ url: displayUrl, title: titleText, snippet, baiduDateStr })
        pageCount++
      })

      console.log(`    [${domain}] 第${page}页 ${fetchStartedAt} ✓ raw=${rawCount} new=${pageCount}`)

      if (rawCount === 0) break  // Baidu returned nothing — truly end of results

      // Stop immediately if this page's URLs are all contained in the previous page's URLs —
      // Baidu is repeating the same last page (end-of-results cycling behaviour)
      if (thisPageUrlSet.size > 0 && prevPageUrlSet.size > 0) {
        if (Array.from(thisPageUrlSet).every(u => prevPageUrlSet.has(u))) {
          console.log(`    [${domain}] 第${page}页与上一页URL完全重复，停止翻页`)
          break
        }
      }

      if (pageCount === 0) {
        // No new URLs and can't confirm looping via prev-page comparison — fallback counter
        consecutiveDupPages++
        if (consecutiveDupPages >= 2) break
      } else {
        consecutiveDupPages = 0
      }
      prevPageUrlSet = thisPageUrlSet

      // Incrementally save this page's new results so partial crawls (timeout/captcha) still persist
      if (onPageResults && results.length > (page * 10)) {
        const batch = results.slice(page * 10)
        if (batch.length > 0) await onPageResults(batch)
      }

      // Human-like pacing to avoid Baidu rate limiting on deep pagination
      await randomDelay(5000, 8000)
    } catch {
      failReason = 'http_error'
      break
    }
  }

  if (results.length === 0 && !failReason) failReason = 'empty_results'
  return { pages: results, failReason }
}

// Fetch Baidu search suggestions for a keyword
export async function fetchBaiduSuggestion(keyword: string): Promise<string[]> {
  try {
    const encoded = encodeURIComponent(keyword)
    const url = `https://suggestion.baidu.com/su?wd=${encoded}&cb=window.bd__cbs__callback&json=1`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOMonitor/1.0)',
        Referer: 'https://www.baidu.com',
      },
      signal: AbortSignal.timeout(5000),
    })
    const text = await res.text()

    // Parse JSONP response: window.bd__cbs__callback({...})
    const match = text.match(/\((\{.*?\})\)/)
    if (!match) return []
    const data = JSON.parse(match[1])
    const suggestions: string[] = data?.s || []

    // Filter to keep only download-related suggestions
    return filterDownloadKeywords(suggestions)
  } catch {
    return []
  }
}
