export function normalizeTaskUrl(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return url.host.toLowerCase().replace(/^(www\.|m\.)/, '') + url.pathname.replace(/\/+$/, '') + url.search
  } catch { return '' }
}
export function isUpdateTask(operation: string | null | undefined, source?: string | null) {
  return operation === '更新' || operation === '覆盖' || ['跌词更新','跌排更新','涨排更新'].includes(source ?? '')
}
export function taskClaimIdentity(keyword: string, url?: string | null, operation?: string | null, source?: string | null) {
  const page = normalizeTaskUrl(url)
  return isUpdateTask(operation, source) && page ? `url:${page}` : `keyword:${keyword.trim().replace(/\s+/g, ' ').toLowerCase()}`
}
