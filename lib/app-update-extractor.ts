import * as cheerio from 'cheerio'
import {
  cleanAppUpdateMultiline,
  cleanAppUpdateText,
  normalizeAppVersion,
  normalizePublicHttpUrl,
} from './app-updates'

export type AppUpdateExtractorConfig = {
  versionSelector?: string
  changelogSelector?: string
  releaseDateSelector?: string
  packageSizeSelector?: string
  downloadUrlSelector?: string
}

export type ExtractedAppUpdate = {
  version: string
  normalizedVersion: string
  changelog: string
  releaseDate: string | null
  packageSize: string | null
  downloadUrl: string | null
  confidence: number
}

type JsonObject = Record<string, unknown>

function findJsonValue(value: unknown, keys: readonly string[]): string | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonValue(item, keys)
      if (found) return found
    }
    return null
  }
  const object = value as JsonObject
  for (const key of keys) {
    const candidate = object[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  for (const candidate of Object.values(object)) {
    const found = findJsonValue(candidate, keys)
    if (found) return found
  }
  return null
}

function parseDate(value: string | null): string | null {
  if (!value) return null
  const match = value.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!match) return null
  const month = match[2].padStart(2, '0')
  const day = match[3].padStart(2, '0')
  const date = `${match[1]}-${month}-${day}`
  return Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ? date : null
}

function selectedText($: cheerio.CheerioAPI, selector: string | undefined): string | null {
  if (!selector) return null
  try {
    return cleanAppUpdateText($(selector).first().text(), 1000) || null
  } catch {
    return null
  }
}

function selectedMultiline($: cheerio.CheerioAPI, selector: string | undefined): string {
  if (!selector) return ''
  try {
    return cleanAppUpdateMultiline($(selector).first().text(), 30_000)
  } catch {
    return ''
  }
}

function selectedUrl($: cheerio.CheerioAPI, selector: string | undefined, pageUrl: string): string | null {
  if (!selector) return null
  try {
    const href = $(selector).first().attr('href')
    return href ? normalizePublicHttpUrl(new URL(href, pageUrl).href, 2000) : null
  } catch {
    return null
  }
}

function automaticChangelog($: cheerio.CheerioAPI): string {
  const headings = $('h1,h2,h3,h4,h5,strong,b').toArray()
  for (const heading of headings) {
    const title = cleanAppUpdateText($(heading).text(), 100)
    if (!/(更新日志|更新内容|新版特性|版本说明|what'?s new|changelog|release notes)/i.test(title)) continue
    const parts: string[] = []
    let next = $(heading).next()
    for (let count = 0; count < 5 && next.length > 0; count += 1) {
      if (/^H[1-5]$/i.test(next.get(0)?.tagName ?? '')) break
      const text = cleanAppUpdateMultiline(next.text(), 8000)
      if (text) parts.push(text)
      next = next.next()
    }
    if (parts.length > 0) return parts.join('\n')
  }
  return ''
}

function automaticDownloadUrl($: cheerio.CheerioAPI, pageUrl: string): string | null {
  for (const anchor of $('a[href]').toArray()) {
    const text = cleanAppUpdateText($(anchor).text(), 100)
    if (!/(官方下载|立即下载|安卓下载|apk|download)/i.test(text)) continue
    const href = $(anchor).attr('href')
    if (!href) continue
    try {
      const normalized = normalizePublicHttpUrl(new URL(href, pageUrl).href, 2000)
      if (normalized) return normalized
    } catch {
      // Ignore malformed download links and continue checking the page.
    }
  }
  return null
}

function relativePublicUrl(value: string | null, pageUrl: string): string | null {
  if (!value) return null
  try {
    return normalizePublicHttpUrl(new URL(value, pageUrl).href, 2000)
  } catch {
    return null
  }
}

export function extractAppUpdate(
  html: string,
  pageUrl: string,
  config: AppUpdateExtractorConfig = {}
): ExtractedAppUpdate | null {
  const $ = cheerio.load(html)
  const jsonValues: unknown[] = []
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      jsonValues.push(JSON.parse($(element).text()))
    } catch {
      // A malformed JSON-LD block should not prevent normal HTML extraction.
    }
  })

  const jsonVersion = findJsonValue(jsonValues, ['softwareVersion', 'version'])
  const metaVersion = $('meta[name="software-version"],meta[property="software:version"],meta[itemprop="softwareVersion"]').first().attr('content') ?? null
  const explicitVersion = selectedText($, config.versionSelector)

  $('script,style,noscript,svg').remove()
  const bodyText = cleanAppUpdateText($('body').text(), 200_000)
  const versionMatch = bodyText.match(/(?:最新版本|软件版本|应用版本|版本号|version)\s*[:：]?\s*[vV]?([0-9]+(?:\.[0-9A-Za-z_-]+){1,5})/i)
    ?? bodyText.match(/\bv([0-9]+(?:\.[0-9A-Za-z_-]+){1,5})\b/i)
  const rawVersion = explicitVersion || metaVersion || jsonVersion || versionMatch?.[1] || ''
  const normalizedVersion = normalizeAppVersion(rawVersion)
  if (!normalizedVersion) return null
  const version = cleanAppUpdateText(rawVersion, 100).replace(/^(?:version\s*)/i, '')

  const explicitChangelog = selectedMultiline($, config.changelogSelector)
  const jsonChangelog = cleanAppUpdateMultiline(findJsonValue(jsonValues, ['releaseNotes', 'description']), 30_000)
  const changelog = explicitChangelog || automaticChangelog($) || jsonChangelog

  const explicitDate = selectedText($, config.releaseDateSelector)
  const jsonDate = findJsonValue(jsonValues, ['datePublished', 'dateModified', 'uploadDate'])
  const timeDate = $('time[datetime]').first().attr('datetime') ?? null
  const releaseDate = parseDate(explicitDate || jsonDate || timeDate || bodyText)

  const explicitSize = selectedText($, config.packageSizeSelector)
  const jsonSize = findJsonValue(jsonValues, ['contentSize', 'fileSize'])
  const sizeMatch = bodyText.match(/(?:软件大小|应用大小|安装包大小|文件大小|大小)\s*[:：]?\s*([0-9.]+\s*(?:KB|MB|GB|K|M|G))/i)
  const packageSize = cleanAppUpdateText(explicitSize || jsonSize || sizeMatch?.[1], 100) || null

  const explicitDownload = selectedUrl($, config.downloadUrlSelector, pageUrl)
  const jsonDownload = findJsonValue(jsonValues, ['downloadUrl', 'installUrl'])
  const downloadUrl = explicitDownload
    || relativePublicUrl(jsonDownload, pageUrl)
    || automaticDownloadUrl($, pageUrl)

  let confidence = explicitVersion ? 75 : metaVersion || jsonVersion ? 65 : 45
  if (changelog) confidence += 15
  if (releaseDate) confidence += 5
  if (downloadUrl) confidence += 5

  return {
    version,
    normalizedVersion,
    changelog,
    releaseDate,
    packageSize,
    downloadUrl,
    confidence: Math.min(100, confidence),
  }
}
