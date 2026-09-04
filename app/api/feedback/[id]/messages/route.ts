import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { cleanText } from '@/lib/development-log'
import { isFeedbackMessageType } from '@/lib/feedback-access'

async function requireSuper() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  const service = createServiceClient() as any
  if (!user) return { caller: null, service }
  const { data: profile } = await service
    .from('user_profiles')
    .select('role, username, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'super' || profile?.is_active === false) return { caller: null, service }
  return {
    caller: { id: user.id, name: profile.username || user.email?.split('@')[0] || '超管' },
    service,
  }
}

async function isSuperPriorityRequest(service: any, requestId: string) {
  const { data } = await service
    .from('development_requests')
    .select('id')
    .eq('id', requestId)
    .eq('submitter_role', 'super')
    .maybeSingle()
  return Boolean(data)
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, service } = await requireSuper()
  if (!caller) return NextResponse.json({ error: '只有超管可以查看重点沟通' }, { status: 403 })
  const { id } = await params
  if (!await isSuperPriorityRequest(service, id)) {
    return NextResponse.json({ error: '这条反馈不是超管重点，或记录不存在' }, { status: 404 })
  }

  const searchParams = new URL(req.url).searchParams
  const page = positiveInteger(searchParams.get('page'), 1, 100_000)
  const pageSize = positiveInteger(searchParams.get('pageSize'), 20, 50)
  const from = (page - 1) * pageSize
  const { data, error, count } = await service
    .from('development_request_messages')
    .select('*', { count: 'exact' })
    .eq('request_id', id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1)
  if (error) {
    const missingMigration = error.code === '42P01'
    return NextResponse.json({ error: missingMigration ? '超管沟通数据库迁移尚未运行' : '沟通记录读取失败' }, { status: missingMigration ? 503 : 500 })
  }
  return NextResponse.json({
    messages: [...(data ?? [])].reverse(),
    total: count ?? 0,
    page,
    pageSize,
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, service } = await requireSuper()
  if (!caller) return NextResponse.json({ error: '只有超管可以参与重点沟通' }, { status: 403 })
  const { id } = await params
  if (!await isSuperPriorityRequest(service, id)) {
    return NextResponse.json({ error: '这条反馈不是超管重点，或记录不存在' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const messageType = body?.messageType
  const content = cleanText(body?.content, 10000)
  if (!isFeedbackMessageType(messageType)) {
    return NextResponse.json({ error: '请选择沟通记录类型' }, { status: 400 })
  }
  if (content.length < 2) return NextResponse.json({ error: '请输入沟通内容' }, { status: 400 })

  const { data, error } = await service
    .from('development_request_messages')
    .insert({
      request_id: id,
      author_id: caller.id,
      author_name: caller.name,
      author_role: 'super',
      message_type: messageType,
      content,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: '沟通内容发送失败' }, { status: 500 })
  return NextResponse.json({ message: data }, { status: 201 })
}
