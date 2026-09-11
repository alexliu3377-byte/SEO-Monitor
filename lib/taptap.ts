import { load } from 'cheerio'
import type { ExtractedAppUpdate } from './app-update-extractor'
import { cleanAppUpdateMultiline, cleanAppUpdateText, normalizeAppVersion } from './app-updates'

export function tapTapAppIdFromUrl(value: string): string | null {
  const direct = value.trim()
  if (/^\d{3,}$/.test(direct)) return direct
  const relative = direct.match(/^\/app\/(\d{3,})/)
  if (relative) return relative[1]
  try {
    const url = new URL(direct)
    if (!/(^|\.)taptap\.cn$/i.test(url.hostname)) return null
    return url.pathname.match(/^\/app\/(\d{3,})/)?.[1] ?? null
  } catch {
    return null
  }
}

export function canonicalTapTapUrl(appId: string) {
  return `https://www.taptap.cn/app/${appId}`
}

function dateFromText(text: string): string | null {
  const match = text.match(/更新于\s*(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/)
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

export function parseTapTapAppHtml(html: string, sourceUrl: string) {
  const $ = load(html)
  const title = cleanAppUpdateText(
    $('h1').first().text() || $('meta[property="og:title"]').attr('content')?.replace(/\s*[-|｜].*TapTap.*$/i, ''),
    120,
  )
  const releases: ExtractedAppUpdate[] = []
  const seen = new Set<string>()
  $('.app-update-log-entry').each((_, element) => {
    if (releases.length >= 5) return
    const entry = $(element)
    const raw = entry.text().replace(/\s+/g, ' ').trim()
    const releaseDate = dateFromText(raw)
    const publicVersion = cleanAppUpdateText(raw.match(/版本[：:]\s*([0-9A-Za-z][0-9A-Za-z._+-]*)/)?.[1], 100)
    const normalizedVersion = normalizeAppVersion(publicVersion) ?? releaseDate?.replaceAll('-', '.') ?? null
    if (!normalizedVersion || seen.has(normalizedVersion)) return
    seen.add(normalizedVersion)
    const content = entry.find('.app-update-log-entry-content, .app-update-log-content').first().text()
    releases.push({
      version: publicVersion || `${releaseDate} 更新`,
      normalizedVersion,
      changelog: cleanAppUpdateMultiline(content || raw
        .replace(/版本[：:].*?(?=更新于|$)/, '')
        .replace(/更新于\s*20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}/, ''), 30_000),
      releaseDate,
      packageSize: null,
      downloadUrl: null,
      confidence: content ? 90 : 75,
    })
  })
  return { title, releases }
}

export async function fetchTapTapApp(appId: string) {
  const sourceUrl = canonicalTapTapUrl(appId)
  const response = await fetch(sourceUrl, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; QixinAppUpdateResearch/0.3)' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`TapTap 页面返回 HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 5_000_000) throw new Error('TapTap 页面超过 5MB，已停止读取')
  return { appId, sourceUrl, ...parseTapTapAppHtml(bytes.toString('utf8'), sourceUrl) }
}

export async function fetchTapTapUpdates(appId: string) {
  return (await fetchTapTapApp(appId)).releases
}

export async function fetchTapTapTopIds(limit = 50) {
  const response = await fetch('https://www.taptap.cn/top/download', {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; QixinAppUpdateResearch/0.3)' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`TapTap 热门榜返回 HTTP ${response.status}`)
  const $ = load(await response.text())
  const ids = new Set<string>()
  $('a[href*="/app/"]').each((_, element) => {
    const id = tapTapAppIdFromUrl($(element).attr('href') ?? '')
    if (id && ids.size < Math.min(100, Math.max(1, limit))) ids.add(id)
  })
  return [...ids]
}
