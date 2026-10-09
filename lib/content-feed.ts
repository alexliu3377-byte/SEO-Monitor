import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import iconv from 'iconv-lite'

export const CONTENT_FEED_SOURCES = [
  '52pojie',
  '4399',
  'ccplay',
  'xiaohongshu',
  'xiaoheihe_guide',
  'xiaoheihe_ns',
  'bilibili',
] as const
export const CONTENT_FEED_REFRESH_SOURCES = ['52pojie', '4399', 'ccplay'] as const
export const CONTENT_FEED_CATEGORIES = [
  'software',
  'new_game',
  'game_news',
  'game_activity',
  'game_review',
  'game_guide',
  'resource_share',
  'ns_game',
  'video',
] as const

export type ContentFeedSource = typeof CONTENT_FEED_SOURCES[number]
export type ContentFeedCategory = typeof CONTENT_FEED_CATEGORIES[number]

export type ContentFeedItemInput = {
  source: ContentFeedSource
  sourceId: string
  category: ContentFeedCategory
  title: string
  url: string
  coverUrl: string | null
  author: string | null
  summary: string | null
  publishedAt: string | null
}
export type ContentFeedDatabaseRow = {
  source: ContentFeedSource
  source_id: string
  category: ContentFeedItemInput['category']
  title: string
  url: string
  cover_url: string | null
  author: string | null
  summary: string | null
  published_at: string | null
  last_seen_at: string
}

export type ContentFeedFetchResult = {
  items: ContentFeedItemInput[]
  warnings: string[]
}

type ContentFeedRefreshSource = typeof CONTENT_FEED_REFRESH_SOURCES[number]

const SOURCE_URLS: Record<ContentFeedRefreshSource, string> = {
  '52pojie': 'https://www.52pojie.cn/forum.php?mod=rss&fid=16',
  '4399': 'https://a.4399.cn/game-new.html',
  ccplay: 'https://m2.ccplay.cn/news',
}

const USER_AGENT = 'Mozilla/5.0 (compatible; QixinContentFeed/1.0; public metadata only)'
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_SUMMARY_LENGTH = 280
const MAX_PAGES = 3
const REQUEST_TIMEOUT_MS = 12_000
const MAX_SAME_ORIGIN_REDIRECTS = 3
const MAX_URL_LENGTH = 2_048

function cleanText(value: unknown, maximum = 300): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum)
}

function cleanSummary(value: unknown): string | null {
  const raw = String(value ?? '')
  if (!raw.trim()) return null
  const $ = load(`<div id="summary-root">${raw}</div>`)
  const text = cleanText($('#summary-root').text()
    .replace(/\[(?:md|\/md)\]/gi, ' ')
    .replace(/\[\*\]/g, ' '), MAX_SUMMARY_LENGTH)
  return text || null
}

function absoluteHttpsUrl(value: unknown, base: string): string | null {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > MAX_URL_LENGTH) return null
  try {
    const url = new URL(raw, base)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.protocol = 'https:'
    if (url.username || url.password || (url.port && url.port !== '443')) return null
    url.hash = ''
    const normalized = url.toString()
    return normalized.length <= MAX_URL_LENGTH ? normalized : null
  } catch {
    return null
  }
}

function sourceArticleUrl(value: unknown, base: string, allowedHostname: string): string | null {
  const normalized = absoluteHttpsUrl(value, base)
  if (!normalized) return null
  try {
    return new URL(normalized).hostname.toLowerCase() === allowedHostname ? normalized : null
  } catch {
    return null
  }
}

function sourceIdFromUrl(value: string, pattern: RegExp): string {
  const match = value.match(pattern)?.[1]
  return match || createHash('sha256').update(value).digest('hex').slice(0, 32)
}

