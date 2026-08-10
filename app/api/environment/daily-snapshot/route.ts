export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { computeWeightTiers } from '@/lib/weight-tiers'

// 中国大陆法定节假日（不含调休）2025-2027
// 更新方式：每年国务院通知发布后在此追加
const PUBLIC_HOLIDAYS = new Set([
  // 2025
  '2025-01-01',
  '2025-01-28','2025-01-29','2025-01-30','2025-01-31','2025-02-01','2025-02-02','2025-02-03',
  '2025-04-04','2025-04-05','2025-04-06',
  '2025-05-01','2025-05-02','2025-05-03','2025-05-04','2025-05-05',
  '2025-05-31','2025-06-01','2025-06-02',
  '2025-10-01','2025-10-02','2025-10-03','2025-10-04','2025-10-05','2025-10-06','2025-10-07','2025-10-08',
  // 2026
  '2026-01-01',
  '2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-21','2026-02-22','2026-02-23',
  '2026-04-05','2026-04-06',
  '2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05',
  '2026-06-19','2026-06-20','2026-06-21',
  '2026-09-25','2026-09-26','2026-09-27',
  '2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07',
  // 2027
  '2027-01-01',
  '2027-02-06','2027-02-07','2027-02-08','2027-02-09','2027-02-10','2027-02-11','2027-02-12',
  '2027-04-05',
  '2027-05-01','2027-05-02','2027-05-03','2027-05-04','2027-05-05',
  '2027-07-09','2027-07-10','2027-07-11',
  '2027-09-15','2027-09-16','2027-09-17',
  '2027-10-01','2027-10-02','2027-10-03','2027-10-04','2027-10-05','2027-10-06','2027-10-07',
])

// 学生放假期间（近似，按国内学制）
function isSchoolHoliday(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00Z')
  const m = d.getMonth() + 1
  const day = d.getDate()
  if (m === 7 || m === 8) return true          // 暑假
  if (m === 1 && day >= 20) return true         // 寒假开始（约1月20日后）
  if (m === 2) return true                      // 寒假（含春节）
  if (PUBLIC_HOLIDAYS.has(dateStr)) return true // 法定假日同步放假
  return false
}

