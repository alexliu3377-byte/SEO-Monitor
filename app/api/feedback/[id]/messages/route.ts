import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { canManageDevelopmentLog, cleanText } from '@/lib/development-log'
import {
  canReadFeedbackConversation,
  canReplyFeedbackConversation,
  isFeedbackMessageType,
  isFeedbackRole,
  type FeedbackRole,
} from '@/lib/feedback-access'

type Caller = { id: string; name: string; role: FeedbackRole }
type FeedbackRequest = { id: string; created_by: string | null; submitter_role: FeedbackRole }

async function getCaller(): Promise<{ caller: Caller | null; service: any }> {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  const service = createServiceClient() as any
  if (!user) return { caller: null, service }
  const { data: profile } = await service
    .from('user_profiles')
    .select('role, username, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || profile.is_active === false || !isFeedbackRole(profile.role)) return { caller: null, service }
  return {
    caller: {
      id: user.id,
      name: profile.username || user.email?.split('@')[0] || '用户',
      role: profile.role,
    },
    service,
  }
}

async function getFeedbackRequest(service: any, requestId: string): Promise<FeedbackRequest | null> {
  const { data } = await service
    .from('development_requests')
    .select('id, created_by, submitter_role')
    .eq('id', requestId)
    .maybeSingle()
  return data && isFeedbackRole(data.submitter_role) ? data as FeedbackRequest : null
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, service } = await getCaller()
  if (!caller) return NextResponse.json({ error: '请先登录后查看留言' }, { status: 401 })
  const { id } = await params
  const feedback = await getFeedbackRequest(service, id)
  if (!feedback || !canReadFeedbackConversation(caller.role, feedback.submitter_role)) {
    return NextResponse.json({ error: '这条反馈不存在或你没有查看权限' }, { status: 404 })
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
    const missingMigration = error.code === '42P01' || error.code === '42703'
    return NextResponse.json({ error: missingMigration ? '反馈留言板数据库迁移尚未运行' : '留言读取失败' }, { status: missingMigration ? 503 : 500 })
  }
  if (page === 1 && data?.length) {
    const latestMessageAt = data[0].created_at
    await service
      .from('development_request_message_reads')
      .upsert({ request_id: id, user_id: caller.id, last_read_at: latestMessageAt }, { onConflict: 'request_id,user_id' })
  }
  return NextResponse.json({
    messages: [...(data ?? [])].reverse(),
    total: count ?? 0,
    page,
    pageSize,
    canReply: canReplyFeedbackConversation(
      caller.id,
      caller.role,
      feedback.created_by,
      feedback.submitter_role,
      canManageDevelopmentLog(caller.id)
    ),
    priority: feedback.submitter_role === 'super',
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, service } = await getCaller()
  if (!caller) return NextResponse.json({ error: '请先登录后留言' }, { status: 401 })
  const { id } = await params
  const feedback = await getFeedbackRequest(service, id)
  if (!feedback || !canReadFeedbackConversation(caller.role, feedback.submitter_role)) {
    return NextResponse.json({ error: '这条反馈不存在或你没有查看权限' }, { status: 404 })
  }
  const canReply = canReplyFeedbackConversation(
    caller.id,
    caller.role,
    feedback.created_by,
    feedback.submitter_role,
    canManageDevelopmentLog(caller.id)
  )
  if (!canReply) return NextResponse.json({ error: '只有反馈人和项目负责人可以回复' }, { status: 403 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const requestedType = body?.messageType
  const messageType = feedback.submitter_role === 'super' && isFeedbackMessageType(requestedType)
    ? requestedType
    : 'discussion'
  const content = cleanText(body?.content, 10000)
  if (content.length < 2) return NextResponse.json({ error: '请输入留言内容' }, { status: 400 })

  const { data, error } = await service
    .from('development_request_messages')
    .insert({
      request_id: id,
      author_id: caller.id,
      author_name: caller.name,
      author_role: caller.role,
      message_type: messageType,
      content,
    })
    .select('*')
    .single()
  if (error) {
    const missingMigration = error.code === '23514'
    return NextResponse.json({ error: missingMigration ? '反馈留言板数据库迁移尚未运行' : '留言发送失败' }, { status: missingMigration ? 503 : 500 })
  }
  return NextResponse.json({ message: data }, { status: 201 })
}
