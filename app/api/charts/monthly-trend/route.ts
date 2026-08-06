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
  app: { keyword: string; contentType: string; volume: number; domains: string[] }[]
  game: { keyword: string; contentType: string; volume: number; domains: string[] }[]
  rankup: { keyword: string; type: string; volume: number; domains: string[] }[]
  rankdown: { keyword: string; type: string; volume: number; domains: string[] }[]
  continuousTrend: { keyword: string; domain: string; type: string; volume: number; streak: number; dates: string[] }[]
  volumeRising: { keyword: string; volume: number; volumeChange: number; domains: string[] }[]
  volumeFalling: { keyword: string; volume: number; volumeChange: number; domains: string[] }[]
  domainWeights: Record<string, { pc: number; mobile: number }>
}

// 2026-08-06 从 规则中心 移到 近期榜单（这个功能本质是"跨站点趋势发现"，
// 不是规则中心的"单站点研究"逻辑，放这边更贴切）。路由本身没变，还是需要
// super/admin 角色——近期榜单页面里的 TapTap/好游快爆两个tab是公开资讯，
// 但月度趋势读的是站内竞品域名/权重等内部数据，前端在 charts/page.tsx 里
// 按角色隐藏了这个tab，这里的角色检查是双重保险。
//
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
    if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 })

    const volumeChangeList = (volumeChangeRows ?? []) as { keyword: string; volume: number; volume_change: number; domains: string[] }[]
    const volumeRising = volumeChangeList.filter(r => r.volume_change > 0).sort((a, b) => b.volume_change - a.volume_change).slice(0, 100)
    const volumeFalling = volumeChangeList.filter(r => r.volume_change < 0).sort((a, b) => a.volume_change - b.volume_change).slice(0, 100)

    const payload: DrillPayload = {
      month: drillMonth,
      app: (appRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, contentType: 'app', volume: r.volume, domains: r.domains })),
      game: (gameRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, contentType: 'game', volume: r.volume, domains: r.domains })),
      rankup: (rankupRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, type: 'rankup', volume: r.volume, domains: r.domains })),
      rankdown: (rankdownRows ?? []).map((r: { keyword: string; volume: number; domains: string[] }) => ({ keyword: r.keyword, type: 'rankdown', volume: r.volume, domains: r.domains })),
      continuousTrend: (continuousRows ?? []).map((r: { keyword: string; domain: string; type: string; volume: number; streak: number; dates: string[] }) =>
        ({ keyword: r.keyword, domain: r.domain, type: r.type, volume: r.volume, streak: r.streak, dates: r.dates })),
      volumeRising: volumeRising.map(r => ({ keyword: r.keyword, volume: r.volume, volumeChange: r.volume_change, domains: r.domains })),
      volumeFalling: volumeFalling.map(r => ({ keyword: r.keyword, volume: r.volume, volumeChange: r.volume_change, domains: r.domains })),
      domainWeights,
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
