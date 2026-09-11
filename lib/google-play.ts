import { app as googlePlayApp, list as googlePlayList, type App as GooglePlayApp } from '@mradex77/google-play-scraper'
import type { ExtractedAppUpdate } from './app-update-extractor'
import { cleanAppUpdateMultiline, cleanAppUpdateText, normalizeAppVersion } from './app-updates'

export function googlePlayPackageFromUrl(value: string): string | null {
  const direct = value.trim()
  if (/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i.test(direct)) return direct
  try {
    const url = new URL(direct)
    if (url.hostname !== 'play.google.com') return null
    const packageId = url.searchParams.get('id') ?? ''
    return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i.test(packageId) ? packageId : null
  } catch {
    return null
  }
}

export function canonicalGooglePlayUrl(packageId: string, country = 'us', lang = 'en') {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}&hl=${lang}&gl=${country}`
}

export function googlePlayLocaleFromUrl(value: string) {
  try {
    const url = new URL(value)
    const country = url.searchParams.get('gl')?.toLowerCase() ?? 'us'
    const lang = url.searchParams.get('hl')?.toLowerCase() ?? 'en'
    return {
      country: /^[a-z]{2}$/.test(country) ? country : 'us',
      lang: /^[a-z]{2}(?:-[a-z]{2})?$/.test(lang) ? lang : 'en',
    }
  } catch {
    return { country: 'us', lang: 'en' }
  }
}

function plainChangelog(value: string | undefined) {
  return cleanAppUpdateMultiline(value?.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' '), 30_000)
}

export function googlePlayAppToUpdate(result: GooglePlayApp): ExtractedAppUpdate | null {
  const releaseDate = Number.isFinite(result.updated)
    ? new Date(result.updated).toISOString().slice(0, 10)
    : null
  const publicVersion = cleanAppUpdateText(result.version, 100)
  const normalizedPublicVersion = normalizeAppVersion(publicVersion)
  const normalizedVersion = normalizedPublicVersion ?? releaseDate?.replaceAll('-', '.') ?? null
  if (!normalizedVersion) return null
  return {
    version: normalizedPublicVersion ? publicVersion : `${releaseDate} 更新`,
    normalizedVersion,
    changelog: plainChangelog(result.recentChanges),
    releaseDate,
    packageSize: null,
    downloadUrl: null,
    confidence: result.recentChanges ? 90 : 75,
  }
}

export async function fetchGooglePlayApp(packageId: string, country = 'us', lang = 'en') {
  return googlePlayApp({ appId: packageId, country, lang, throttle: 0.25 })
}

export async function fetchGooglePlayUpdate(packageId: string, country = 'us', lang = 'en') {
  return googlePlayAppToUpdate(await fetchGooglePlayApp(packageId, country, lang))
}

export async function fetchGooglePlayChart(
  category: 'APPLICATION' | 'GAME',
  limit = 20,
  country = 'us',
  lang = 'en',
): Promise<GooglePlayApp[]> {
  const results = await googlePlayList({
    collection: 'TOP_FREE', category, num: Math.min(50, Math.max(1, limit)),
    fullDetail: true, country, lang, throttle: 0.25,
  })
  return results.filter(result => 'version' in result) as GooglePlayApp[]
}
