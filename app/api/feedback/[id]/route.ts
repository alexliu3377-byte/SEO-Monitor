import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { canManageDevelopmentLog, cleanText, isDevelopmentRequestStatus } from '@/lib/development-log'

async function getProjectOwner() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  const service = createServiceClient() as any
  if (!user) return { error: NextResponse.json({ error: '请先登录' }, { status: 401 }), service }
  if (!canManageDevelopmentLog(user.id)) {
    return { error: NextResponse.json({ error: '只有项目负责人可以管理反馈' }, { status: 403 }), service }
  }

  const { data: profile } = await service
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'super' || profile?.is_active === false) {
    return { error: NextResponse.json({ error: '当前账号没有管理反馈的权限' }, { status: 403 }), service }
  }
  return { error: null, service }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error: authError, service } = await getProjectOwner()
  if (authError) return authError

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !isDevelopmentRequestStatus(body.status)) {
    return NextResponse.json({ error: '反馈状态无效' }, { status: 400 })
  }
  const { id } = await params
  const { data, error } = await service
    .from('development_requests')
    .update({
      status: body.status,
      problem_details: cleanText(body.problemDetails, 4000) || null,
      owner_response: cleanText(body.ownerResponse, 4000) || null,
      completed_at: body.status === 'completed' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: '反馈处理状态更新失败' }, { status: 500 })
  if (!data) return NextResponse.json({ error: '反馈不存在或已经被删除' }, { status: 404 })
  return NextResponse.json({ request: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error: authError, service } = await getProjectOwner()
  if (authError) return authError

  const { id } = await params
  const { data, error } = await service
    .from('development_requests')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: '反馈删除失败，请稍后重试' }, { status: 500 })
  if (!data) return NextResponse.json({ error: '反馈不存在或已经被删除' }, { status: 404 })
  return NextResponse.json({ deleted: true, id: data.id })
}
