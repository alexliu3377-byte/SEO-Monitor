export interface TrackingTargetRow {
  claim_id: string
  keyword: string
  final_keyword: string | null
  page_url: string | null
  operation_type: string | null
  submit_date: string
}

function normalizeKeyword(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

function normalizePageUrl(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.|m\.)?/i, '')
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, '')
}

function isLaterSubmission<T extends TrackingTargetRow>(candidate: T, current: T): boolean {
  if (candidate.submit_date !== current.submit_date) return candidate.submit_date > current.submit_date
  if (candidate.operation_type !== current.operation_type) return candidate.operation_type === '更新'
  return candidate.claim_id > current.claim_id
}

/**
 * A page may first be submitted as “新增” and later as “更新”. Tracking keeps
 * both claims for audit history, but the outcome report must not credit the
 * same page + final keyword twice for the same current ranking evidence.
 */
export function dedupeTrackingTargets<T extends TrackingTargetRow>(rows: T[]): T[] {
  const winnerByKey = new Map<string, T>()
  const unkeyed: T[] = []

  for (const row of rows) {
    const url = row.page_url ? normalizePageUrl(row.page_url) : ''
    const keyword = normalizeKeyword(row.final_keyword || row.keyword)
    if (!url || !keyword) {
      unkeyed.push(row)
      continue
    }

    const key = `${url}\u0000${keyword}`
    const current = winnerByKey.get(key)
    if (!current || isLaterSubmission(row, current)) winnerByKey.set(key, row)
  }

  return [...winnerByKey.values(), ...unkeyed]
}
