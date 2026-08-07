import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

async function requireAdmin() {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { service }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx
  const { id } = await params

  const { data: report, error } = await service.from('multi_site_research_reports').select('*').eq('id', id).single()
  if (error || !report) return NextResponse.json({ error: error?.message || '报告不存在' }, { status: 404 })

  const { data: sitesRaw } = await service.from('sites').select('id, domain, name, has_rank_data, has_rank_title').in('id', report.site_ids)

  return NextResponse.json({ report, sites: sitesRaw ?? [] })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx
  const { id } = await params

  const body = await req.json() as { action: 'complete' }
  if (body.action === 'complete') {
    const { error } = await service.from('multi_site_research_reports')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
