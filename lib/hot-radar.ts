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

export interface HotRadarComputeResult {
  payload: HotRadarPayload
  // 哪几块因为查询报错拿不到数据——2026-08-13 发现 get_hot_rank_words/
  // get_hot_streak_words 单次就要跑约15秒，跟函数体里设的20秒 statement_timeout
  // 余量很薄，真实负载稍高就会被 Postgres 中止报错；之前这里完全没检查
  // RPC 调用的 error，直接 `(rankWordsRaw || [])` 把报错静默当成"这块本来
  // 就没数据"，缓存被写成空数组覆盖掉上次的正常数据（用户反馈"资料又看不到
  // 了"）。调用方（refresh/route.ts）看到这里非空时不能直接覆盖旧缓存。
  failedSections: (keyof HotRadarPayload)[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpcWithRetry(db: any, fn: string, args: Record<string, unknown>): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  const first = await db.rpc(fn, args)
  if (!first.error) return first
  // 单次重试——目标查询本身耗时接近超时阈值，大概率是瞬时负载高，隔几秒
  // 再跑一次经常就过了，不值得直接放弃。
  await new Promise(r => setTimeout(r, 3000))
  return db.rpc(fn, args)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeHotRadarPayload(supabase: any): Promise<HotRadarComputeResult> {
  const since = getMY(-30)
  const db = supabase
  const failedSections: (keyof HotRadarPayload)[] = []

  const [
    { data: newWordsRaw, error: newWordsErr },
    { data: rankWordsRaw, error: rankWordsErr },
    { data: streakWordsRaw, error: streakWordsErr },
    { data: volumeRisingRaw, error: volErr },
  ] = await Promise.all([
    rpcWithRetry(db, 'get_hot_new_words',    { p_since: since }),
    rpcWithRetry(db, 'get_hot_rank_words',   { p_since: since }),
    rpcWithRetry(db, 'get_hot_streak_words', { p_since: since }),
    db.from('keyword_volume')
      .select('keyword, volume, prev_volume, volume_change, stat_date')
      .gt('volume_change', 0)
      .gte('stat_date', getMY(-14))
      .order('volume_change', { ascending: false })
      .limit(500),
  ])
  if (newWordsErr) { console.error('[hot-radar] get_hot_new_words 失败:', newWordsErr.message); failedSections.push('newWords') }
  if (rankWordsErr) { console.error('[hot-radar] get_hot_rank_words 失败:', rankWordsErr.message); failedSections.push('rankWords') }
  if (streakWordsErr) { console.error('[hot-radar] get_hot_streak_words 失败:', streakWordsErr.message); failedSections.push('streakWords') }
  if (volErr) { console.error('[hot-radar] keyword_volume 查询失败:', volErr.message); failedSections.push('volumeRisingWords') }

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
    // 2026-08-20 起改读 keyword_signal_rollup（跟"竞品涨排名"/"连续上涨词"同一张
    // 增量汇总表），不再现场查 rank_changes——顺带这段"涨/跌方向"判断也纳入了
    // 排名模式站点（site_keyword_ranks）的数据，之前只看涨跌抓取。
    for (let i = 0; i < vrKeywords.length; i += 150) {
      const { data: rollupRows } = await db.from('keyword_signal_rollup')
        .select('keyword, site_id, type, last_seen')
        .in('keyword', vrKeywords.slice(i, i + 150))
        .gte('last_seen', rcSince)
      for (const row of (rollupRows || []) as { keyword: string; site_id: string; type: string; last_seen: string }[]) {
        const domain = siteIdToDomain.get(row.site_id)
        if (!domain) continue
        let entry = siteTrendMap.get(row.keyword)
        if (!entry) { entry = { sites: new Set(), latestDate: '', hasUpLatest: false, hasDownLatest: false }; siteTrendMap.set(row.keyword, entry) }
        entry.sites.add(domain)
        const rowDate = String(row.last_seen).slice(0, 10)
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

  return { payload: { newWords, rankWords, streakWords, volumeRisingWords }, failedSections }
}
