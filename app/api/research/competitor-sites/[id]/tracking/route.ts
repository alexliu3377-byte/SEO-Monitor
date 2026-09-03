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
  const authClient = await createClient()
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
  const dateStart = searchParams.get('dateStart') || ''
  const dateEnd = searchParams.get('dateEnd') || ''

  // competitor_tracking_records 按 site_id+keyword+discovery_date 唯一，每天
  // 追踪窗口内都会 upsert 一行——这张表的结构跟 site_tracking_records 一样是
  // "一天一行"，永久保留、只增不删，长期会一直累积（2026-08-10 用户主动
  // 提醒，担心跟这个项目之前已经踩过的几次"表越长越大最后拖垮查询"是同一类
  // 问题——rank_changes缺索引、raw_keywords超3000行硬顶静默截断都是真实
  // 教训）。用户明确要求：'追踪中'（还没确认有没有效果）和'无效'（追踪满
  // 60天仍未见效）这两种状态对这个页面完全没有参考价值，直接在数据库查询
  // 这一步就用 effectiveness='有效' 过滤掉，不只是前端默认隐藏——这样才能
  // 真正减少要拉取和去重的行数，而不是拉全量再筛。
  //
  // 这个过滤放在去重前不会踩 project_dedup_before_filter_bug 那个坑：那次
  // 教训是"先筛会导致去重挑到过时的旧状态、误当成当前状态"；这里语义已经
  // 变成"只看这个词有没有拿到过有效"，挑出的是"最近一次真正有效的记录"，
  // 是有意为之的查询目标，不是误把陈旧数据当成当前状态。
  const rows = await fetchAllRows<TrackingRow>((from, to) => {
    let q = service.from('competitor_tracking_records')
      .select('keyword, content_date, discovery_date, content_type, operation_type, search_volume, rank_position, rank_volume, effectiveness')
      .eq('site_id', siteId)
      .eq('effectiveness', '有效')
      .order('discovery_date', { ascending: false }).order('id', { ascending: true })
      .range(from, to)
    if (dateStart) q = q.gte('discovery_date', dateStart)
    if (dateEnd) q = q.lte('discovery_date', dateEnd)
    return q
  })

  // rows 已经按 discovery_date 降序排好，每个词第一次出现的就是最近一次有效的记录。
  const seen = new Set<string>()
  const dedupedRows = rows.filter(r => {
    if (seen.has(r.keyword)) return false
    seen.add(r.keyword)
    return true
  })

  let filtered = dedupedRows
  if (contentType) filtered = filtered.filter(r => r.content_type === contentType)
  if (keyword) filtered = filtered.filter(r => r.keyword.toLowerCase().includes(keyword))

  const result = filtered.map(r => ({
    operation_type: r.operation_type,
    keyword: r.keyword,
    search_volume: r.search_volume,
    content_type: r.content_type,
    rank_position: r.rank_position,
    rank_volume: r.rank_volume,
    score: r.rank_position != null ? computeOutcomeScore(r.rank_position, true, null, r.rank_volume) : null,
    content_date: r.content_date,
    discovery_date: r.discovery_date,
  }))

  return NextResponse.json({ rows: result })
}
