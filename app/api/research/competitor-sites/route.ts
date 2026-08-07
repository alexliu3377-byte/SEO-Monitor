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

// 竞品成效tab的站点选择器数据源——has_rank_title=true 的站点才会被
// scripts/crawl.ts 的 runTracking() 每天追踪进 competitor_tracking_records。
export async function GET() {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { data: sites, error } = await service
    .from('sites').select('id, domain, name')
    .eq('has_rank_title', true)
    .order('domain')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const siteIds = (sites ?? []).map((s: { id: string }) => s.id)
  const weightMap = new Map<string, { pc: number; mobile: number }>()
  if (siteIds.length > 0) {
    const { data: weightRows } = await service
      .from('weight_history').select('site_id, record_date, pc_weight, mobile_weight')
      .in('site_id', siteIds).order('record_date', { ascending: true })
    for (const w of (weightRows ?? []) as { site_id: string; pc_weight: number; mobile_weight: number }[]) {
      weightMap.set(w.site_id, { pc: w.pc_weight, mobile: w.mobile_weight })
    }
  }

  const result = (sites ?? []).map((s: { id: string; domain: string; name: string }) => ({
    ...s,
    pcWeight: weightMap.get(s.id)?.pc ?? null,
    mobileWeight: weightMap.get(s.id)?.mobile ?? null,
  }))
  return NextResponse.json({ sites: result })
}
