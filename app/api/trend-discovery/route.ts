import { NextResponse } from 'next/server'
import { cleanTrendText, isTrendPlatform, isTrendReviewStatus, isTrendStage } from '@/lib/trend-discovery'
import { getTrendCaller } from '@/lib/trend-discovery-server'

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback
}

export async function GET(request: Request) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const stage = params.get('stage') ?? ''
  const platform = params.get('platform') ?? ''
  const review = params.get('review') ?? ''
  const search = cleanTrendText(params.get('q'), 50).replace(/[%_,]/g, '')
  const page = positiveInteger(params.get('page'), 1, 100_000)
  const pageSize = positiveInteger(params.get('pageSize'), 20, 50)
  if (stage && !isTrendStage(stage)) return NextResponse.json({ error: '趋势阶段筛选无效' }, { status: 400 })
  if (platform && !isTrendPlatform(platform)) return NextResponse.json({ error: '趋势平台筛选无效' }, { status: 400 })
  if (review && !isTrendReviewStatus(review)) return NextResponse.json({ error: '审核状态筛选无效' }, { status: 400 })

  let query = service
    .from('trend_terms')
    .select('id, display_term, trend_stage, review_status, first_seen_at, last_seen_at, platforms, signal_count, recent_signal_count, previous_signal_count, growth_percent, trend_score, confidence_score, explanation, suggested_keywords', { count: 'exact' })
  if (review) query = query.eq('review_status', review)
  else query = query.neq('review_status', 'dismissed')
  if (stage) query = query.eq('trend_stage', stage)
  if (platform) query = query.contains('platforms', [platform])
  if (search) query = query.ilike('display_term', `%${search}%`)
  const from = (page - 1) * pageSize
  const { data, count, error } = await query
    .order('trend_score', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) {
    const missingMigration = error.code === '42P01'
    return NextResponse.json({ error: missingMigration ? '趋势发现数据库迁移尚未运行' : '趋势词读取失败' }, { status: missingMigration ? 503 : 500 })
  }

  const summaryQueries = ['new', 'warming', 'hot', 'persistent'].map(value => service
    .from('trend_terms')
    .select('id', { count: 'exact', head: true })
    .eq('trend_stage', value)
    .neq('review_status', 'dismissed'))
  const trackedQuery = service.from('trend_terms').select('id', { count: 'exact', head: true }).eq('review_status', 'tracked')
  const summaryResults = await Promise.all([...summaryQueries, trackedQuery])
  const summary = {
    new: summaryResults[0].count ?? 0,
    warming: summaryResults[1].count ?? 0,
    hot: summaryResults[2].count ?? 0,
    persistent: summaryResults[3].count ?? 0,
    tracked: summaryResults[4].count ?? 0,
  }

  let nodes: unknown[] = []
  if (caller.role === 'super') {
    const { data: nodeRows } = await service
      .from('trend_collector_nodes')
      .select('id, name, collector_version, platforms, status, last_seen_at, last_success_at, last_error')
      .order('name')
    nodes = nodeRows ?? []
  }

  return NextResponse.json({
    terms: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    summary,
    nodes,
    viewerRole: caller.role,
    canManage: caller.isOwner,
  })
}
