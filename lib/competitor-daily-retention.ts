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
  let complete = true

  for (const { table, dateColumn } of RETAINED_TABLES) {
    const removedDates: string[] = []
    for (let index = 0; index < maxDatePartitionsPerTable; index++) {
      const { data, error: oldestError } = await service
        .from(table)
        .select(dateColumn)
        .not(dateColumn, 'is', null)
        .lt(dateColumn, cutoff)
        .order(dateColumn, { ascending: true })
        .limit(1)
      if (oldestError) throw new Error(`${table} retention lookup failed: ${oldestError.message ?? oldestError}`)
      const oldestDate = data?.[0]?.[dateColumn]
      if (!oldestDate) break

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

  return { cutoff, removedDatePartitions, complete }
}
