import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 300

const CURRENT_MONTH_CACHE_TTL_MS = 36 * 60 * 60 * 1000

// 2026-08-06 用户明确要求"全部组员都能看"——不再限 super/admin，只要登录了
// 就能查，跟这个页面另一个tab（TapTap/好游快爆）门槛一致。
async function requireLogin(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authorization = req.headers.get('authorization')
  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any
    return { service, isCron: true }
  }

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  return { service, isCron: false }
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = []
  let [y, m] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

// 跟其它接口一样用 UTC+8 对齐"当前是哪个月"——过了这个月才算"关闭"，可以缓存。
function currentMonthCN(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
}

function isFresh(computedAt: string | null | undefined): boolean {
  if (!computedAt) return false
  const timestamp = Date.parse(computedAt)
  return Number.isFinite(timestamp) && Date.now() - timestamp < CURRENT_MONTH_CACHE_TTL_MS
}

interface DrillPayload {
  month: string
  app: { keyword: string; contentType: string; volume: number; domains: string[] }[]
  game: { keyword: string; contentType: string; volume: number; domains: string[] }[]
  rankup: { keyword: string; type: string; volume: number; domains: string[] }[]
  rankdown: { keyword: string; type: string; volume: number; domains: string[] }[]
  continuousTrend: { keyword: string; type: string; volume: number; streak: number; siteCount: number; sites: { domain: string; streak: number; volume: number; dates: string[] }[] }[]
  volumeRising: { keyword: string; volume: number; volumeChange: number; domains: string[] }[]
  volumeFalling: { keyword: string; volume: number; volumeChange: number; domains: string[] }[]
  domainWeights: Record<string, { pc: number; mobile: number }>
}

