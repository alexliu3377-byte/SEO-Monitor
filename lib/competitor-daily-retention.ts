/* eslint-disable @typescript-eslint/no-explicit-any */
type SupabaseLike = {
  from: (table: string) => any
}

const RETAINED_TABLES = [
  { table: 'raw_keywords', dateColumn: 'content_date' },
  { table: 'rank_changes', dateColumn: 'stat_date' },
  { table: 'site_keyword_ranks', dateColumn: 'stat_date' },
] as const

export interface CompetitorDailyPruneResult {
  cutoff: string
  removedDatePartitions: Record<string, string[]>
  blockedArchiveMonths: string[]
  complete: boolean
}

// Delete one whole date at a time. The historical backlog can contain millions
// of rows; partitioning the work avoids one giant DELETE holding locks or
// exceeding PostgREST's statement timeout. Once caught up, each daily run
// normally removes only one newly expired date from each table.
export async function pruneCompetitorDailyHistory(
  service: SupabaseLike,
  cutoff: string,
  maxDatePartitionsPerTable = 5,
): Promise<CompetitorDailyPruneResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) throw new Error('Invalid competitor daily retention cutoff')
  const removedDatePartitions: Record<string, string[]> = {}
  const blockedArchiveMonths = new Set<string>()
  let complete = true

  // Detail is the only recoverable source until BOTH monthly archives exist.
  // Read their compact metadata once; never run expensive rebuilds during a
  // cleanup or silently discard the month if an archive query fails.
  const [detailResult, summaryResult] = await Promise.all([
    service.from('monthly_trend_cache').select('month, is_final'),
    service.from('monthly_trend_summary_cache').select('month, is_final'),
  ])
  if (detailResult.error || summaryResult.error) {
    throw new Error(`Monthly archive verification failed; detail cleanup paused: ${detailResult.error?.message || summaryResult.error?.message}`)
  }
  const finalDetails = new Set<string>((detailResult.data ?? [])
    .filter((row: { is_final: boolean }) => row.is_final)
    .map((row: { month: string }) => row.month))
  const finalSummaries = new Set<string>((summaryResult.data ?? [])
    .filter((row: { is_final: boolean }) => row.is_final)
    .map((row: { month: string }) => row.month))

  for (const { table, dateColumn } of RETAINED_TABLES) {
    const removedDates: string[] = []
    let scanFrom: string | null = null
    // Skip protected months, so a missing old archive does not indefinitely
    // prevent cleanup of unrelated months that are safely archived.
    const inspectionLimit = Math.max(1, maxDatePartitionsPerTable) + 24
    for (let index = 0; index < inspectionLimit && removedDates.length < maxDatePartitionsPerTable; index++) {
      let oldestQuery = service
        .from(table)
        .select(dateColumn)
        .not(dateColumn, 'is', null)
        .lt(dateColumn, cutoff)
        .order(dateColumn, { ascending: true })
        .limit(1)
      if (scanFrom) oldestQuery = oldestQuery.gte(dateColumn, scanFrom)
      const { data, error: oldestError } = await oldestQuery
      if (oldestError) throw new Error(`${table} retention lookup failed: ${oldestError.message ?? oldestError}`)
      const oldestDate = data?.[0]?.[dateColumn]
      if (!oldestDate) break

      const month = String(oldestDate).slice(0, 7)
      if (!finalDetails.has(month) || !finalSummaries.has(month)) {
        blockedArchiveMonths.add(month)
        complete = false
        const [year, monthNumber] = month.split('-').map(Number)
        scanFrom = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10)
        continue
      }

      const { error: deleteError } = await service.from(table).delete().eq(dateColumn, oldestDate)
      if (deleteError) throw new Error(`${table} retention delete failed for ${oldestDate}: ${deleteError.message ?? deleteError}`)
      removedDates.push(String(oldestDate))
    }
    removedDatePartitions[table] = removedDates

    const { data: remaining, error: remainingError } = await service
      .from(table)
      .select(dateColumn)
      .not(dateColumn, 'is', null)
      .lt(dateColumn, cutoff)
      .limit(1)
    if (remainingError) throw new Error(`${table} retention verification failed: ${remainingError.message ?? remainingError}`)
    if ((remaining ?? []).length > 0) complete = false
  }

  const blockedMonths = [...blockedArchiveMonths].sort()
  if (blockedMonths.length) {
    console.warn(`Monthly trend archives missing/nonfinal for ${blockedMonths.join(', ')}; preserved their raw keyword/ranking detail. Other archived months can still be cleaned.`)
  }
  return { cutoff, removedDatePartitions, blockedArchiveMonths: blockedMonths, complete }
}
