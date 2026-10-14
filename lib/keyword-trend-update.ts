export const KEYWORD_TREND_BATCH_LIMIT = 300
export const KEYWORD_TREND_URL_BUDGET = 16_000
// Leave room for the Supabase host, path and query overhead. URLSearchParams
// matches the SDK's percent encoding (including CJK, quotes and punctuation).
const URL_OVERHEAD_RESERVE = 1024
const FILTER_BUDGET = KEYWORD_TREND_URL_BUDGET - URL_OVERHEAD_RESERVE

type Trend = 'rankup' | 'rankdown'
type UpdateResult = { error: { message?: string; code?: string } | null; status?: number }
type TrendClient = {
  from: (table: 'keyword_volume') => {
    update: (values: { latest_trend: Trend }) => {
      in: (column: 'keyword', keywords: string[]) => PromiseLike<UpdateResult>
    }
  }
}

export function buildKeywordTrendBatches(keywords: string[]): string[][] {
  const batches: string[][] = []
  let batch: string[] = []
  const emptyFilterLength = new URLSearchParams({ keyword: 'in.()' }).toString().length
  let filterLength = emptyFilterLength
  for (const keyword of new Set(keywords)) {
    // Match PostgrestFilterBuilder.in(): reserved values are double-quoted.
    const value = /[,()]/.test(keyword) ? `"${keyword}"` : keyword
    const encodedLength = new URLSearchParams({ v: value }).toString().length - 2
    if (emptyFilterLength + encodedLength > FILTER_BUDGET) {
      throw new Error('keyword trend update: a single keyword exceeds the safe URL budget')
    }
    const separatorLength = batch.length > 0 ? 3 : 0 // encoded comma: %2C
    if (batch.length > 0 && (batch.length >= KEYWORD_TREND_BATCH_LIMIT
      || filterLength + separatorLength + encodedLength > FILTER_BUDGET)) {
      batches.push(batch)
      batch = []
      filterLength = emptyFilterLength
    }
    filterLength += encodedLength + (batch.length > 0 ? 3 : 0)
    batch.push(keyword)
  }
  if (batch.length) batches.push(batch)
  return batches
}

export async function updateKeywordVolumeTrends(service: TrendClient, keywords: string[], trend: Trend) {
  async function updateBatch(batch: string[]): Promise<void> {
    const result = await service.from('keyword_volume').update({ latest_trend: trend }).in('keyword', batch)
    if (!result.error) return

    // Gateways may change their URL limit. Split a rejected request instead of
    // retrying the identical long URL. A singleton failure is always surfaced.
    const requestTooLarge = [414, 431].includes(result.status ?? 0)
      || /bad request|uri too long|request.?uri too large|headers? (?:too large|overflow)/i.test(result.error.message ?? '')
    if (requestTooLarge && batch.length > 1) {
      console.warn(`${trend} trend update: splitting rejected ${batch.length}-keyword batch`)
      const middle = Math.ceil(batch.length / 2)
      await updateBatch(batch.slice(0, middle))
      await updateBatch(batch.slice(middle))
      return
    }
    throw new Error(`${trend} trend update (${batch.length} keywords): ${result.error.message || result.error.code || 'unknown database error'}`)
  }

  // Calculate every batch before writing so an oversized singleton cannot
  // leave an already-started update partially applied.
  for (const batch of buildKeywordTrendBatches(keywords)) await updateBatch(batch)
}
