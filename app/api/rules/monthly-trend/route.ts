import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/supabase-paginate'

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

// 全站（不分站点）按月汇总 raw_keywords 的应用/游戏新增数量，用来发现"哪个月
// 哪个类目在涨"这种跨站点、跨时间的规律（2026-08-06 用户明确要的是这个，
// 不是自动生成规则）。按月分别 count，而不是把所有行拉下来在内存里聚合——
// raw_keywords 从这次会话起永久保留，行数只会越来越多，count-per-month 的
// 查询量只跟"有多少个月"成正比，不会随行数变慢。
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

    const { data: sitesRaw } = await service.from('sites').select('id, domain')
    const domainOf = new Map<string, string>((sitesRaw ?? []).map((s: { id: string; domain: string }) => [s.id, s.domain]))

    // 全站整月的量可能很大（rank_changes 一个月能有80万行），先精确count再
    // 并行拉所有页——串行一页页翻会拖到serverless函数超时，见 lib/supabase-paginate.ts。
    const [{ count: newKwCount }, { count: rcCount }] = await Promise.all([
      service.from('raw_keywords').select('id', { count: 'exact', head: true }).gte('content_date', start).lte('content_date', end),
      service.from('rank_changes').select('id', { count: 'exact', head: true }).gte('stat_date', start).lte('stat_date', end),
    ])

    const [newKwRows, rcRows] = await Promise.all([
      fetchAllRows<{ keyword: string; content_type: string }>((from, to) =>
        service.from('raw_keywords').select('keyword, content_type')
          .gte('content_date', start).lte('content_date', end).range(from, to),
        { countHint: newKwCount ?? 0 }),
      fetchAllRows<{ keyword: string; type: string; volume: number; site_id: string; stat_date: string }>((from, to) =>
        service.from('rank_changes').select('keyword, type, volume, site_id, stat_date')
          .gte('stat_date', start).lte('stat_date', end).range(from, to),
        { countHint: rcCount ?? 0 }),
    ])

    // 新增关键词（应用/游戏）——同一个词可能在这个月被多个站点/多天抓到，去重只留一次
    const seenNew = new Map<string, string>()
    for (const r of newKwRows) {
      if (!seenNew.has(r.keyword)) seenNew.set(r.keyword, r.content_type)
    }
    const newKeywords = Array.from(seenNew.keys())
    const volMap = new Map<string, number>()
    for (let i = 0; i < newKeywords.length; i += 150) {
      const { data: kv } = await service.from('keyword_volume').select('keyword, volume').in('keyword', newKeywords.slice(i, i + 150))
      for (const k of (kv ?? []) as { keyword: string; volume: number }[]) volMap.set(k.keyword, k.volume)
    }
    const newItems = newKeywords.map(kw => ({ keyword: kw, contentType: seenNew.get(kw), volume: volMap.get(kw) ?? 0 }))
      .sort((a, b) => b.volume - a.volume)

    // 涨跌词——按 keyword+type 汇总（不分站点），带这个词这个月出现过的站点列表，
    // 方便点开"查看"知道是哪些站带来的
    const rcByKwType = new Map<string, { keyword: string; type: string; volume: number; domains: Set<string> }>()
    for (const r of rcRows) {
      if (r.type !== 'rankup' && r.type !== 'rankdown') continue
      const key = `${r.keyword}|${r.type}`
      let e = rcByKwType.get(key)
      if (!e) { e = { keyword: r.keyword, type: r.type, volume: 0, domains: new Set() }; rcByKwType.set(key, e) }
      e.volume = Math.max(e.volume, r.volume || 0)
      const d = domainOf.get(r.site_id)
      if (d) e.domains.add(d)
    }
    const rcList = Array.from(rcByKwType.values()).map(e => ({ keyword: e.keyword, type: e.type, volume: e.volume, domains: Array.from(e.domains) }))
    const rankup = rcList.filter(e => e.type === 'rankup').sort((a, b) => b.volume - a.volume).slice(0, 100)
    const rankdown = rcList.filter(e => e.type === 'rankdown').sort((a, b) => b.volume - a.volume).slice(0, 100)

    // 排名连续涨跌——同一个词在同一个站点，这个月里连续多天出现同方向的涨/跌信号
    // （逻辑跟 get_hot_streak_words 这个RPC一致，这里按月份范围重新算一遍，
    // 因为那个RPC只有下限没有上限，没法限定在某一个月内）
    const streakMap = new Map<string, { keyword: string; domain: string; type: string; volume: number; dates: Set<string> }>()
    for (const r of rcRows) {
      if (r.type !== 'rankup' && r.type !== 'rankdown') continue
      const domain = domainOf.get(r.site_id)
      if (!domain) continue
      const key = `${r.keyword}|${r.site_id}|${r.type}`
      let e = streakMap.get(key)
      if (!e) { e = { keyword: r.keyword, domain, type: r.type, volume: 0, dates: new Set() }; streakMap.set(key, e) }
      e.volume = Math.max(e.volume, r.volume || 0)
      e.dates.add(r.stat_date)
    }
    const continuousTrend = Array.from(streakMap.values())
      .filter(e => e.dates.size >= 2)
      .map(e => ({ keyword: e.keyword, domain: e.domain, type: e.type, volume: e.volume, streak: e.dates.size, dates: Array.from(e.dates).sort() }))
      .sort((a, b) => b.streak - a.streak || b.volume - a.volume)
      .slice(0, 100)

    return NextResponse.json({
      month: drillMonth,
      app: newItems.filter(i => i.contentType !== 'game').slice(0, 50),
      game: newItems.filter(i => i.contentType === 'game').slice(0, 50),
      rankup,
      rankdown,
      continuousTrend,
    })
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
