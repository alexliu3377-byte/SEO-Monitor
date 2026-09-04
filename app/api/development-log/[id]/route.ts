import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import {
  canManageDevelopmentLog,
  cleanStringList,
  cleanText,
  isDevelopmentRequestStatus,
  isReleaseStatus,
} from '@/lib/development-log'

async function requireOwner() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return { status: 401 as const, service: null, userId: null }
  const service = createServiceClient() as any
  const { data: profile } = await service
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (!canManageDevelopmentLog(user.id) || profile?.role !== 'super' || profile?.is_active === false) {
    return { status: 403 as const, service: null, userId: null }
  }
  return { status: 200 as const, service, userId: user.id }
}

function fail(status: number) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : '只有项目负责人可以修改开发日志' }, { status })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner()
  if (!auth.service) return fail(auth.status)
  const { id } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !id) return NextResponse.json({ error: '请求内容格式错误' }, { status: 400 })

  if (body.kind === 'request') {
    if (!isDevelopmentRequestStatus(body.status)) {
      return NextResponse.json({ error: '意见状态无效' }, { status: 400 })
    }
    const patch = {
      status: body.status,
      problem_details: cleanText(body.problemDetails, 4000) || null,
      owner_response: cleanText(body.ownerResponse, 4000) || null,
      completed_at: body.status === 'completed' ? new Date().toISOString() : null,
    }
    const { data, error } = await auth.service
      .from('development_requests')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: '意见更新失败' }, { status: 500 })
    return NextResponse.json({ request: data })
  }

  if (body.kind === 'release') {
    const rawVersion = cleanText(body.version, 30)
    const version = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`
    const title = cleanText(body.title, 120)
    const releaseDate = cleanText(body.releaseDate, 10)
    const summary = cleanText(body.summary, 2000)
    if (!/^v\d+\.\d+\.\d+$/.test(version) || !title || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || !summary || !isReleaseStatus(body.status)) {
      return NextResponse.json({ error: '版本资料不完整' }, { status: 400 })
    }
    const { data, error } = await auth.service
      .from('development_releases')
      .update({
        version,
        title,
        release_date: releaseDate,
        status: body.status,
        summary,
        highlights: cleanStringList(body.highlights),
        implementation_notes: cleanStringList(body.implementationNotes),
        limitations: cleanStringList(body.limitations),
        deployment_range: cleanText(body.deploymentRange, 100) || null,
        source_note: cleanText(body.sourceNote, 300) || null,
        created_by: auth.userId,
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error?.code === '23505') return NextResponse.json({ error: '这个版本号已经存在' }, { status: 409 })
    if (error) return NextResponse.json({ error: '版本更新失败' }, { status: 500 })
    return NextResponse.json({ release: data })
  }

  return NextResponse.json({ error: '不支持的记录类型' }, { status: 400 })
}
