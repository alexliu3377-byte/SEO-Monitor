import { NextResponse } from 'next/server'
import { authorizeDevelopmentLog, developmentDatabaseError } from '@/lib/development-log-auth'
import { parseDevelopmentTask, UUID_PATTERN } from '@/lib/development-progress'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeDevelopmentLog()
  if (auth.error) return auth.error
  const { id } = await params
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: '事项编号不正确' }, { status: 400 })
  const page = Math.min(100000, Math.max(1, Number(new URL(req.url).searchParams.get('page')) || 1)) | 0
  const [{ data: task, error }, events] = await Promise.all([
    auth.service.from('development_tasks').select('*, release:development_releases(id,version,title)').eq('id', id).maybeSingle(),
    auth.service.from('development_task_events').select('id,actor_name,note,snapshot,created_at', { count: 'exact' })
      .eq('task_id', id).order('id', { ascending: false }).range((page - 1) * 10, page * 10 - 1),
  ])
  if (error || events.error) return developmentDatabaseError(error || events.error)
  if (!task) return NextResponse.json({ error: '事项不存在' }, { status: 404 })
  return NextResponse.json({ task, events: events.data ?? [], total: events.count ?? 0, canManage: auth.canManage })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeDevelopmentLog(true)
  if (auth.error) return auth.error
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!UUID_PATTERN.test(id) || !body || !Number.isInteger(body.revision) || body.revision < 1
    || typeof body.note !== 'string' || !body.note.trim() || body.note.length > 2000) {
    return NextResponse.json({ error: '请填写本次进展说明，或重新打开事项取得最新版本' }, { status: 400 })
  }
  const archive = body.action === 'archive'
  if (body.action && !archive) return NextResponse.json({ error: '不支持的操作' }, { status: 400 })
  if (archive && !UUID_PATTERN.test(body.releaseId ?? '')) return NextResponse.json({ error: '请选择已发布版本' }, { status: 400 })
  const parsed = archive ? { data: null } : parseDevelopmentTask(body)
  if (!archive && !parsed.data) return NextResponse.json({ error: 'error' in parsed ? parsed.error : '资料不完整' }, { status: 400 })
  const { data, error } = await auth.service.rpc('save_development_task', {
    p_id: id, p_revision: body.revision, p_actor: auth.user!.id, p_data: parsed.data,
    p_note: body.note.trim(), p_release: archive ? body.releaseId : null,
  })
  if (error) return developmentDatabaseError(error)
  return NextResponse.json({ task: data })
}
