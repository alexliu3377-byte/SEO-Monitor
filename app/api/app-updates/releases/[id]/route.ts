import { NextResponse } from 'next/server'
import { appUpdateDatabaseError, requireAppUpdateSuper } from '@/lib/app-update-server'
import { isAppUpdateReviewStatus } from '@/lib/app-updates'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response
  const { id } = await context.params
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: '更新记录编号无效' }, { status: 400 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const reviewStatus = body?.reviewStatus
  if (!isAppUpdateReviewStatus(reviewStatus) || reviewStatus === 'pending') {
    return NextResponse.json({ error: '审核状态无效' }, { status: 400 })
  }
  const { error } = await access.service.rpc('review_app_update_release', {
    p_release_id: id,
    p_review_status: reviewStatus,
    p_reviewer: access.userId,
  })
  if (error?.code === 'P0002') return NextResponse.json({ error: '更新记录不存在' }, { status: 404 })
  if (error) return appUpdateDatabaseError(error, '更新记录审核失败')
  return NextResponse.json({ ok: true })
}