function dateOnlyToIso(value: string): string | null {
  const match = value.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarCheck = new Date(Date.UTC(year, month - 1, day))
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day
  ) return null
  const iso = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00+08:00`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function dateTimeToIso(value: unknown): string | null {
  const raw = cleanText(value, 100)
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function dedupeItems(items: ContentFeedItemInput[]): ContentFeedItemInput[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = `${item.source}:${item.sourceId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parse52PojieRss(xml: string): ContentFeedItemInput[] {
  const $ = load(xml, { xmlMode: true })
  const items: ContentFeedItemInput[] = []
  $('channel > item').each((_, element) => {
    const node = $(element)
    const title = cleanText(node.children('title').first().text(), 240)
    const url = sourceArticleUrl(
      node.children('link').first().text(),
      SOURCE_URLS['52pojie'],
      'www.52pojie.cn',
    )
    if (!title || !url) return
    const coverUrl = absoluteHttpsUrl(node.children('enclosure').first().attr('url'), SOURCE_URLS['52pojie'])
    items.push({
      source: '52pojie',
      sourceId: sourceIdFromUrl(url, /thread-(\d+)/i),
      category: 'software',
      title,
      url,
      coverUrl,
      author: cleanText(node.children('author').first().text(), 120) || null,
      summary: cleanSummary(node.children('description').first().text()),
      publishedAt: dateTimeToIso(node.children('pubDate').first().text()),
    })
  })
  return dedupeItems(items)
}

export function parse4399NewGames(html: string): ContentFeedItemInput[] {
  const $ = load(html)
  const items: ContentFeedItemInput[] = []
  $('#j-newGamelist > li').each((_, element) => {
    const node = $(element)
    const anchor = node.find('a.m_game').first()
    const title = cleanText(node.find('.ks_name').first().text() || anchor.attr('title'), 240)
    const url = sourceArticleUrl(anchor.attr('href'), SOURCE_URLS['4399'], 'a.4399.cn')
    if (!title || !url) return
    const gameType = cleanText(node.find('.type a').first().text(), 80)
    items.push({
      source: '4399',
      sourceId: sourceIdFromUrl(url, /game-id-(\d+)/i),
      category: 'new_game',
      title,
      url,
      coverUrl: absoluteHttpsUrl(anchor.find('img').first().attr('src'), SOURCE_URLS['4399']),
      author: null,
      summary: gameType || null,
      publishedAt: dateOnlyToIso(cleanText(node.find('.update').first().text(), 20)),
    })
  })
  return dedupeItems(items)
}

export function parseCcplayNews(
  html: string,
  category: Extract<ContentFeedItemInput['category'], `game_${string}`> = 'game_news',
): ContentFeedItemInput[] {
  const $ = load(html)
  const items: ContentFeedItemInput[] = []
  $('.info_item').each((_, element) => {
    const node = $(element)
    const anchor = node.find('a[href]').first()
    const image = anchor.find('img').first()
    const title = cleanText(node.find('.info_msg p').first().text() || image.attr('alt'), 240)
    const url = sourceArticleUrl(anchor.attr('href'), SOURCE_URLS.ccplay, 'm2.ccplay.cn')
    if (!title || !url) return
    const meta = node.find('.info_opt span')
    items.push({
      source: 'ccplay',
      sourceId: sourceIdFromUrl(url, /\/news\/(\d+)\.html/i),
      category,
      title,
      url,
      coverUrl: absoluteHttpsUrl(image.attr('src'), SOURCE_URLS.ccplay),
      author: cleanText(meta.last().text(), 120) || null,
      summary: null,
      publishedAt: dateOnlyToIso(cleanText(meta.first().text(), 20)),
    })
  })
  return dedupeItems(items)
}

export function decodeContentFeedBytes(bytes: Uint8Array, charset: 'utf8' | 'gb18030'): string {
  return charset === 'gb18030'
    ? iconv.decode(Buffer.from(bytes), 'gb18030')
    : Buffer.from(bytes).toString('utf8')
}

async function fetchFromSameOrigin(url: string, signal: AbortSignal): Promise<Response> {
  const initial = new URL(url)
  if (initial.protocol !== 'https:' || initial.username || initial.password) {
    throw new Error('unsafe source URL')
  }
  let current = initial
  for (let redirectCount = 0; redirectCount <= MAX_SAME_ORIGIN_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': USER_AGENT,
      },
      redirect: 'manual',
      signal,
    })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (!location) throw new Error(`HTTP ${response.status} without redirect location`)
    const next = new URL(location, current)
    if (next.origin !== initial.origin || next.username || next.password) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('cross-origin redirect blocked')
    }
    await response.body?.cancel().catch(() => undefined)
    current = next
  }
  throw new Error('too many redirects')
}

async function readLimitedResponseBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('response exceeds 2MB')
  }
  if (!response.body) throw new Error('empty response')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) throw new Error('response exceeds 2MB')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  if (byteLength === 0) throw new Error('empty response')

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchPage(url: string, charset: 'utf8' | 'gb18030'): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchFromSameOrigin(url, AbortSignal.timeout(REQUEST_TIMEOUT_MS))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = await readLimitedResponseBytes(response)
      return decodeContentFeedBytes(bytes, charset)
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('request failed')
}