async function handler(req: Request) {
  // 支持 Bearer CRON_SECRET（GitHub Actions 调用）或 admin/super 用户 session
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  let authed = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)

  if (!authed) {
    const authClient = createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = createServiceClient() as any
    const { data: profile } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
    if (['super', 'admin'].includes(profile?.role)) authed = true
  }
  if (!authed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // 目标日期：MYT 当前日期的前一天（抓取完成后才跑）
  // 支持 ?date=YYYY-MM-DD 手动指定
  const url = new URL(req.url)
  const targetDate = url.searchParams.get('date') ?? (() => {
    const myt = new Date(Date.now() + 8 * 3600000)
    myt.setDate(myt.getDate() - 1)
    return myt.toISOString().slice(0, 10)
  })()

  const prevDate = (() => {
    const d = new Date(targetDate + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()

  // 并行查询
  const [rankRes, todayIndexRes, prevIndexRes] = await Promise.all([
    // 全站当日涨跌词数
    service
      .from('rank_changes')
      .select('type, site_id')
      .eq('stat_date', targetDate),

    // 当日各站收录数
    service
      .from('index_snapshots')
      .select('site_id, index_count')
      .eq('snapshot_date', targetDate),

    // 前日各站收录数（用于计算变化率）
    service
      .from('index_snapshots')
      .select('site_id, index_count')
      .eq('snapshot_date', prevDate),
  ])

  // 计算排名信号
  const rankRows: { type: string; site_id: string }[] = rankRes.data ?? []
  const total_rankup   = rankRows.filter(r => r.type === 'rankup').length
  const total_rankdown = rankRows.filter(r => r.type === 'rankdown').length
  const sites_with_rank_data = new Set(rankRows.map(r => r.site_id)).size
  const crawl_anomaly = total_rankup + total_rankdown === 0

  // 计算收录变化率
  const todayMap = new Map<string, number>(
    (todayIndexRes.data ?? []).map((r: { site_id: string; index_count: number }) => [r.site_id, r.index_count])
  )
  const prevMap = new Map<string, number>(
    (prevIndexRes.data ?? []).map((r: { site_id: string; index_count: number }) => [r.site_id, r.index_count])
  )

  // 每个站点的收录日环比——真实数据验证过会有单站点离谱波动（比如某站前一天
  // 收录数只读到1，当天读到34965，单站算出来是+3496400%），一旦有这种分母
  // 接近0的站点，简单平均会被拉到离谱大的数字，2026-08-04真实数据这么算出来
  // 直接把 avg_index_change_pct 这个数据库字段撑到"numeric field overflow"
  // 报错，整个当天的环境快照都写不进去。改用中位数——不怕这种极端离群值，
  // 同一批数据中位数只有0%，稳定得多。
  const sitePctChange = new Map<string, number>()
  for (const [siteId, todayCount] of Array.from(todayMap)) {
    const prevCount = prevMap.get(siteId)
    if (prevCount && prevCount > 0) sitePctChange.set(siteId, (todayCount - prevCount) / prevCount * 100)
  }

  function median(values: number[]): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  }

  const fleetMedianChangePct = median(Array.from(sitePctChange.values()))
  const avg_index_change_pct = fleetMedianChangePct != null ? Math.round(fleetMedianChangePct * 100) / 100 : null
  const sites_with_index_data = todayMap.size

  // ── 分段异常检测（2026-08-07 新增）────────────────────────────────────
  // 不用人工打的站点标签（sites.category是纯手动下拉框，site_weight/site_ip/
  // site_index_count 现在没有任何地方在写，是死字段），两个维度都从当天真实
  // 抓取数据现算，每天重新分档，不存成站点的固定属性：
  // 1. 体量档位——weight_history 当天最新一条 pc_weight+mobile_weight，按当天
  //    全站百分位分三档（高/中/低）。
  // 2. 内容侧重——raw_keywords 过去30天 content_type 分布算游戏占比，分游戏
  //    为主/应用为主/混合；过去30天完全没新增的站点不参与这个维度。
  // 目的：区分"是不是整个大盘一起跌"（各档位/侧重都跌，大概率是百度算法层面
  // 的事）还是"只有某一类站点在跌"（某个分段明显偏离大盘均值，值得单独去看
  // 这批站点发生了什么）。
  const rawKwSince = new Date(new Date(targetDate + 'T00:00:00').getTime() - 30 * 86400000).toISOString().slice(0, 10)
  const [weightRes, rawKwCountRes] = await Promise.all([
    service.from('weight_history').select('site_id, pc_weight, mobile_weight').eq('record_date', targetDate),
    service.from('raw_keywords').select('id', { count: 'exact', head: true })
      .gte('content_date', rawKwSince).lte('content_date', targetDate),
  ])

  const weightRows = (weightRes.data ?? []) as { site_id: string; pc_weight: number | null; mobile_weight: number | null }[]
  const siteWeight = new Map<string, number>(weightRows.map(r => [r.site_id, (r.pc_weight ?? 0) + (r.mobile_weight ?? 0)]))

  const rawKwRows = await fetchAllRows<{ site_id: string; content_type: string | null }>((from, to) =>
    service.from('raw_keywords').select('site_id, content_type')
      .gte('content_date', rawKwSince).lte('content_date', targetDate)
      .order('id', { ascending: true }).range(from, to),
    { countHint: rawKwCountRes.count ?? 0 })

  const siteContentCounts = new Map<string, { game: number; app: number }>()
  for (const r of rawKwRows) {
    if (r.content_type !== 'game' && r.content_type !== 'app') continue
    if (!siteContentCounts.has(r.site_id)) siteContentCounts.set(r.site_id, { game: 0, app: 0 })
    const c = siteContentCounts.get(r.site_id)!
    if (r.content_type === 'game') c.game++
    else c.app++
  }

  // 33/66百分位分档算法抽到 lib/weight-tiers.ts 跟研究报告共用（2026-08-10），
  // 这里的分段标签（高/中/低档）是这张表的历史存量格式，不跟着改名，只是
  // 内部换成共用函数算，翻译一下标签名。
  const weightTierMap = computeWeightTiers(weightRows)
  const TIER_LABEL_LEGACY: Record<string, string> = { '小站': '低档', '中站': '中档', '大站': '高档' }
  function weightTierOf(siteId: string): string | null {
    const tier = weightTierMap.get(siteId)
    return tier ? TIER_LABEL_LEGACY[tier] : null
  }

  function contentFocusOf(siteId: string): string | null {
    const c = siteContentCounts.get(siteId)
    if (!c) return null
    const total = c.game + c.app
    if (total === 0) return null
    const ratio = c.game / total
    if (ratio >= 0.7) return '游戏为主'
    if (ratio <= 0.3) return '应用为主'
    return '混合'
  }

  const allSiteIds = new Set<string>([...Array.from(todayMap.keys()), ...Array.from(siteWeight.keys()), ...Array.from(siteContentCounts.keys())])
  const rankBySite = new Map<string, { up: number; down: number }>()
  for (const r of rankRows) {
    if (!rankBySite.has(r.site_id)) rankBySite.set(r.site_id, { up: 0, down: 0 })
    const e = rankBySite.get(r.site_id)!
    if (r.type === 'rankup') e.up++
    else if (r.type === 'rankdown') e.down++
  }

  function computeSegmentStats(siteIds: string[]) {
    const pctValues: number[] = []
    let up = 0, down = 0
    for (const siteId of siteIds) {
      const pct = sitePctChange.get(siteId)
      if (pct != null) pctValues.push(pct)
      const r = rankBySite.get(siteId)
      if (r) { up += r.up; down += r.down }
    }
    const m = median(pctValues)
    return {
      site_count: siteIds.length,
      avg_index_change_pct: m != null ? Math.round(m * 100) / 100 : null,
      total_rankup: up,
      total_rankdown: down,
    }
  }

  const ANOMALY_THRESHOLD_PCT = 5   // 跟大盘中位数偏离超过5个百分点才算异常
  // 分段站点数太少不做异常判断——真实数据验证过：3个站点取中位数，本质就是
  // 中间那一个站点的读数，一个站点噪音就能让整段被标"异常"，没有统计意义。
  // 5是折中值：内容侧重"游戏为主"这段现在只有3-4个站点，达不到5，暂时就不
  // 判断这个分段的异常，等监控的游戏站更多了再自然覆盖到。
  const MIN_SEGMENT_SITES = 5

  // 字段名叫 avg_index_change_pct，实际存的是中位数（跟 environment_daily 主表
  // 那个真正的平均值同名字段区分开成本较高，这里就不改表结构了，字段含义
  // 以这条注释和上面 median() 的用法为准）。
  const segmentRows: {
    date: string; dimension: string; segment: string; site_count: number
    avg_index_change_pct: number | null; fleet_avg_index_change_pct: number | null
    deviation_pct: number | null; total_rankup: number; total_rankdown: number; is_anomaly: boolean
  }[] = []

  function pushSegments(dimension: string, groups: Map<string, string[]>) {
    for (const [segment, siteIds] of Array.from(groups)) {
      const stats = computeSegmentStats(siteIds)
      const deviation = (stats.avg_index_change_pct != null && fleetMedianChangePct != null)
        ? Math.round((stats.avg_index_change_pct - fleetMedianChangePct) * 100) / 100
        : null
      const is_anomaly = deviation != null && Math.abs(deviation) >= ANOMALY_THRESHOLD_PCT && stats.site_count >= MIN_SEGMENT_SITES
      segmentRows.push({
        date: targetDate,
        dimension,
        segment,
        site_count: stats.site_count,
        avg_index_change_pct: stats.avg_index_change_pct,
        fleet_avg_index_change_pct: fleetMedianChangePct != null ? Math.round(fleetMedianChangePct * 100) / 100 : null,
        deviation_pct: deviation,
        total_rankup: stats.total_rankup,
        total_rankdown: stats.total_rankdown,
        is_anomaly,
      })
    }
  }

  const weightGroups = new Map<string, string[]>()
  for (const siteId of Array.from(allSiteIds)) {
    const tier = weightTierOf(siteId)
    if (tier == null) continue
    if (!weightGroups.has(tier)) weightGroups.set(tier, [])
    weightGroups.get(tier)!.push(siteId)
  }
  pushSegments('weight_tier', weightGroups)

  const focusGroups = new Map<string, string[]>()
  for (const siteId of Array.from(allSiteIds)) {
    const focus = contentFocusOf(siteId)
    if (focus == null) continue
    if (!focusGroups.has(focus)) focusGroups.set(focus, [])
    focusGroups.get(focus)!.push(siteId)
  }
  pushSegments('content_focus', focusGroups)

  if (segmentRows.length > 0) {
    const { error: segError } = await service.from('environment_segments_daily')
      .upsert(segmentRows, { onConflict: 'date,dimension,segment' })
    if (segError) return NextResponse.json({ error: segError.message }, { status: 500 })
  }

  // 日期属性
  const d = new Date(targetDate + 'T00:00:00')
  const weekday = d.getDay() // 0=周日
  const is_holiday = PUBLIC_HOLIDAYS.has(targetDate)
  const is_school_holiday = isSchoolHoliday(targetDate)

  // 写入（upsert，重复日期不报错）
  const { error } = await service.from('environment_daily').upsert({
    date: targetDate,
    weekday,
    is_holiday,
    is_school_holiday,
    total_rankup,
    total_rankdown,
    sites_with_rank_data,
    avg_index_change_pct,
    sites_with_index_data,
    crawl_anomaly,
  }, { onConflict: 'date' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    date: targetDate,
    weekday,
    is_holiday,
    is_school_holiday,
    total_rankup,
    total_rankdown,
    sites_with_rank_data,
    avg_index_change_pct,
    sites_with_index_data,
    crawl_anomaly,
    segments: segmentRows,
  })
}

export const GET  = handler
export const POST = handler
