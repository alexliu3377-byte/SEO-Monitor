// 热词雷达（研究中心/分组任务共用）的聚合计算——2026-08-11 从 app/api/hot-radar/
// route.ts 抽出来，原因见该文件同一天的改动：get_hot_new_words/get_hot_rank_words/
// get_hot_streak_words 三个 RPC 要扫 rank_changes/site_keyword_ranks 近30天全量
// 数据（永久保留、每天持续写入，跟这个项目已经踩过好几次的"表越长越大拖垮查询"
// 是同一类问题），单次调用要2-8秒，用户反馈"每天打开都很慢"。改成定时任务算好
// 存进 hot_radar_cache 表，读接口直接读缓存，不再每次现场算。

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

interface NewWordRow    { keyword: string; site_count: number; total_count: number; sites: string[]; first_date: string; last_date: string }
interface RankWordRow   { keyword: string; site_count: number; max_volume: number;  sites: string[]; first_date: string; last_date: string; rank_days: number }
interface StreakWordRow { keyword: string; domain: string; streak: number; volume: number; first_seen: string; last_seen: string }
interface VolumeRisingRow { keyword: string; volume: number; prev_volume: number | null; volume_change: number; stat_date: string }

export interface HotRadarPayload {
  newWords: { keyword: string; count: number; siteCount: number; sites: string[]; last_date: string; first_date: string }[]
  rankWords: { keyword: string; siteCount: number; volume: number; sites: string[]; last_date: string; first_date: string; rankDays: number }[]
  streakWords: { keyword: string; streak: number; domain: string; volume: number; first_date: string; last_date: string }[]
  volumeRisingWords: { keyword: string; volume: number; prevVolume: number | null; change: number; last_date: string; sites: string[]; rankTrend: 'up' | 'down' | 'both' | null }[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeHotRadarPayload(supabase: any): Promise<HotRadarPayload> {
  const since = getMY(-30)
  const db = supabase

  const [
    { data: newWordsRaw },
    { data: rankWordsRaw },
    { data: streakWordsRaw },
    { data: volumeRisingRaw },
  ] = await Promise.all([
    db.rpc('get_hot_new_words',    { p_since: since }),
    db.rpc('get_hot_rank_words',   { p_since: since }),
    db.rpc('get_hot_streak_words', { p_since: since }),
    db.from('keyword_volume')
      .select('keyword, volume, prev_volume, volume_change, stat_date')
      .gt('volume_change', 0)
      .gte('stat_date', getMY(-14))
      .order('volume_change', { ascending: false })
      .limit(500),
  ])

  const toDate = (v: unknown) => v ? String(v).slice(0, 10) : ''

  const newWords = ((newWordsRaw || []) as NewWordRow[]).map((r) => ({
    keyword:   r.keyword,
    count:     Number(r.total_count),
    siteCount: Number(r.site_count),
    sites:     r.sites || [],
    last_date:  toDate(r.last_date),
    first_date: toDate(r.first_date),
  }))

  const rankWords = ((rankWordsRaw || []) as RankWordRow[]).map((r) => ({
    keyword:   r.keyword,
    siteCount: Number(r.site_count),
    volume:    Number(r.max_volume),
    sites:     r.sites || [],
    last_date:  toDate(r.last_date),
    first_date: toDate(r.first_date),
    rankDays:   Number(r.rank_days),
  }))

  const streakWords = ((streakWordsRaw || []) as StreakWordRow[]).map((r) => ({
    keyword:    r.keyword,
    streak:     Number(r.streak),
    domain:     r.domain,
    volume:     Number(r.volume),
    first_date: toDate(r.first_seen),
    last_date:  toDate(r.last_seen),
  }))

  const vrKeywords = ((volumeRisingRaw || []) as VolumeRisingRow[]).map((r) => r.keyword)
  const siteTrendMap = new Map<string, { sites: Set<string>; latestDate: string; hasUpLatest: boolean; hasDownLatest: boolean }>()
  if (vrKeywords.length > 0) {
    const { data: sitesRaw } = await db.from('sites').select('id, domain')
    const siteIdToDomain = new Map<string, string>((sitesRaw || []).map((s: { id: string; domain: string }) => [s.id, s.domain]))
    const rcSince = getMY(-14)
    for (let i = 0; i < vrKeywords.length; i += 150) {
      const { data: rcRows } = await db.from('rank_changes')
        .select('keyword, site_id, type, stat_date')
        .in('keyword', vrKeywords.slice(i, i + 150))
        .gte('stat_date', rcSince)
      for (const row of (rcRows || []) as { keyword: string; site_id: string; type: string; stat_date: string }[]) {
        const domain = siteIdToDomain.get(row.site_id)
        if (!domain) continue
        let entry = siteTrendMap.get(row.keyword)
        if (!entry) { entry = { sites: new Set(), latestDate: '', hasUpLatest: false, hasDownLatest: false }; siteTrendMap.set(row.keyword, entry) }
        entry.sites.add(domain)
        const rowDate = String(row.stat_date).slice(0, 10)
        if (rowDate > entry.latestDate) {
          entry.latestDate = rowDate
          entry.hasUpLatest = row.type === 'rankup'
          entry.hasDownLatest = row.type === 'rankdown'
        } else if (rowDate === entry.latestDate) {
          if (row.type === 'rankup') entry.hasUpLatest = true
          else if (row.type === 'rankdown') entry.hasDownLatest = true
        }
      }
    }
  }

  const volumeRisingWords = ((volumeRisingRaw || []) as VolumeRisingRow[]).map((r) => {
    const t = siteTrendMap.get(r.keyword)
    return {
      keyword:     r.keyword,
      volume:      Number(r.volume),
      prevVolume:  r.prev_volume != null ? Number(r.prev_volume) : null,
      change:      Number(r.volume_change),
      last_date:   toDate(r.stat_date),
      sites:       t ? Array.from(t.sites) : [],
      rankTrend:   (!t ? null : t.hasUpLatest && t.hasDownLatest ? 'both' : t.hasUpLatest ? 'up' : t.hasDownLatest ? 'down' : null) as 'up' | 'down' | 'both' | null,
    }
  })

  return { newWords, rankWords, streakWords, volumeRisingWords }
}
