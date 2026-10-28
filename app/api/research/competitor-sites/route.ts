import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { mapWithConcurrency } from '@/lib/diagnostic-work'
import { fetchOwnSiteDomains } from '@/lib/tracking-summary'

async function requireAdmin() {
  const authClient = await createClient()
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
// 排除自己的站点（fetchOwnSiteDomains，2026-08-10 当天先改成手动标记又
// 改回 task_groups.site_domains 自动识别，反复过一次）——自己的站点不该
// 被当竞品统计，也不该出现在"管理竞品站点"的可选列表里。
//
// ?all=true 时返回全部（非自己的）站点，不管 has_rank_title 是否开启，
// 供"管理竞品站点"弹窗勾选用。
export async function GET(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx
  const all = new URL(req.url).searchParams.get('all') === 'true'

  const [ownDomains, sitesRes] = await Promise.all([
    fetchOwnSiteDomains(service),
    all
      ? service.from('sites').select('id, domain, name, has_rank_title').order('domain')
      : service.from('sites').select('id, domain, name').eq('has_rank_title', true).order('domain'),
  ])
  const { data: sitesRaw, error } = sitesRes
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  const sites = (sitesRaw ?? []).filter((s: { domain: string }) => !ownDomains.has(s.domain))

  const siteIds = sites.map((s: { id: string }) => s.id)
  const weightMap = new Map<string, { pc: number; mobile: number }>()
  try {
    await mapWithConcurrency(siteIds as string[], 4, async siteId => {
      const { data, error } = await service.from('weight_history')
        .select('pc_weight, mobile_weight').eq('site_id', siteId)
        .order('record_date', { ascending: false }).order('id', { ascending: false })
        .limit(1).maybeSingle()
      if (error) throw error
      if (data) weightMap.set(siteId, { pc: data.pc_weight, mobile: data.mobile_weight })
    })
  } catch {
    return NextResponse.json({ error: '最新权重读取失败，请稍后重试' }, { status: 503 })
  }

  const result = sites.map((s: { id: string; domain: string; name: string; has_rank_title?: boolean }) => ({
    ...s,
    pcWeight: weightMap.get(s.id)?.pc ?? null,
    mobileWeight: weightMap.get(s.id)?.mobile ?? null,
  }))
  return NextResponse.json({ sites: result })
}
