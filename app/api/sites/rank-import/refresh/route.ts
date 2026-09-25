import { NextResponse } from 'next/server'
import { dispatchGitHubWorkflow } from '@/lib/github-actions'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 15

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function malaysiaToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const siteId = typeof body?.siteId === 'string' ? body.siteId : ''
    const statDate = typeof body?.statDate === 'string' ? body.statDate : ''
    if (!UUID_RE.test(siteId) || !DATE_RE.test(statDate)) {
      return NextResponse.json({ error: '站点或日期无效' }, { status: 400 })
    }
    const { data: site, error: siteError } = await service.from('sites').select('domain').eq('id', siteId).single()
    if (siteError || !site) return NextResponse.json({ error: '站点不存在' }, { status: 404 })

    const refreshTracking = statDate === malaysiaToday()
    const dispatch = await dispatchGitHubWorkflow('rank-import-effectiveness.yml', {
      site: site.domain,
      stat_date: statDate,
      refresh_tracking: String(refreshTracking),
    })
    if (!dispatch.ok) return NextResponse.json({ error: dispatch.error }, { status: dispatch.status })

    return NextResponse.json({
      success: true,
      queued: true,
      refreshTracking,
      message: refreshTracking
        ? '已提交 GitHub Actions：先更新当天竞品/组员成效，再重建成效缓存'
        : '已提交 GitHub Actions：历史日期不生成今天的竞品快照，只重建成效缓存',
    }, { status: 202 })
  } catch (error) {
    console.error('Imported rank effectiveness refresh failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '刷新失败' }, { status: 500 })
  }
}
