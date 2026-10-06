// keyword_volume previously just overwrote the single row per keyword on every
// crawl (onConflict: 'keyword'), so no history was ever kept — every prior
// day's value was silently lost. Besides the latest delta, keep a durable
// baseline so 0 -> 100 -> 50 is still recognised as net +50 even though the
// latest movement is -50. Existing rows receive their honest starting point
// in migration 20260929_keyword_volume_net_growth; history is not invented.
type VolRow = { keyword: string; volume: number; latest_trend?: string; stat_date: string }

type DatabaseResult<TData = unknown> = { data: TData | null; error: { message?: string } | null }

async function retryDatabaseRequest<TData = unknown>(
  label: string,
  operation: () => PromiseLike<DatabaseResult<TData>>,
): Promise<DatabaseResult<TData>> {
  let result = await operation()
  for (let attempt = 2; result.error && attempt <= 4; attempt += 1) {
    console.warn(`${label} failed (${result.error.message || 'unknown error'}), retry ${attempt}/4`)
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt - 1)))
    result = await operation()
  }
  return result
}

export async function upsertKeywordVolumeWithChange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: VolRow[],
) {
  if (rows.length === 0) return

  // CJK keywords get %XX-percent-encoded in the .in() query string — 150/batch
  // keeps requests under the ~16KB header limit (see the header-overflow fix
  // applied elsewhere in this codebase for the same reason).
  type ExistingVolume = {
    volume: number
    stat_date: string | null
    baseline_volume: number | null
    baseline_date: string | null
  }
  const oldVolMap = new Map<string, ExistingVolume>()
  for (let i = 0; i < rows.length; i += 150) {
    const chunk = rows.slice(i, i + 150).map(r => r.keyword)
    const { data, error } = await retryDatabaseRequest<(ExistingVolume & { keyword: string })[]>('keyword_volume baseline lookup', () => supabase
      .from('keyword_volume')
      .select('keyword, volume, stat_date, baseline_volume, baseline_date')
      .in('keyword', chunk))
    if (error) throw new Error(`keyword_volume baseline lookup failed: ${error.message}`)
    for (const r of (data ?? []) as (ExistingVolume & { keyword: string })[]) oldVolMap.set(r.keyword, r)
  }

  const withChange = rows.map(r => {
    const existing = oldVolMap.get(r.keyword)
    const prev = existing?.volume
    return {
      ...r,
      prev_volume: prev ?? null,
      volume_change: (prev != null) ? r.volume - prev : 0,
      baseline_volume: existing?.baseline_volume ?? prev ?? r.volume,
      baseline_date: existing?.baseline_date ?? existing?.stat_date ?? r.stat_date,
    }
  })

  for (let i = 0; i < withChange.length; i += 500) {
    const chunk = withChange.slice(i, i + 500)
    const { error } = await retryDatabaseRequest('keyword_volume upsert', () => supabase
      .from('keyword_volume')
      .upsert(chunk, { onConflict: 'keyword' }))
    if (error) throw new Error(`keyword_volume upsert failed: ${error.message}`)
  }
}
