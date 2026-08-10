import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeOutcomeScore } from '@/lib/outcome-score'
import { fetchAllRows } from '@/lib/supabase-paginate'

interface TrackingRow {
  keyword: string
  content_date: string | null
  discovery_date: string
  content_type: string | null
  operation_type: string | null
  search_volume: number
  rank_position: number | null
  rank_volume: number
  effectiveness: string
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: siteId } = await params
  const { searchParams } = new URL(req.url)
  const keyword = (searchParams.get('keyword') || '').toLowerCase()
  const contentType = searchParams.get('contentType') || ''
  const effectiveness = searchParams.get('effectiveness') || ''
  const dateStart = searchParams.get('dateStart') || ''
  const dateEnd = searchParams.get('dateEnd') || ''

  // competitor_tracking_records 按 site_id+keyword+discovery_date 唯一，每天
  // 追踪窗口内都会 upsert 一行——这张表的结构跟 site_tracking_records 一样是
  // "一天一行"，不是"一个词一行"，所以这里必须去重，否则同一个词会按追踪
  // 过几天就重复显示几次（2026-08-10 用户反馈发现，这里之前一直漏了这一步，
  // 分组报告的成效追踪 outcomes 路由早就有对应的去重逻辑，这里补齐）。
  //
  // content_type/effectiveness 不能在去重前过滤——见 project_dedup_before_
  // filter_bug 教训：这两个是"按天变化"的字段（同一个词不同天的 effectiveness
  // 可能不一样），先按它们过滤会导致去重挑中的不是"这个词最新状态"那一行，
  // 而是"最新一条恰好匹配筛选条件"的那一行，可能是很久以前的旧状态。
  // dateStart/dateEnd 不受这个问题影响（框定的是"看这个时间窗口内的追踪
  // 状态"，语义上就该在去重前生效），继续放在DB查询里。
  const rows = await fetchAllRows<TrackingRow>((from, to) => {
    let q = service.from('competitor_tracking_records')
      .select('keyword, content_date, discovery_date, content_type, operation_type, search_volume, rank_position, rank_volume, effectiveness')
      .eq('site_id', siteId)
      .order('discovery_date', { ascending: false }).order('id', { ascending: true })
      .range(from, to)
    if (dateStart) q = q.gte('discovery_date', dateStart)
    if (dateEnd) q = q.lte('discovery_date', dateEnd)
    return q
  })

  // rows 已经按 discovery_date 降序排好，每个词第一次出现的就是最新状态。
  const seen = new Set<string>()
  const dedupedRows = rows.filter(r => {
    if (seen.has(r.keyword)) return false
    seen.add(r.keyword)
    return true
  })

  let filtered = dedupedRows
  if (contentType) filtered = filtered.filter(r => r.content_type === contentType)
  if (effectiveness) filtered = filtered.filter(r => r.effectiveness === effectiveness)
  if (keyword) filtered = filtered.filter(r => r.keyword.toLowerCase().includes(keyword))

  const result = filtered.map(r => ({
    operation_type: r.operation_type,
    keyword: r.keyword,
    search_volume: r.search_volume,
    content_type: r.content_type,
    rank_position: r.rank_position,
    rank_volume: r.rank_volume,
    effectiveness: r.effectiveness,
    score: r.rank_position != null ? computeOutcomeScore(r.rank_position, true, null, r.rank_volume) : null,
    content_date: r.content_date,
    discovery_date: r.discovery_date,
  }))

  return NextResponse.json({ rows: result })
}