// 月度趋势属于跨站点趋势研究，现在作为“趋势发现”的首个工作区。
//
// 全站（不分站点）按月汇总 raw_keywords 的应用/游戏新增数量，用来发现"哪个月
// 哪个类目在涨"这种跨站点、跨时间的规律。
//
// 下钻（?month=）最初是把整月几十万行 rank_changes 拉到 Node 里再用 JS 聚合——
// 2026-08-06 实测一个月81万行光拉数据就要将近30秒，用户反馈不合理。改成两处
// 优化：1) 聚合改到 SQL 里做（monthly_rank_change_top/monthly_continuous_trend/
// monthly_new_keyword_top 三个 RPC，见 supabase/schema.sql），只把聚合后的
// 一两百行结果传回来，不搬整月原始数据；2) 已经过去的月份（不是当月）数据
// 不会再变，算完一次写进 monthly_trend_cache 表，下次直接读缓存。当月也由
// 每日抓取后的 GitHub Actions 预先刷新，组员打开页面时只读取缓存。
export async function GET(req: Request) {
  const ctx = await requireLogin(req)
  if (ctx.error) return ctx.error
  const { service, isCron } = ctx

  const { searchParams } = new URL(req.url)
  const drillMonth = searchParams.get('month')
  const forceRefresh = searchParams.get('refresh') === '1'
  if (forceRefresh && !isCron) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (drillMonth) {
    if (!/^\d{4}-\d{2}$/.test(drillMonth)) return NextResponse.json({ error: 'month 格式应为 YYYY-MM' }, { status: 400 })
    const [y, m] = drillMonth.split('-').map(Number)
    const start = `${drillMonth}-01`
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const isClosedMonth = drillMonth < currentMonthCN()

    // Closed months are immutable after their first post-month refresh. The current
    // month changes during the daily crawls, so cache it briefly instead of running
    // six large aggregate queries every time a user opens the tab.
    const { data: cached, error: cacheReadError } = await service.from('monthly_trend_cache')
      .select('payload, computed_at, is_final')
      .eq('month', drillMonth)
      .maybeSingle()
    if (cacheReadError) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

    const cachedPayload = cached?.payload as DrillPayload | undefined
    const canUseCachedPayload = Boolean(cachedPayload) && !forceRefresh && (
      isClosedMonth ? cached?.is_final === true : true
    )
    if (canUseCachedPayload) {
      const cacheState = isClosedMonth || isFresh(cached?.computed_at) ? 'fresh' : 'stale'
      return NextResponse.json(cachedPayload, { headers: { 'X-Monthly-Trend-Cache': cacheState } })
    }

    // 站点PC/M权重——给"查看"弹窗里的域名标注权重用，跟分组任务详情弹窗同一个
    // 展示方式（domain + "PC{x} · M{y}"）。取每个站点最近30天里最新一条
    // weight_history 记录，按 record_date 升序遍历、后面的覆盖前面的，最后
    // 留下的就是最新值。
    const since30 = new Date(Date.now() + 8 * 3600000 - 30 * 86400000).toISOString().slice(0, 10)
    const [{ data: sitesForWeight }, { data: weightRows }] = await Promise.all([
      service.from('sites').select('id, domain'),
      service.from('weight_history').select('site_id, pc_weight, mobile_weight, record_date')
        .gte('record_date', since30).order('record_date', { ascending: true }),
    ])
    const domainOfSite = new Map<string, string>((sitesForWeight ?? []).map((s: { id: string; domain: string }) => [s.id, s.domain]))
    const domainWeights: Record<string, { pc: number; mobile: number }> = {}
    for (const r of (weightRows ?? []) as { site_id: string; pc_weight: number; mobile_weight: number }[]) {
      const domain = domainOfSite.get(r.site_id)
      if (domain) domainWeights[domain] = { pc: r.pc_weight, mobile: r.mobile_weight }
    }

    // 每个聚合 RPC 单独跑都要几秒，2026-08-06 实测用 Promise.all 一起并发跑会
    // 互相抢数据库资源，直接因为 "canceling statement due to statement timeout"
    // 失败、悄悄返回空数组（查询报错但如果没检查 error 字段就会被 `?? []` 吞掉，
    // 页面看起来"这个月没有涨跌词"但其实是查询失败，不是真的没数据）。全部
    // 改成串行调用，宁可慢一点也不要相互抢导致超时；反正过去的月份缓存后
    // 只会在第一次未命中时付这个代价。
    const { data: appRows, error: appErr } = await service.rpc('monthly_new_keyword_top', { p_start: start, p_end: end, p_content_type: 'app', p_limit: 50 })
    const { data: gameRows, error: gameErr } = await service.rpc('monthly_new_keyword_top', { p_start: start, p_end: end, p_content_type: 'game', p_limit: 50 })
    const { data: rankupRows, error: rankupErr } = await service.rpc('monthly_rank_change_top', { p_start: start, p_end: end, p_type: 'rankup', p_limit: 100 })
    const { data: rankdownRows, error: rankdownErr } = await service.rpc('monthly_rank_change_top', { p_start: start, p_end: end, p_type: 'rankdown', p_limit: 100 })
    const { data: continuousRows, error: continuousErr } = await service.rpc('monthly_continuous_trend', { p_start: start, p_end: end, p_limit: 100 })
    // 搜索量变动跟分组任务"搜索量上涨"同一个数据源（keyword_volume），up/down
    // 一起查一次，前端按正负拆成两栏——见 supabase/schema.sql 里的注释。
    const { data: volumeChangeRows, error: volumeChangeErr } = await service.rpc('monthly_volume_change_top', { p_start: start, p_end: end, p_limit: 300 })

    const rpcError = appErr || gameErr || rankupErr || rankdownErr || continuousErr || volumeChangeErr
    if (rpcError) {
      // A stale current-month snapshot is still more useful than turning the whole
      // trend page into an error while one of the expensive aggregates times out.
      console.error('Failed to refresh monthly trend drilldown', rpcError)
      if (cachedPayload && !forceRefresh) return NextResponse.json(cachedPayload)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const volumeChangeList = (volumeChangeRows ?? []) as { keyword: string; volume: number; volume_change: number; domains: string[] }[]
    const volumeRising = volumeChangeList.filter(r => r.volume_change > 0).sort((a, b) => b.volume_change - a.volume_change).slice(0, 100)
    const volumeFalling = volumeChangeList.filter(r => r.volume_change < 0).sort((a, b) => a.volume_change - b.volume_change).slice(0, 100)

    const payload: DrillPayload = {
      month: drillMonth,
      app: (appRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, contentType: 'app', volume: r.volume, domains: r.domains })),
      game: (gameRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, contentType: 'game', volume: r.volume, domains: r.domains })),
      rankup: (rankupRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, type: 'rankup', volume: r.volume, domains: r.domains })),
      rankdown: (rankdownRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, type: 'rankdown', volume: r.volume, domains: r.domains })),
      continuousTrend: (continuousRows ?? []).map((r: { keyword: string; type: string; volume: number; streak: number; site_count: number; sites: { domain: string; streak: number; volume: number; dates: string[] }[] }) =>
        ({ keyword: r.keyword, type: r.type, volume: r.volume, streak: r.streak, siteCount: r.site_count, sites: r.sites })),
      volumeRising: volumeRising.map(r => ({ keyword: r.keyword, volume: r.volume, volumeChange: r.volume_change, domains: r.domains })),
      volumeFalling: volumeFalling.map(r => ({ keyword: r.keyword, volume: r.volume, volumeChange: r.volume_change, domains: r.domains })),
      domainWeights,
    }

    const { error: cacheWriteError } = await service.from('monthly_trend_cache').upsert({
      month: drillMonth,
      payload,
      computed_at: new Date().toISOString(),
      is_final: isClosedMonth,
    })
    if (cacheWriteError) {
      console.error('Failed to cache monthly trend drilldown', cacheWriteError)
      if (forceRefresh) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    return NextResponse.json(payload)
  }

  const [earliestResult, latestResult] = await Promise.all([
    service.from('raw_keywords').select('content_date')
      .not('content_date', 'is', null).order('content_date', { ascending: true }).limit(1).maybeSingle(),
    service.from('raw_keywords').select('content_date')
      .not('content_date', 'is', null).order('content_date', { ascending: false }).limit(1).maybeSingle(),
  ])

  if (earliestResult.error || latestResult.error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const earliestRow = earliestResult.data
  const latestRow = latestResult.data

  if (!earliestRow || !latestRow) return NextResponse.json({ months: [], earliestMonth: null })

  const months = monthsBetween(earliestRow.content_date.slice(0, 7), latestRow.content_date.slice(0, 7))
  const latestMonth = months[months.length - 1]
  const [summaryCacheResult, detailCacheResult] = await Promise.all([
    service
      .from('monthly_trend_summary_cache')
      .select('month, app_count, game_count, computed_at, is_final')
      .in('month', months),
    service
      .from('monthly_trend_cache')
      .select('month, is_final')
      .eq('month', latestMonth)
      .maybeSingle(),
  ])
  const { data: cachedRows, error: summaryCacheError } = summaryCacheResult

  if (summaryCacheError) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  type SummaryCacheRow = {
    month: string
    app_count: number
    game_count: number
    computed_at: string
    is_final: boolean
  }

  const summaryByMonth = new Map<string, SummaryCacheRow>(
    ((cachedRows ?? []) as SummaryCacheRow[]).map(row => [row.month, row]),
  )
  const currentMonth = currentMonthCN()
  const monthsToRefresh = months.filter(month => {
    const cachedRow = summaryByMonth.get(month)
    if (!cachedRow) return true
    if (month < currentMonth) return !cachedRow.is_final
    // Normal page views always prefer the cached current-month snapshot, even
    // after its short freshness window. The post-crawl job owns refreshes so a
    // team member never has to wait for a full aggregation just to open the tab.
    return forceRefresh
  })

  if (monthsToRefresh.length > 0) {
    const refreshStartMonth = monthsToRefresh[0]
    const refreshEndMonth = monthsToRefresh[monthsToRefresh.length - 1]
    const { data: freshRows, error: refreshError } = await service.rpc('monthly_keyword_counts', {
      p_start: `${refreshStartMonth}-01`,
      p_end: monthEnd(refreshEndMonth),
    })

    if (refreshError) {
      console.error('Failed to refresh monthly trend summary', refreshError)
      // If every requested month has an older snapshot, serve it and retry on the
      // next request. Missing months cannot be represented safely as zero here.
      const hasMissingMonth = monthsToRefresh.some(month => !summaryByMonth.has(month))
      if (forceRefresh || hasMissingMonth) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    } else {
      const freshByMonth = new Map<string, { app_count: number; game_count: number }>(
        ((freshRows ?? []) as { month: string; app_count: number; game_count: number }[])
          .map(row => [row.month, {
            app_count: Number(row.app_count) || 0,
            game_count: Number(row.game_count) || 0,
          }]),
      )
      const computedAt = new Date().toISOString()
      const rowsToCache: SummaryCacheRow[] = monthsToRefresh.map(month => {
        const fresh = freshByMonth.get(month)
        return {
          month,
          app_count: fresh?.app_count ?? 0,
          game_count: fresh?.game_count ?? 0,
          computed_at: computedAt,
          is_final: month < currentMonth,
        }
      })

      for (const row of rowsToCache) summaryByMonth.set(row.month, row)
      const { error: summaryWriteError } = await service
        .from('monthly_trend_summary_cache')
        .upsert(rowsToCache, { onConflict: 'month' })
      if (summaryWriteError) {
        console.error('Failed to cache monthly trend summary', summaryWriteError)
        if (forceRefresh) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    }
  }

  const results = months.map(month => {
    const row = summaryByMonth.get(month)
    return { month, app: row?.app_count ?? 0, game: row?.game_count ?? 0 }
  })

  // Only auto-open the latest month when its heavy drilldown already exists in
  // cache. A fresh deployment or a missed cron must never turn page opening into
  // six serial aggregate queries; the user can still choose a month manually.
  if (detailCacheResult.error) {
    console.error('Failed to inspect monthly trend drilldown cache', detailCacheResult.error)
  }
  const defaultMonth = detailCacheResult.data && (
    latestMonth === currentMonth || detailCacheResult.data.is_final === true
  ) ? latestMonth : null

  return NextResponse.json({ months: results, earliestMonth: months[0], defaultMonth })
}
