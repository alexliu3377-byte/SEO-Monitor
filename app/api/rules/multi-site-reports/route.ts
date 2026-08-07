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
  return { user, service }
}

export async function GET() {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { data: reports, error } = await service
    .from('multi_site_research_reports')
    .select('id, site_ids, date_start, date_end, status, created_at, completed_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: sitesRaw } = await service.from('sites').select('id, domain')
  const domainOf = new Map<string, string>((sitesRaw ?? []).map((s: { id: string; domain: string }) => [s.id, s.domain]))

  const withDomains = (reports ?? []).map((r: { site_ids: string[] }) => ({
    ...r,
    domains: r.site_ids.map(id => domainOf.get(id)).filter(Boolean),
  }))

  return NextResponse.json({ reports: withDomains })
}

export async function POST(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { user, service } = ctx

  const body = await req.json() as { site_ids: string[]; date_start: string; date_end: string }
  if (!body.site_ids || body.site_ids.length < 2) return NextResponse.json({ error: '至少选2个站点' }, { status: 400 })
  if (body.site_ids.length > 10) return NextResponse.json({ error: '一次最多选10个站点，太多AI综合分析会跑不动' }, { status: 400 })
  if (!body.date_start || !body.date_end) return NextResponse.json({ error: '缺少时间范围' }, { status: 400 })

  const { data, error } = await service.from('multi_site_research_reports').insert({
    site_ids: body.site_ids,
    date_start: body.date_start,
    date_end: body.date_end,
    created_by: user!.id,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ report: data })
}
