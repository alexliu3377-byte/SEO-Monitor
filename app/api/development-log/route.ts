import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import {
  canManageDevelopmentLog,
  canReadDevelopmentLog,
  canSubmitDevelopmentRequest,
  cleanStringList,
  cleanText,
  isReleaseStatus,
} from '@/lib/development-log'

type Caller = {
  id: string
  email: string
  role: string
  username: string | null
}

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

  if (!profile || profile.is_active === false) return { caller: null, service }
  return {
    caller: {
      id: user.id,
      email: user.email ?? '',
      role: profile.role ?? 'normal',
      username: profile.username ?? null,
    },
    service,
  }
}

function databaseError(error: { code?: string } | null) {
  const migrationMissing = error?.code === '42P01'
  return NextResponse.json({
    error: migrationMissing
      ? '开发日志数据库尚未初始化，请先运行 20260904_development_log.sql'
      : '开发日志读取失败，请稍后重试',
  }, { status: migrationMissing ? 503 : 500 })
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}

export async function GET(req: Request) {
  const { caller, service } = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canReadDevelopmentLog(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const searchParams = new URL(req.url).searchParams
  const kind = searchParams.get('kind') === 'requests' ? 'requests' : 'releases'
  const page = positiveInteger(searchParams.get('page'), 1, 100_000)
  const pageSize = positiveInteger(searchParams.get('pageSize'), 10, 50)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const permissions = {
    canSubmitRequest: canSubmitDevelopmentRequest(caller.role),
    canManage: canManageDevelopmentLog(caller.id),
  }

  if (kind === 'releases') {
    const { data, error, count } = await service
      .from('development_releases')
      .select('*', { count: 'exact' })
      .order('release_date', { ascending: false })
      .order('version', { ascending: false })
      .range(from, to)
    if (error) return databaseError(error)
    return NextResponse.json({ releases: data ?? [], total: count ?? 0, page, pageSize, permissions })
  }

  const { data, error, count } = await service
    .from('development_requests')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) return databaseError(error)
  return NextResponse.json({ requests: data ?? [], total: count ?? 0, page, pageSize, permissions })
}

export async function POST(req: Request) {
  const { caller, service } = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canReadDevelopmentLog(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: '请求内容格式错误' }, { status: 400 })

  if (body.kind === 'request') {
    if (!canSubmitDevelopmentRequest(caller.role)) {
      return NextResponse.json({ error: '只有超管可以提交功能意见' }, { status: 403 })
    }
    const title = cleanText(body.title, 120)
    const details = cleanText(body.details, 4000)
    if (!title || !details) {
      return NextResponse.json({ error: '请填写意见标题和具体需求' }, { status: 400 })
    }
    const createdByName = caller.username || caller.email.split('@')[0] || '超管'
    const { data, error } = await service
      .from('development_requests')
      .insert({
        title,
        details,
        status: 'pending',
        created_by: caller.id,
        created_by_name: createdByName,
      })
      .select('*')
      .single()
    if (error) return databaseError(error)
    return NextResponse.json({ request: data }, { status: 201 })
  }

  if (body.kind === 'release') {
    if (!canManageDevelopmentLog(caller.id)) {
      return NextResponse.json({ error: '只有项目负责人可以新增版本' }, { status: 403 })
    }
    const rawVersion = cleanText(body.version, 30)
    const version = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`
    const title = cleanText(body.title, 120)
    const releaseDate = cleanText(body.releaseDate, 10)
    const summary = cleanText(body.summary, 2000)
    const status = body.status
    if (!/^v\d+\.\d+\.\d+$/.test(version) || !title || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || !summary || !isReleaseStatus(status)) {
      return NextResponse.json({ error: '请完整填写版本号、标题、日期、状态和版本说明' }, { status: 400 })
    }
    const { data, error } = await service
      .from('development_releases')
      .insert({
        version,
        title,
        release_date: releaseDate,
        status,
        summary,
        highlights: cleanStringList(body.highlights),
        implementation_notes: cleanStringList(body.implementationNotes),
        limitations: cleanStringList(body.limitations),
        deployment_range: cleanText(body.deploymentRange, 100) || null,
        source_note: cleanText(body.sourceNote, 300) || null,
        created_by: caller.id,
      })
      .select('*')
      .single()
    if (error?.code === '23505') {
      return NextResponse.json({ error: '这个版本号已经存在' }, { status: 409 })
    }
    if (error) return databaseError(error)
    return NextResponse.json({ release: data }, { status: 201 })
  }

  return NextResponse.json({ error: '不支持的记录类型' }, { status: 400 })
}
