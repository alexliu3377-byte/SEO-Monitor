import { NextResponse } from 'next/server'
import { mapWithConcurrency } from '@/lib/diagnostic-work'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin', 'normal'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { data: report, error } = await service.from('research_reports').select('*').eq('id', id).single()
  if (error || !report) return NextResponse.json({ error: '报告不存在' }, { status: 404 })

  // site_analyses 现在从 research_report_sites 表读（每站点一行，2026-08-07 年报
  // 拆分片改动的一部分——分片并行写不能共享同一个 JSONB 数组列，会互相覆盖）。
  // 拆分片之前生成的老报告在这张新表里没有行，这时 report.site_analyses（select('*')
  // 已经带出来的旧版 JSONB 列）还有真实数据，做个兜底不然老报告会显示"没有站点分析"。
  const { data: siteRows, error: siteRowsError } = await service
    .from('research_report_sites')
    .select('site_id, domain, name, skipped, skip_reason, analysis, error, pc_weight, mobile_weight, avg_index_count, avg_mobile_ip, momentum_keywords, findings')
    .eq('report_id', id)
  if (siteRowsError) return NextResponse.json({ error: '报告站点分析读取失败，请稍后重试' }, { status: 503 })
  if (siteRows && siteRows.length > 0) report.site_analyses = siteRows

  // 附上"各站点分析"里每个站点的最新权重——SiteAZPicker 的名牌要带PC/M权重
  // （用户点名要求），不用另外发一次请求。2026-08-10 起 research_report_sites
  // 自己就带 pc_weight/mobile_weight 了（Stage1 顺手存的），这里改成只给"老
  // 报告"（那4个新列是null，改版之前生成的）兜底查一次 weight_history，新报告
  // 不用再查。
  const staleSiteIds = ((report.site_analyses ?? []) as { site_id: string; pc_weight: number | null; mobile_weight: number | null }[])
    .filter(s => s.pc_weight == null && s.mobile_weight == null).map(s => s.site_id)
  const siteWeights: Record<string, { pc: number; mobile: number }> = {}
  try {
    await mapWithConcurrency([...new Set(staleSiteIds)], 4, async siteId => {
      const { data, error: weightError } = await service.from('weight_history')
        .select('pc_weight, mobile_weight').eq('site_id', siteId)
        .order('record_date', { ascending: false }).order('id', { ascending: false })
        .limit(1).maybeSingle()
      if (weightError) throw weightError
      if (data) siteWeights[siteId] = { pc: data.pc_weight, mobile: data.mobile_weight }
    })
  } catch {
    return NextResponse.json({ error: '报告站点最新权重读取失败，请稍后重试' }, { status: 503 })
  }

  return NextResponse.json({ report, siteWeights })
}
