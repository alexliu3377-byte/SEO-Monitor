import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchOwnSiteDomains } from '@/lib/tracking-summary'

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
// 排除自己的站点（sites.is_own_site，见 lib/tracking-summary.ts 的
// fetchOwnSiteDomains 注释）——自己的站点不该被当竞品统计。
//
// ?all=true 时改成返回全部站点（含自己的站点，2026-08-10 起不再排除——
// "管理竞品站点"弹窗本身就是用户手动标"这个站点是自家还是竞品"的地方，
// 排除了反而没法在这里把一个站点标成自家），带上 has_rank_title 和
// is_own_site 供前端预选中当前状态。
export async function GET(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx
  const all = new URL(req.url).searchParams.get('all') === 'true'

  const [ownDomains, sitesRes] = await Promise.all([
    all ? Promise.resolve(new Set<string>()) : fetchOwnSiteDomains(service),
    all
      ? service.from('sites').select('id, domain, name, has_rank_title, is_own_site').order('domain')
      : service.from('sites').select('id, domain, name').eq('has_rank_title', true).order('domain'),
  ])
  const { data: sitesRaw, error } = sitesRes
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sites = (sitesRaw ?? []).filter((s: { domain: string }) => !ownDomains.has(s.domain))

  const siteIds = sites.map((s: { id: string }) => s.id)
  const weightMap = new Map<string, { pc: number; mobile: number }>()
  if (siteIds.length > 0) {
    const { data: weightRows } = await service
      .from('weight_history').select('site_id, record_date, pc_weight, mobile_weight')
      .in('site_id', siteIds).order('record_date', { ascending: true })
    for (const w of (weightRows ?? []) as { site_id: string; pc_weight: number; mobile_weight: number }[]) {
      weightMap.set(w.site_id, { pc: w.pc_weight, mobile: w.mobile_weight })
    }
  }

  const result = sites.map((s: { id: string; domain: string; name: string; has_rank_title?: boolean; is_own_site?: boolean }) => ({
    ...s,
    pcWeight: weightMap.get(s.id)?.pc ?? null,
    mobileWeight: weightMap.get(s.id)?.mobile ?? null,
  }))
  return NextResponse.json({ sites: result })
}
