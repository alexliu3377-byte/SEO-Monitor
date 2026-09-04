import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { canManageDevelopmentLog, cleanText, isDevelopmentRequestStatus } from '@/lib/development-log'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageDevelopmentLog(user.id)) {
    return NextResponse.json({ error: '只有项目负责人可以更新反馈处理状态' }, { status: 403 })
  }

  const service = createServiceClient() as any
  const { data: profile } = await service
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'super' || profile?.is_active === false) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
    .single()
  if (error) return NextResponse.json({ error: '反馈状态更新失败' }, { status: 500 })
  return NextResponse.json({ request: data })
}
