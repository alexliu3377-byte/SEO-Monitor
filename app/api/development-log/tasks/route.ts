import { NextResponse } from 'next/server'
import { authorizeDevelopmentLog, developmentDatabaseError } from '@/lib/development-log-auth'
import { DEVELOPMENT_STAGES, parseDevelopmentTask, UUID_PATTERN } from '@/lib/development-progress'

export async function GET(req: Request) {
  const auth = await authorizeDevelopmentLog()
  if (auth.error) return auth.error
  const params = new URL(req.url).searchParams
  const page = Math.min(100000, Math.max(1, Number(params.get('page')) || 1)) | 0
  const stage = params.get('stage')
  const scope = params.get('scope') ?? 'active'
  const releaseId = params.get('releaseId')
  if (!['active', 'history'].includes(scope) || (stage && !DEVELOPMENT_STAGES.includes(stage as never))
    || (releaseId && !UUID_PATTERN.test(releaseId))) return NextResponse.json({ error: '筛选条件不正确' }, { status: 400 })
  let query = auth.service.from('development_tasks').select('*, release:development_releases(id,version,title)', { count: 'exact' })
  if (releaseId) query = query.eq('release_id', releaseId)
  else if (scope === 'active') query = query.is('release_id', null).neq('stage', 'cancelled')
  else query = query.or('release_id.not.is.null,stage.eq.cancelled')
  if (stage) query = query.eq('stage', stage)
  const [{ data, error, count }, counts] = await Promise.all([
    query.order('updated_at', { ascending: false }).order('id').range((page - 1) * 10, page * 10 - 1),
    auth.service.rpc('development_task_counts'),
  ])
  if (error || counts.error) return developmentDatabaseError(error || counts.error)
  return NextResponse.json({ tasks: data ?? [], total: count ?? 0, counts: counts.data ?? {}, canManage: auth.canManage })
}

export async function POST(req: Request) {
  const auth = await authorizeDevelopmentLog(true)
  if (auth.error) return auth.error
  const body = await req.json().catch(() => null)
  const parsed = parseDevelopmentTask(body)
  if (!parsed.data) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { data, error } = await auth.service.rpc('save_development_task', {
    p_id: null, p_revision: 0, p_actor: auth.user!.id, p_data: parsed.data, p_note: '建立开发事项',
  })
  if (error) return developmentDatabaseError(error)
  return NextResponse.json({ task: data }, { status: 201 })
}
