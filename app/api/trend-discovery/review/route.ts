import { NextResponse } from 'next/server'
import { isTrendReviewStatus } from '@/lib/trend-discovery'
import { getTrendCaller } from '@/lib/trend-discovery-server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function PATCH(request: Request) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.isOwner) return NextResponse.json({ error: '只有项目负责人可以处理候选词' }, { status: 403 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const ids = [...new Set(Array.isArray(body?.ids) ? body.ids.filter((value): value is string => typeof value === 'string') : [])]
  if (ids.length < 1 || ids.length > 100 || ids.some(id => !UUID_PATTERN.test(id)) || !isTrendReviewStatus(body?.reviewStatus)) {
    return NextResponse.json({ error: '批量处理请求无效' }, { status: 400 })
  }

  const reviewStatus = body.reviewStatus
  const { data, error } = await service
    .from('trend_terms')
    .update({
      review_status: reviewStatus,
      reviewed_by: reviewStatus === 'pending' ? null : caller.id,
      reviewed_at: reviewStatus === 'pending' ? null : new Date().toISOString(),
    })
    .in('id', ids)
    .select('id')

  if (error) return NextResponse.json({ error: '候选词批量处理失败' }, { status: 500 })
  return NextResponse.json({ ok: true, updated: data?.length ?? 0 })
}
