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

    const { count } = await service.from('raw_keywords').select('id', { count: 'exact', head: true })
      .gte('content_date', start).lte('content_date', end)
    const { data: rows } = await service.from('raw_keywords').select('keyword, content_type')
      .gte('content_date', start).lte('content_date', end).limit(Math.max(count ?? 0, 1))

    // 同一个词可能在这个月被多个站点/多天抓到，去重只留一次，内容类型取第一次出现的
    const seen = new Map<string, string>()
    for (const r of (rows ?? []) as { keyword: string; content_type: string }[]) {
      if (!seen.has(r.keyword)) seen.set(r.keyword, r.content_type)
    }
    const keywords = Array.from(seen.keys())
    const volMap = new Map<string, number>()
    for (let i = 0; i < keywords.length; i += 150) {
      const { data: kv } = await service.from('keyword_volume').select('keyword, volume').in('keyword', keywords.slice(i, i + 150))
      for (const k of (kv ?? []) as { keyword: string; volume: number }[]) volMap.set(k.keyword, k.volume)
    }

    const items = keywords.map(kw => ({ keyword: kw, contentType: seen.get(kw), volume: volMap.get(kw) ?? 0 }))
      .sort((a, b) => b.volume - a.volume)

    return NextResponse.json({
      month: drillMonth,
      app: items.filter(i => i.contentType !== 'game').slice(0, 50),
      game: items.filter(i => i.contentType === 'game').slice(0, 50),
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
