import { createHash } from 'node:crypto'
import type { ContentFeedItemInput, ContentFeedSource } from './content-feed'

export const BROWSER_CONTENT_FEED_SOURCES = [
  'xiaohongshu',
  'xiaoheihe_guide',
  'xiaoheihe_ns',
  'bilibili',
] as const satisfies readonly ContentFeedSource[]

export type BrowserContentFeedSource = typeof BROWSER_CONTENT_FEED_SOURCES[number]

const SOURCE_RULES: Record<BrowserContentFeedSource, {
  hosts: readonly string[]
  category: ContentFeedItemInput['category']
}> = {
  xiaohongshu: { hosts: ['xiaohongshu.com', 'xhslink.com'], category: 'resource_share' },
  xiaoheihe_guide: { hosts: ['xiaoheihe.cn', 'heybox.hk'], category: 'game_guide' },
  xiaoheihe_ns: { hosts: ['xiaoheihe.cn', 'heybox.hk'], category: 'ns_game' },
  bilibili: { hosts: ['bilibili.com', 'b23.tv'], category: 'video' },
}

function clean(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : ''
}

function safeSourceUrl(source: BrowserContentFeedSource, value: unknown): string | null {
  const raw = clean(value, 2_048)
  if (!raw) return null
  try {
    const url = new URL(raw)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    const allowed = SOURCE_RULES[source].hosts.some(host => hostname === host || hostname.endsWith(`.${host}`))
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:spm|from|source|share|share_source|share_medium|share_plat|share_session_id|timestamp|unique_k)$/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    return url.toString().slice(0, 2_048)
  } catch {
    return null
  }
}

function safeCoverUrl(value: unknown): string | null {
  const raw = clean(value, 2_048)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.toString() : null
  } catch {
    return null
  }
}

export function isBrowserContentFeedSource(value: unknown): value is BrowserContentFeedSource {
  return typeof value === 'string' && (BROWSER_CONTENT_FEED_SOURCES as readonly string[]).includes(value)
}

export function parseBrowserContentFeedItem(
  source: BrowserContentFeedSource,
  value: unknown,
): ContentFeedItemInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const title = clean(raw.title, 240)
  const url = safeSourceUrl(source, raw.url)
  if (title.length < 2 || !url) return null
  const published = clean(raw.publishedAt, 40)
  const publishedAt = published && Number.isFinite(Date.parse(published))
    ? new Date(published).toISOString()
    : null
  const sourceId = clean(raw.sourceId, 300)
    || createHash('sha256').update(url).digest('hex').slice(0, 32)
  return {
    source,
    sourceId,
    category: SOURCE_RULES[source].category,
    title,
    url,
    coverUrl: safeCoverUrl(raw.coverUrl),
    author: clean(raw.author, 120) || null,
    summary: clean(raw.summary, 280) || null,
    publishedAt,
  }
}
