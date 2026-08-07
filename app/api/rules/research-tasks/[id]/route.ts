import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchSiteResearchSummary } from '@/lib/site-research-summary'

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

  // 数据拉取+成效打分逻辑抽到 lib/site-research-summary.ts，跟多站点研究报告
  // （app/api/rules/multi-site-reports/[id]/analyze/route.ts）共用。
  const summary = await fetchSiteResearchSummary(service, site.id, date_start, date_end)

  return NextResponse.json({ task, site, ...summary })
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
