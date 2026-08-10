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
// 2026-08-10 起不再排除自己的站点——之前排除是为了不让自家站点混进"竞品
// 成效"的汇总统计（那部分逻辑在 fetchCompetitorEffectivenessSummary，没
// 动，继续排除），但用户反馈标了"自家"后勾选排名追踪却在tab里完全看不到，
// 想看自己站点的排名追踪明细。现在两种站点都返回、带 is_own_site 供前端
// 分成"竞品站点"/"自家站点"两个区块展示，浏览明细跟统计口径是两回事。
//
// ?all=true 时返回全部站点（不管 has_rank_title 是否开启），供"管理竞品
// 站点"弹窗勾选+标自家/竞品用。
export async function GET(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx
  const all = new URL(req.url).searchParams.get('all') === 'true'

  const { data: sitesRaw, error } = all
    ? await service.from('sites').select('id, domain, name, has_rank_title, is_own_site').order('domain')
    : await service.from('sites').select('id, domain, name, is_own_site').eq('has_rank_title', true).order('domain')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sites = sitesRaw ?? []

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
