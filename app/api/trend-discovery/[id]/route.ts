import { NextResponse } from 'next/server'
import { isTrendReviewStatus } from '@/lib/trend-discovery'
import { getTrendCaller } from '@/lib/trend-discovery-server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: '趋势词编号无效' }, { status: 400 })

  const [{ data: term, error: termError }, { data: links, error: sourceError }] = await Promise.all([
    service.from('trend_terms').select('*').eq('id', id).maybeSingle(),
    service
      .from('trend_signal_terms')
      .select('observed_at, trend_signals!inner(id, platform, source_url, title, excerpt, tags, query_terms, published_at, first_collected_at, last_collected_at, latest_metrics)')
      .eq('term_id', id)
      .order('observed_at', { ascending: false })
      .limit(30),
  ])
  if (termError || sourceError) return NextResponse.json({ error: '趋势详情读取失败' }, { status: 500 })
  if (!term) return NextResponse.json({ error: '趋势词不存在' }, { status: 404 })
  return NextResponse.json({ term, sources: links ?? [], canManage: caller.isOwner })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.isOwner) return NextResponse.json({ error: '只有项目负责人可以处理候选词' }, { status: 403 })
  const { id } = await params
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: '趋势词编号无效' }, { status: 400 })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !isTrendReviewStatus(body.reviewStatus)) {
    return NextResponse.json({ error: '候选词处理状态无效' }, { status: 400 })
  }
  const { data, error } = await service
    .from('trend_terms')
    .update({
      review_status: body.reviewStatus,
      reviewed_by: body.reviewStatus === 'pending' ? null : caller.id,
      reviewed_at: body.reviewStatus === 'pending' ? null : new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, review_status')
    .maybeSingle()
  if (error) return NextResponse.json({ error: '候选词处理失败' }, { status: 500 })
  if (!data) return NextResponse.json({ error: '趋势词不存在' }, { status: 404 })
  return NextResponse.json({ term: data })
}
