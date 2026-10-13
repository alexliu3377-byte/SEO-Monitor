import { DAILY_CRAWL_DEPENDENCIES } from './crawl-reliability'

export interface CrawlSourceWarning {
  step: string
  reason: 'partial' | 'unfinished' | 'unknown'
  unresolvedCount: number | null
}

export interface CrawlSourceCompletion {
  step: string
  processing_complete: boolean
  complete: boolean
  unresolved: unknown
}

export function malaysiaSourceDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
}

export function isValidSourceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// Only publish step names and counts. Actual failed domains remain in the
// administrator's crawl logs, not the member-facing radar response.
export function crawlSourceStatus(rows: CrawlSourceCompletion[] | null, metadataUnknown = false) {
  const sourceWarnings: CrawlSourceWarning[] = []
  for (const step of DAILY_CRAWL_DEPENDENCIES) {
    if (metadataUnknown) {
      sourceWarnings.push({ step, reason: 'unknown', unresolvedCount: null })
      continue
    }
    const row = rows?.find(row => row.step === step)
    if (!row?.processing_complete) {
      sourceWarnings.push({ step, reason: 'unfinished', unresolvedCount: null })
    } else if (!row.complete) {
      const unresolvedCount = Array.isArray(row.unresolved)
        ? new Set(row.unresolved.map((item: unknown, index: number) =>
          item && typeof item === 'object' && 'domain' in item && typeof item.domain === 'string'
            ? item.domain : `unknown-${index}`)).size
        : null
      sourceWarnings.push({ step, reason: 'partial', unresolvedCount })
    }
  }
  return { sourceComplete: sourceWarnings.length === 0, sourceWarnings }
}
