import { isBrowserContentFeedSource, parseBrowserContentFeedItem } from './content-feed-browser'
import type { ContentFeedItemInput, ContentFeedSource } from './content-feed'

const PUBLIC_RULES = {
  '52pojie': { host: 'www.52pojie.cn',categories: ['software'] },
  '4399': { host: 'a.4399.cn',categories: ['new_game'] },
  ccplay: { host: 'm2.ccplay.cn',categories: ['game_news','game_activity','game_review','game_guide'] },
} as const

function clean(value: unknown, limit: number) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit) : ''
}

export function isCollectorContentSource(source: unknown): source is ContentFeedSource {
  return isBrowserContentFeedSource(source) || (typeof source === 'string' && Object.hasOwn(PUBLIC_RULES,source))
}

export function parseCollectorContentItem(source: ContentFeedSource, value: unknown): ContentFeedItemInput | null {
  if (isBrowserContentFeedSource(source)) return parseBrowserContentFeedItem(source,value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string,unknown>
  const rules = PUBLIC_RULES[source]
  const title = clean(item.title,240)
  let url: URL
  try { url = new URL(clean(item.url,2048)) } catch { return null }
  if (!title || url.protocol !== 'https:' || url.hostname !== rules.host || url.username || url.password || url.port) return null
  let id: string | undefined
  if (source === '52pojie') id = url.pathname.match(/^\/thread-(\d+)-/i)?.[1]
    ?? (url.pathname === '/forum.php' && url.searchParams.get('mod') === 'viewthread' ? url.searchParams.get('tid') ?? undefined : undefined)
  if (source === '4399') id = url.pathname.match(/^\/game-id-(\d+)\.html$/i)?.[1]
  if (source === 'ccplay') id = url.pathname.match(/^\/news\/(\d+)\.html$/i)?.[1]
  if (!id || !/^\d+$/.test(id)) return null
  const category = clean(item.category,40)
  if (!(rules.categories as readonly string[]).includes(category)) return null
  url.hash = ''
  const date = clean(item.publishedAt,40)
  const publishedAt = date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null
  let coverUrl: string | null = null
  try {
    const image = new URL(clean(item.coverUrl,2048))
    if (image.protocol === 'https:' && !image.username && !image.password && !image.port) coverUrl = image.toString()
  } catch { /* Cover images are optional metadata. */ }
  return {
    source,sourceId: id,title,url: url.toString(),category: category as ContentFeedItemInput['category'],
    author: clean(item.author,120) || null,summary: clean(item.summary,280) || null,coverUrl,publishedAt,
  }
}
