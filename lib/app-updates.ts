export const APP_UPDATE_PLATFORMS = ['android', 'ios', 'windows', 'macos', 'web', 'other'] as const
export type AppUpdatePlatform = typeof APP_UPDATE_PLATFORMS[number]

export const APP_UPDATE_SOURCE_TYPES = ['official', 'app_store', 'google_play', 'taptap', 'download_site', 'other'] as const
export type AppUpdateSourceType = typeof APP_UPDATE_SOURCE_TYPES[number]

export const APP_UPDATE_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type AppUpdateReviewStatus = typeof APP_UPDATE_REVIEW_STATUSES[number]

export function cleanAppUpdateText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function cleanAppUpdateMultiline(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maxLength)
}

export function isAppUpdatePlatform(value: unknown): value is AppUpdatePlatform {
  return typeof value === 'string' && (APP_UPDATE_PLATFORMS as readonly string[]).includes(value)
}

export function isAppUpdateSourceType(value: unknown): value is AppUpdateSourceType {
  return typeof value === 'string' && (APP_UPDATE_SOURCE_TYPES as readonly string[]).includes(value)
}

export function isAppUpdateReviewStatus(value: unknown): value is AppUpdateReviewStatus {
  return typeof value === 'string' && (APP_UPDATE_REVIEW_STATUSES as readonly string[]).includes(value)
}

export function normalizeAppVersion(value: unknown): string | null {
  const version = cleanAppUpdateText(value, 100)
    .toLocaleLowerCase('en-US')
    .replace(/^(?:version|版本号?|软件版本|应用版本|最新版本)\s*[:：]?\s*/i, '')
    .replace(/^v(?=\d)/i, '')
  if (!version || !/^[0-9][0-9a-z]*(?:[._+-][0-9a-z]+)*$/i.test(version)) return null
  return version
}

export function normalizePublicHttpUrl(value: unknown, maxLength = 1200): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['', '80', '443'].includes(url.port)) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  // Leading formula characters are executable in common spreadsheet apps.
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${text.replace(/"/g, '""')}"`
}
