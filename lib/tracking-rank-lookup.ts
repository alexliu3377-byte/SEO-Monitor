export type LatestUrlRankRow = {
  id: string
  url: string
  keyword: string
  rank_position: number | null
  prev_rank: number | null
  volume: number
  stat_date: string
}

// The old tracking code queried every historical site_keyword_ranks row for
// each URL. As the table grew, each batch hit Postgres' statement timeout and
// the caller silently continued with incomplete data. The database RPC uses a
// URL index and DISTINCT ON to return only the newest row per URL/keyword.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchLatestUrlRanks(service: any, urls: string[]): Promise<LatestUrlRankRow[]> {
  if (urls.length === 0) return []

  const { data, error } = await service.rpc('get_latest_site_keyword_ranks_by_urls', {
    p_urls: urls,
  })
  if (error) {
    throw new Error(
      `get_latest_site_keyword_ranks_by_urls failed: ${error.message ?? JSON.stringify(error)}. ` +
      'Run migration 20260917_tracking_retry_timeout_fix.sql before the next tracking run.'
    )
  }

  return ((data ?? []) as LatestUrlRankRow[]).sort((a, b) => {
    const byDate = b.stat_date.localeCompare(a.stat_date)
    if (byDate !== 0) return byDate
    const aRank = a.rank_position ?? Number.MAX_SAFE_INTEGER
    const bRank = b.rank_position ?? Number.MAX_SAFE_INTEGER
    if (aRank !== bRank) return aRank - bRank
    return a.id.localeCompare(b.id)
  })
}
