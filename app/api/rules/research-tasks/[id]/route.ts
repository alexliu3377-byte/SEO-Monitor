import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeOutcomeScore } from '@/lib/outcome-score'

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

// 研究任务详情：把这个站点在选定时间范围内已经抓到的历史数据一次性拉出来，
// 不重新抓取——数据来源都是系统本来就在跑的日常监控（涨跌/排名/权重/收录），
// 这里只是按站点+时间范围做一次聚合展示，给人工研究用。
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx
  const { id } = await params

  const { data: task, error: taskErr } = await service.from('site_research_tasks').select('*').eq('id', id).single()
  if (taskErr || !task) return NextResponse.json({ error: taskErr?.message || '研究任务不存在' }, { status: 404 })

  const { data: site, error: siteErr } = await service.from('sites').select('*').eq('id', task.site_id).single()
  if (siteErr || !site) return NextResponse.json({ error: '站点不存在' }, { status: 404 })

  const { date_start, date_end } = task as { date_start: string; date_end: string }

  const [
    { data: weightRows },
    { data: indexRows },
    { data: rankChangeRows },
    { data: trackingRows },
    { data: rawKwRows },
  ] = await Promise.all([
    service.from('weight_history').select('record_date, pc_weight, mobile_weight, pc_ip, pc_ip_max, mobile_ip, mobile_ip_max')
      .eq('site_id', site.id).gte('record_date', date_start).lte('record_date', date_end).order('record_date'),
    service.from('index_snapshots').select('snapshot_date, index_count')
      .eq('site_id', site.id).gte('snapshot_date', date_start).lte('snapshot_date', date_end).order('snapshot_date'),
    service.from('rank_changes').select('stat_date, keyword, type, volume')
      .eq('site_id', site.id).gte('stat_date', date_start).lte('stat_date', date_end),
    service.from('competitor_tracking_records')
      .select('keyword, discovery_date, source_url, rank_position, rank_type, rank_volume, effectiveness')
      .eq('site_id', site.id).gte('discovery_date', date_start).lte('discovery_date', date_end)
      .order('discovery_date', { ascending: false }),
    service.from('raw_keywords').select('content_date, content_type')
      .eq('site_id', site.id).gte('content_date', date_start).lte('content_date', date_end),
  ])

  // 涨跌（rank_changes）按天汇总涨入/跌出数量
  const rankChangeByDate = new Map<string, { date: string; rankup: number; rankdown: number }>()
  for (const r of (rankChangeRows ?? []) as { stat_date: string; type: string; volume: number }[]) {
    if (!rankChangeByDate.has(r.stat_date)) rankChangeByDate.set(r.stat_date, { date: r.stat_date, rankup: 0, rankdown: 0 })
    const d = rankChangeByDate.get(r.stat_date)!
    if (r.type === 'rankup') d.rankup++
    else if (r.type === 'rankdown') d.rankdown++
  }

  // 新增关键词按天汇总（raw_keywords，区分 app/game）
  const newKeywordsByDate = new Map<string, { date: string; app: number; game: number }>()
  for (const r of (rawKwRows ?? []) as { content_date: string | null; content_type: string }[]) {
    if (!r.content_date) continue
    if (!newKeywordsByDate.has(r.content_date)) newKeywordsByDate.set(r.content_date, { date: r.content_date, app: 0, game: 0 })
    const d = newKeywordsByDate.get(r.content_date)!
    if (r.content_type === 'game') d.game++
    else d.app++
  }

  // "排名"模式的成效——跟分组报告成效追踪同一套打分公式（lib/outcome-score.ts）。
  // 有 rank_position 就等于已经被收录（排名的前提是收录），isIndexed 这里恒传 true；
  // competitor_tracking_records 不记录具体涨跌幅度，rankChange 传 null（只有 rank_type
  // 方向，没有涨跌了几位的数字）。
  const effectivenessRows = ((trackingRows ?? []) as {
    keyword: string; discovery_date: string; source_url: string | null
    rank_position: number | null; rank_type: string | null; rank_volume: number; effectiveness: string
  }[]).map(r => ({
    ...r,
    score: r.rank_position != null ? computeOutcomeScore(r.rank_position, true, null, r.rank_volume) : null,
  }))

  return NextResponse.json({
    task,
    site,
    weightTrend: weightRows ?? [],
    indexTrend: indexRows ?? [],
    rankChangeTrend: Array.from(rankChangeByDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    newKeywordsTrend: Array.from(newKeywordsByDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    effectivenessRows: effectivenessRows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { user, service } = ctx
  const { id } = await params

  const body = await req.json() as {
    action: 'save_analysis' | 'promote' | 'complete'
    ai_analysis?: string
    ai_candidate_rule?: Record<string, unknown> | null
    rule?: { name: string; type: string; description?: string; confidence?: number; stage_applicability?: string[] }
  }

  if (body.action === 'save_analysis') {
    const { error } = await service.from('site_research_tasks')
      .update({ ai_analysis: body.ai_analysis ?? null, ai_candidate_rule: body.ai_candidate_rule ?? null })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (body.action === 'complete') {
    const { error } = await service.from('site_research_tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (body.action === 'promote') {
    if (!body.rule?.name || !body.rule?.type) return NextResponse.json({ error: '缺少规则名称/类型' }, { status: 400 })

    const { data: task } = await service.from('site_research_tasks').select('site_id').eq('id', id).single()
    if (!task) return NextResponse.json({ error: '研究任务不存在' }, { status: 404 })

    // 沿用原先"草稿审批通过"时创建规则的同一套模式（rule_number 自增、source='ai'）
    const { data: maxRow } = await service.from('rules').select('rule_number').order('rule_number', { ascending: false }).limit(1).single()
    const nextNumber = (maxRow?.rule_number ?? 0) + 1

    const { data: newRule, error: ruleErr } = await service
      .from('rules')
      .insert({
        rule_number: nextNumber,
        name: body.rule.name,
        type: body.rule.type,
        status: 'testing',
        source: 'ai',
        description: body.rule.description ?? null,
        confidence: body.rule.confidence ?? 50,
        stage_applicability: body.rule.stage_applicability ?? [],
        success_count: 0,
        fail_count: 0,
        priority: 0,
        site_ids: [],
        competitor_domains: [],
        created_by: user!.id,
      })
      .select()
      .single()
    if (ruleErr) return NextResponse.json({ error: ruleErr.message }, { status: 500 })

    const { error: taskErr } = await service.from('site_research_tasks')
      .update({ status: 'completed', promoted_rule_id: newRule.id, completed_at: new Date().toISOString() })
      .eq('id', id)
    if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 })

    return NextResponse.json({ success: true, rule: newRule })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