async function fetch52Pojie(): Promise<ContentFeedItemInput[]> {
  const xml = await fetchPage(SOURCE_URLS['52pojie'], 'gb18030')
  const items = parse52PojieRss(xml)
  if (items.length === 0) throw new Error('RSS returned no parseable items')
  return items
}

async function fetch4399(): Promise<ContentFeedItemInput[]> {
  const items: ContentFeedItemInput[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = page === 1 ? SOURCE_URLS['4399'] : `https://a.4399.cn/game-new-p-${page}.html`
    const pageItems = parse4399NewGames(await fetchPage(url, 'utf8'))
    if (pageItems.length === 0) break
    items.push(...pageItems)
  }
  const unique = dedupeItems(items)
  if (unique.length === 0) throw new Error('game list returned no parseable items')
  return unique
}

async function fetchCcplay(): Promise<ContentFeedFetchResult> {
  const sections: Array<{
    path: string
    category: Extract<ContentFeedItemInput['category'], `game_${string}`>
  }> = [
    // Specific sections come before the catch-all news page. dedupeItems keeps
    // the first occurrence, so an article visible in both places retains its
    // useful activity/review/guide classification.
    { path: '/gameactivity', category: 'game_activity' },
    { path: '/gameevaluation', category: 'game_review' },
    { path: '/gamestrategy', category: 'game_guide' },
    { path: '/news', category: 'game_news' },
  ]
  const settled = await Promise.allSettled(sections.map(async section => {
    const sectionItems: ContentFeedItemInput[] = []
    const baseUrl = `https://m2.ccplay.cn${section.path}`
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
      const pageItems = parseCcplayNews(await fetchPage(url, 'utf8'), section.category)
      if (pageItems.length === 0) break
      sectionItems.push(...pageItems)
    }
    return sectionItems
  }))
  const items: ContentFeedItemInput[] = []
  const warnings: string[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') items.push(...result.value)
    else {
      const detail = result.reason instanceof Error ? result.reason.message : 'request failed'
      const warning = `${sections[index].category}: ${detail}`.slice(0, 240)
      warnings.push(warning)
      console.error(`[content-feed] ccplay ${warning}`)
    }
  })
  const unique = dedupeItems(items)
  if (unique.length === 0) throw new Error('news list returned no parseable items')
  return { items: unique, warnings }
}

export async function fetchContentFeedSource(source: ContentFeedSource): Promise<ContentFeedFetchResult> {
  if (source === '52pojie') return { items: await fetch52Pojie(), warnings: [] }
  if (source === '4399') return { items: await fetch4399(), warnings: [] }
  if (source === 'ccplay') return fetchCcplay()
  throw new Error(`${source} must be refreshed by the browser collector`)
}

export function isContentFeedRefreshSource(source: ContentFeedSource): source is ContentFeedRefreshSource {
  return (CONTENT_FEED_REFRESH_SOURCES as readonly string[]).includes(source)
}

export function parseContentFeedSources(value: string | null): {
  sources: ContentFeedSource[]
  invalid: string[]
} {
  if (!value?.trim()) return { sources: [...CONTENT_FEED_SOURCES], invalid: [] }
  const requested = [...new Set(value.split(',').map(part => part.trim().toLowerCase()).filter(Boolean))]
  if (requested.length === 0) return { sources: [...CONTENT_FEED_SOURCES], invalid: [] }
  const valid = new Set<string>(CONTENT_FEED_SOURCES)
  return {
    sources: requested.filter((source): source is ContentFeedSource => valid.has(source)),
    invalid: requested.filter(source => !valid.has(source)),
  }
}

export function contentFeedDatabaseRows(
  items: ContentFeedItemInput[],
  seenAt: string,
): ContentFeedDatabaseRow[] {
  return items.map(item => ({
    source: item.source,
    source_id: item.sourceId,
    category: item.category,
    title: item.title,
    url: item.url,
    cover_url: item.coverUrl,
    author: item.author,
    summary: item.summary,
    published_at: item.publishedAt,
    last_seen_at: seenAt,
    // Deliberately omit first_seen_at: on conflict, an existing item's first
    // discovery time must stay unchanged. New rows receive the database default.
  }))
}
