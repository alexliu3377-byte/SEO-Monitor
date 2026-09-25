export type LatestUrlRankRow = {
  id: string | number
  url: string
  keyword: string
  rank_position: number | null
  prev_rank: number | null
  volume: number
  stat_date: string
  platform: 'mobile' | 'pc'
  type: 'rankup' | 'rankdown'
}

export type DeviceRankStatus = '上涨' | '下跌' | '同日升跌'

export interface DeviceRankSnapshot {
  platform: 'mobile' | 'pc'
  status: DeviceRankStatus
  keyword: string
  rank_position: number | null
  prev_rank_position: number | null
  volume: number
  confirmed_date: string
  evidence_types: Array<'rankup' | 'rankdown'>
}

// Rank-change pages can contain both up and down rows on the same day. Keep
// both as evidence, but choose an up row for scoring/display when present.
// Missing days never erase a platform: the RPC supplies its latest historical
// evidence, and confirmed_date makes that age visible to the user.
export function buildDeviceRankSnapshots(rows: LatestUrlRankRow[]): DeviceRankSnapshot[] {
  const snapshots: DeviceRankSnapshot[] = []
  for (const platform of ['mobile', 'pc'] as const) {
    const platformRows = rows.filter(row => row.platform === platform)
    if (platformRows.length === 0) continue
    const confirmedDate = platformRows.reduce((latest, row) => row.stat_date > latest ? row.stat_date : latest, '')
    const latestRows = platformRows.filter(row => row.stat_date === confirmedDate)
    const upRows = latestRows.filter(row => row.type === 'rankup')
    const downRows = latestRows.filter(row => row.type === 'rankdown')
    const preferredRows = upRows.length > 0 ? upRows : downRows
    const representative = [...preferredRows].sort((a, b) => {
      const aRank = a.rank_position ?? Number.MAX_SAFE_INTEGER
      const bRank = b.rank_position ?? Number.MAX_SAFE_INTEGER
      if (aRank !== bRank) return aRank - bRank
      return b.volume - a.volume
    })[0]
    if (!representative) continue
    snapshots.push({
      platform,
      status: upRows.length > 0 && downRows.length > 0 ? '同日升跌' : upRows.length > 0 ? '上涨' : '下跌',
      keyword: representative.keyword,
      rank_position: representative.rank_position,
      prev_rank_position: representative.prev_rank,
      volume: representative.volume,
      confirmed_date: confirmedDate,
      evidence_types: [
        ...(upRows.length > 0 ? ['rankup' as const] : []),
        ...(downRows.length > 0 ? ['rankdown' as const] : []),
      ],
    })
  }
  return snapshots
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
    if (a.type !== b.type) return a.type === 'rankup' ? -1 : 1
    const aRank = a.rank_position ?? Number.MAX_SAFE_INTEGER
    const bRank = b.rank_position ?? Number.MAX_SAFE_INTEGER
    if (aRank !== bRank) return aRank - bRank
    return String(a.id).localeCompare(String(b.id))
  })
}
