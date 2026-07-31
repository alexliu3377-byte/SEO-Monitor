// keyword_volume previously just overwrote the single row per keyword on every
// crawl (onConflict: 'keyword'), so no history was ever kept — every prior
// day's value was silently lost. 2026-07-30: look up the existing volume right
// before overwriting it, and store the delta (prev_volume/volume_change) on
// the same row. This doesn't rebuild full daily history, but it's enough to
// answer "did this keyword's search volume just go up" — which is what drives
// the 分组任务/热词雷达 "搜索量上涨" tab.
type VolRow = { keyword: string; volume: number; latest_trend: string; stat_date: string }

export async function upsertKeywordVolumeWithChange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: VolRow[],
) {
  if (rows.length === 0) return

  // CJK keywords get %XX-percent-encoded in the .in() query string — 150/batch
  // keeps requests under the ~16KB header limit (see the header-overflow fix
  // applied elsewhere in this codebase for the same reason).
  const oldVolMap = new Map<string, number>()
  for (let i = 0; i < rows.length; i += 150) {
    const chunk = rows.slice(i, i + 150).map(r => r.keyword)
    const { data } = await supabase.from('keyword_volume').select('keyword, volume').in('keyword', chunk)
    for (const r of (data ?? []) as { keyword: string; volume: number }[]) oldVolMap.set(r.keyword, r.volume)
  }

  const withChange = rows.map(r => {
    const prev = oldVolMap.get(r.keyword)
    return {
      ...r,
      prev_volume: prev ?? null,
      volume_change: (prev != null) ? r.volume - prev : 0,
    }
  })

  for (let i = 0; i < withChange.length; i += 500) {
    const chunk = withChange.slice(i, i + 500)
    await supabase.from('keyword_volume').upsert(chunk, { onConflict: 'keyword' })
  }
}
