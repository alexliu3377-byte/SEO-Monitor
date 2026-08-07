import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { data: report, error } = await service.from('research_reports').select('*').eq('id', id).single()
  if (error || !report) return NextResponse.json({ error: '报告不存在' }, { status: 404 })

  // site_analyses 现在从 research_report_sites 表读（每站点一行，2026-08-07 年报
  // 拆分片改动的一部分——分片并行写不能共享同一个 JSONB 数组列，会互相覆盖）。
  // 拆分片之前生成的老报告在这张新表里没有行，这时 report.site_analyses（select('*')
  // 已经带出来的旧版 JSONB 列）还有真实数据，做个兜底不然老报告会显示"没有站点分析"。
  const { data: siteRows } = await service
    .from('research_report_sites')
    .select('site_id, domain, name, skipped, skip_reason, analysis, error')
    .eq('report_id', id)
  if (siteRows && siteRows.length > 0) report.site_analyses = siteRows

  // 附上"各站点分析"里每个站点的最新权重——SiteAZPicker 的名牌要带PC/M权重
  // （用户点名要求），不用另外发一次请求。
  const siteIds = ((report.site_analyses ?? []) as { site_id: string }[]).map(s => s.site_id)
  const siteWeights: Record<string, { pc: number; mobile: number }> = {}
  if (siteIds.length > 0) {
    const { data: weightRows } = await service
      .from('weight_history').select('site_id, record_date, pc_weight, mobile_weight')
      .in('site_id', siteIds).order('record_date', { ascending: true })
    for (const w of (weightRows ?? []) as { site_id: string; pc_weight: number; mobile_weight: number }[]) {
      siteWeights[w.site_id] = { pc: w.pc_weight, mobile: w.mobile_weight }
    }
  }

  return NextResponse.json({ report, siteWeights })
}
