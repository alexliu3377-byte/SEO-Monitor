import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

async function requireAdmin() {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { service }
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

interface DrillPayload {
  month: string
  app: { keyword: string; contentType: string; volume: number }[]
  game: { keyword: string; contentType: string; volume: number }[]
  rankup: { keyword: string; type: string; volume: number; domains: string[] }[]
  rankdown: { keyword: string; type: string; volume: number; domains: string[] }[]
  continuousTrend: { keyword: string; domain: string; type: string; volume: number; streak: number; dates: string[] }[]
}

// 全站（不分站点）按月汇总 raw_keywords 的应用/游戏新增数量，用来发现"哪个月
// 哪个类目在涨"这种跨站点、跨时间的规律。
//
// 下钻（?month=）最初是把整月几十万行 rank_changes 拉到 Node 里再用 JS 聚合——
// 2026-08-06 实测一个月81万行光拉数据就要将近30秒，用户反馈不合理。改成两处
// 优化：1) 聚合改到 SQL 里做（monthly_rank_change_top/monthly_continuous_trend/
// monthly_new_keyword_top 三个 RPC，见 supabase/schema.sql），只把聚合后的
// 一两百行结果传回来，不搬整月原始数据；2) 已经过去的月份（不是当月）数据
// 不会再变，算完一次写进 monthly_trend_cache 表，下次直接读缓存。只有还在
// 变动的当月每次都会重新查（现在已经是 SQL 聚合，不再是瓶颈）。
export async function GET(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { searchParams } = new URL(req.url)
  const drillMonth = searchParams.get('month')

  if (drillMonth) {
    if (!/^\d{4}-\d{2}$/.test(drillMonth)) return NextResponse.json({ error: 'month 格式应为 YYYY-MM' }, { status: 400 })
    const [y, m] = drillMonth.split('-').map(Number)
    const start = `${drillMonth}-01`
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const isClosedMonth = drillMonth < currentMonthCN()

    if (isClosedMonth) {
      const { data: cached } = await service.from('monthly_trend_cache').select('payload').eq('month', drillMonth).maybeSingle()
      if (cached?.payload) return NextResponse.json(cached.payload as DrillPayload)
    }

    // 三个 rank_changes 聚合（rankup/rankdown/continuousTrend）单独跑都要 7-9 秒，
    // 2026-08-06 实测用 Promise.all 一起并发跑会互相抢数据库资源，三个全部因为
    // "canceling statement due to statement timeout" 失败、悄悄返回空数组（查询
    // 报错但如果没检查 error 字段就会被 `?? []` 吞掉，页面看起来"这个月没有涨跌词"
    // 但其实是查询失败，不是真的没数据）。改成串行跑重的三个，避免抢资源；
    // 两个新增关键词的查询轻，还是并行跑没关系。
    const [{ data: appRows, error: appErr }, { data: gameRows, error: gameErr }] = await Promise.all([
      service.rpc('monthly_new_keyword_top', { p_start: start, p_end: end, p_content_type: 'app', p_limit: 50 }),
      service.rpc('monthly_new_keyword_top', { p_start: start, p_end: end, p_content_type: 'game', p_limit: 50 }),
    ])
    const { data: rankupRows, error: rankupErr } = await service.rpc('monthly_rank_change_top', { p_start: start, p_end: end, p_type: 'rankup', p_limit: 100 })
    const { data: rankdownRows, error: rankdownErr } = await service.rpc('monthly_rank_change_top', { p_start: start, p_end: end, p_type: 'rankdown', p_limit: 100 })
    const { data: continuousRows, error: continuousErr } = await service.rpc('monthly_continuous_trend', { p_start: start, p_end: end, p_limit: 100 })

    const rpcError = appErr || gameErr || rankupErr || rankdownErr || continuousErr
    if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 })

    const payload: DrillPayload = {
      month: drillMonth,
      app: (appRows ?? []).map((r: { keyword: string; volume: number }) => ({ keyword: r.keyword, contentType: 'app', volume: r.volume })),
      game: (gameRows ?? []).map((r: { keyword: string; volume: number }) => ({ keyword: r.keyword, contentType: 'game', volume: r.volume })),
      rankup: (rankupRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, type: 'rankup', volume: r.volume, domains: r.domains })),
      rankdown: (rankdownRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, type: 'rankdown', volume: r.volume, domains: r.domains })),
      continuousTrend: (continuousRows ?? []).map((r: { keyword: string; domain: string; type: string; volume: number; streak: number; dates: string[] }) =>
        ({ keyword: r.keyword, domain: r.domain, type: r.type, volume: r.volume, streak: r.streak, dates: r.dates })),
    }

    if (isClosedMonth) {
      await service.from('monthly_trend_cache').upsert({ month: drillMonth, payload, computed_at: new Date().toISOString() })
    }

    return NextResponse.json(payload)
  }

  const { data: earliestRow } = await service.from('raw_keywords').select('content_date')
    .not('content_date', 'is', null).order('content_date', { ascending: true }).limit(1).single()
  const { data: latestRow } = await service.from('raw_keywords').select('content_date')
    .not('content_date', 'is', null).order('content_date', { ascending: false }).limit(1).single()

  if (!earliestRow || !latestRow) return NextResponse.json({ months: [], earliestMonth: null })

  const months = monthsBetween(earliestRow.content_date.slice(0, 7), latestRow.content_date.slice(0, 7))
  const results = await Promise.all(months.map(async month => {
    const [y, m] = month.split('-').map(Number)
    const start = `${month}-01`
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const [{ count: appCount }, { count: gameCount }] = await Promise.all([
      service.from('raw_keywords').select('id', { count: 'exact', head: true })
        .gte('content_date', start).lte('content_date', end).eq('content_type', 'app'),
      service.from('raw_keywords').select('id', { count: 'exact', head: true })
        .gte('content_date', start).lte('content_date', end).eq('content_type', 'game'),
    ])
    return { month, app: appCount ?? 0, game: gameCount ?? 0 }
  }))

  return NextResponse.json({ months: results, earliestMonth: months[0] })
}
