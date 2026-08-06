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

  const { data: tasks, error } = await service
    .from('site_research_tasks')
    .select('id, site_id, date_start, date_end, status, promoted_rule_id, created_at, completed_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const siteIds = Array.from(new Set((tasks ?? []).map((t: { site_id: string }) => t.site_id)))
  const siteMap = new Map<string, { domain: string; name: string }>()
  if (siteIds.length > 0) {
    const { data: sites } = await service.from('sites').select('id, domain, name').in('id', siteIds)
    for (const s of (sites ?? []) as { id: string; domain: string; name: string }[]) siteMap.set(s.id, { domain: s.domain, name: s.name })
  }

  const result = (tasks ?? []).map((t: { site_id: string }) => ({ ...t, site: siteMap.get(t.site_id) ?? null }))
  return NextResponse.json({ tasks: result })
}

export async function POST(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { user, service } = ctx

  const { site_id, date_start, date_end } = await req.json() as { site_id: string; date_start: string; date_end: string }
  if (!site_id || !date_start || !date_end) return NextResponse.json({ error: '缺少必要参数' }, { status: 400 })

  const { data, error } = await service
    .from('site_research_tasks')
    .insert({ site_id, date_start, date_end, status: 'in_progress', created_by: user!.id })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}
