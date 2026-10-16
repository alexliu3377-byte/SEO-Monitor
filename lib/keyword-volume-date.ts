function recordedDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

// Older global/group caches used last_date for the crawl date. Never silently
// relabel those dates as discovery evidence while a new cache is being built.
export function normalizeVolumeRiseDate<T extends { last_date?: unknown; riseDate?: unknown; volumeDate?: unknown }>(row: T) {
  const riseDate = recordedDate(row.riseDate)
  const volumeDate = recordedDate(row.volumeDate)
    ?? (row.riseDate === undefined ? recordedDate(row.last_date) : null)
  return { ...row, riseDate, volumeDate, last_date: riseDate ?? '' }
}

export function formatVolumeRiseDate(date: string | null | undefined) {
  return recordedDate(date)?.replaceAll('-', '/') ?? '未记录'
}
