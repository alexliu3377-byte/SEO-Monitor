import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { cleanText, canManageDevelopmentLog } from '@/lib/development-log'
import {
  ACTIVE_FEEDBACK_STATUSES,
  feedbackScopeFor,
  feedbackSubmissionLimits,
  isFeedbackPage,
  isFeedbackRole,
  isFeedbackType,
  type FeedbackRole,
} from '@/lib/feedback-access'

type Caller = { id: string; email: string; username: string | null; role: FeedbackRole }

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
  if (!profile || profile.is_active === false || !isFeedbackRole(profile.role)) {
    return { caller: null, service }
  }
  return {
    caller: { id: user.id, email: user.email ?? '', username: profile.username ?? null, role: profile.role },
    service,
  }
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback
}

function malaysiaDayStartIso() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return new Date(`${date}T00:00:00+08:00`).toISOString()
}

export async function GET(req: Request) {
  const { caller, service } = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const scope = feedbackScopeFor(caller.role, params.get('scope'))
  const page = positiveInteger(params.get('page'), 1, 100_000)
  const pageSize = positiveInteger(params.get('pageSize'), 10, 50)
  const from = (page - 1) * pageSize

  let query = service
    .from('development_requests')
    .select('*', { count: 'exact' })

  if (scope === 'mine') query = query.eq('created_by', caller.id)
  else if (scope === 'super') query = query.eq('submitter_role', 'super')
  else query = query.in('submitter_role', ['normal', 'admin'])

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) {
    const missingMigration = error.code === '42703'
    return NextResponse.json({
      error: missingMigration ? '反馈角色数据库迁移尚未运行' : '反馈读取失败，请稍后重试',
    }, { status: missingMigration ? 503 : 500 })
  }

  return NextResponse.json({
    requests: data ?? [], total: count ?? 0, page, pageSize, scope,
    viewerRole: caller.role,
    canManage: canManageDevelopmentLog(caller.id),
    limits: feedbackSubmissionLimits(caller.role),
  })
}

export async function POST(req: Request) {
  const { caller, service } = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const title = cleanText(body?.title, 120)
  const details = cleanText(body?.details, 4000)
  const feedbackType = body?.feedbackType
  const relatedPage = body?.relatedPage
  if (title.length < 4) return NextResponse.json({ error: '标题至少需要 4 个字' }, { status: 400 })
  if (details.length < 20) return NextResponse.json({ error: '请至少用 20 个字说明使用场景、问题和希望结果' }, { status: 400 })
  if (!isFeedbackType(feedbackType)) return NextResponse.json({ error: '请选择反馈类型' }, { status: 400 })
  if (relatedPage !== '' && relatedPage !== null && relatedPage !== undefined && !isFeedbackPage(relatedPage)) {
    return NextResponse.json({ error: '相关页面选项无效' }, { status: 400 })
  }

  const { data: duplicate } = await service
    .from('development_requests')
    .select('id')
    .eq('created_by', caller.id)
    .eq('title', title)
    .in('status', [...ACTIVE_FEEDBACK_STATUSES])
    .limit(1)
    .maybeSingle()
  if (duplicate) return NextResponse.json({ error: '你已有相同标题的未完成反馈，请等待处理或补充原反馈' }, { status: 409 })

  const limits = feedbackSubmissionLimits(caller.role)
  if (limits.daily !== null || limits.open !== null) {
    const [dailyResult, openResult] = await Promise.all([
      limits.daily === null ? Promise.resolve({ count: 0, error: null }) : service
        .from('development_requests')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', caller.id)
        .gte('created_at', malaysiaDayStartIso()),
      limits.open === null ? Promise.resolve({ count: 0, error: null }) : service
        .from('development_requests')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', caller.id)
        .in('status', [...ACTIVE_FEEDBACK_STATUSES]),
    ])
    if (dailyResult.error || openResult.error) {
      return NextResponse.json({ error: '反馈额度检查失败，请稍后重试' }, { status: 500 })
    }
    if (limits.daily !== null && (dailyResult.count ?? 0) >= limits.daily) {
      return NextResponse.json({ error: `你今天已经提交 ${limits.daily} 条反馈，请明天再提交` }, { status: 429 })
    }
    if (limits.open !== null && (openResult.count ?? 0) >= limits.open) {
      return NextResponse.json({ error: `你已有 ${limits.open} 条未完成反馈，请等待处理后再提交` }, { status: 429 })
    }
  }

  const { data, error } = await service
    .from('development_requests')
    .insert({
      title,
      details,
      status: 'pending',
      created_by: caller.id,
      created_by_name: caller.username || caller.email.split('@')[0] || '用户',
      submitter_role: caller.role,
      feedback_type: feedbackType,
      related_page: isFeedbackPage(relatedPage) ? relatedPage : null,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: '反馈提交失败，请稍后重试' }, { status: 500 })
  return NextResponse.json({ request: data }, { status: 201 })
}
