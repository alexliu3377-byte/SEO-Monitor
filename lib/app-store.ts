import { cleanAppUpdateMultiline, cleanAppUpdateText, normalizeAppVersion } from './app-updates'
import type { ExtractedAppUpdate } from './app-update-extractor'

export type AppStoreLookupResult = {
  wrapperType?: string
  kind?: string
  trackId: number
  trackName: string
  bundleId: string
  version: string
  releaseNotes?: string
  currentVersionReleaseDate?: string
  fileSizeBytes?: string
  trackViewUrl: string
}

type AppStoreLookupResponse = {
  resultCount?: number
  results?: unknown[]
}

type AppStoreChartResponse = {
  feed?: {
    results?: Array<{ id?: unknown }>
  }
}

export const APP_STORE_CHARTS = ['top-free', 'top-paid'] as const
export type AppStoreChart = typeof APP_STORE_CHARTS[number]

export function isAppStoreChart(value: unknown): value is AppStoreChart {
  return typeof value === 'string' && APP_STORE_CHARTS.includes(value as AppStoreChart)
}

export function parseAppStoreIds(value: unknown, maxItems = 100): string[] {
  if (typeof value !== 'string') return []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const token of value.split(/[\s,;]+/)) {
    const cleaned = token.trim()
    if (!cleaned) continue
    const id = cleaned.match(/\/id(\d{5,})(?:[/?#]|$)/i)?.[1]
      ?? cleaned.match(/^(?:id)?(\d{5,})$/i)?.[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= maxItems) break
  }
  return ids
}

export function appStoreCountryFromUrl(value: string, fallback = 'cn') {
  try {
    const country = new URL(value).pathname.split('/').filter(Boolean)[0]?.toLowerCase()
    return country && /^[a-z]{2}$/.test(country) ? country : fallback
  } catch {
    return fallback
  }
}

export function canonicalAppStoreUrl(result: AppStoreLookupResult) {
  const normalized = cleanAppUpdateText(result.trackViewUrl, 1200)
  return normalized || `https://apps.apple.com/app/id${result.trackId}`
}

function formatFileSize(value: string | undefined): string | null {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  const megabytes = bytes / 1024 / 1024
  return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`
}

export function appStoreResultToUpdate(result: AppStoreLookupResult): ExtractedAppUpdate | null {
  const normalizedVersion = normalizeAppVersion(result.version)
  if (!normalizedVersion) return null
  const date = cleanAppUpdateText(result.currentVersionReleaseDate, 100).slice(0, 10)
  const releaseDate = /^20\d{2}-\d{2}-\d{2}$/.test(date) ? date : null
  const changelog = cleanAppUpdateMultiline(result.releaseNotes, 30_000)
  const downloadUrl = canonicalAppStoreUrl(result)

  let confidence = 70
  if (changelog) confidence += 15
  if (releaseDate) confidence += 5
  if (downloadUrl) confidence += 5

  return {
    version: cleanAppUpdateText(result.version, 100),
    normalizedVersion,
    changelog,
    releaseDate,
    packageSize: formatFileSize(result.fileSizeBytes),
    downloadUrl,
    confidence: Math.min(100, confidence),
  }
}

function isLookupResult(value: unknown): value is AppStoreLookupResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Number.isInteger(row.trackId)
    && (row.wrapperType === 'software' || row.kind === 'software')
    && typeof row.trackName === 'string'
    && typeof row.bundleId === 'string'
    && typeof row.version === 'string'
    && typeof row.trackViewUrl === 'string'
}

export async function lookupAppStoreApps(ids: string[], country = 'cn'): Promise<AppStoreLookupResult[]> {
  const safeIds = [...new Set(ids.filter(id => /^\d{5,}$/.test(id)))].slice(0, 100)
  if (safeIds.length === 0) return []
  const storefront = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'cn'
  const url = `https://itunes.apple.com/lookup?id=${safeIds.join(',')}&country=${storefront}&entity=software`
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`App Store 接口返回 HTTP ${response.status}`)
  const body = await response.json() as AppStoreLookupResponse
  return Array.isArray(body.results) ? body.results.filter(isLookupResult) : []
}

export async function searchAppStoreApps(
  term: string,
  country = 'cn',
  limit = 200
): Promise<AppStoreLookupResult[]> {
  const query = cleanAppUpdateText(term, 80)
  if (!query) return []
  const storefront = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'cn'
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit) || 200))
  const params = new URLSearchParams({
    term: query,
    country: storefront,
    media: 'software',
    entity: 'software',
    limit: String(safeLimit),
  })
  const response = await fetch(`https://itunes.apple.com/search?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`App Store 搜索接口返回 HTTP ${response.status}`)
  const body = await response.json() as AppStoreLookupResponse
  return Array.isArray(body.results) ? body.results.filter(isLookupResult) : []
}

export async function fetchAppStoreChartIds(
  chart: AppStoreChart,
  country = 'cn',
  limit = 100
): Promise<string[]> {
  const storefront = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'cn'
  const safeLimit = Math.min(100, Math.max(10, Math.trunc(limit) || 100))
  const url = `https://rss.marketingtools.apple.com/api/v2/${storefront}/apps/${chart}/${safeLimit}/apps.json`
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`App Store 榜单接口返回 HTTP ${response.status}`)
  const body = await response.json() as AppStoreChartResponse
  const ids = body.feed?.results
    ?.map(result => typeof result.id === 'string' ? result.id : '')
    .filter(id => /^\d{5,}$/.test(id)) ?? []
  return [...new Set(ids)].slice(0, safeLimit)
}
