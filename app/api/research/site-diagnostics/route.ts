export const maxDuration = 180

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchSiteResearchSummary } from '@/lib/site-research-summary'
import { computeEnvironmentStats } from '@/lib/environment-stats'
import { fetchGroupEffectivenessSummary } from '@/lib/tracking-summary'
import { computeOpportunityGaps } from '@/lib/opportunity-gap'
import { buildSiteDiagnosticPrompt } from '@/lib/site-diagnostic-prompt'
import { callGeminiJSON } from '@/lib/gemini'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

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

// 研究中心"站点诊断"——用户选一个站点（可以带一个具体问题），读这个站点近
// 90天完整历史数据 + 大环境档位对比 + 关联分组任务团队现状 + 机会缺口（2026-08-12
// 接入 lib/opportunity-gap.ts，portfolio-wide算出来的、竞品赢但全公司零覆盖的
// 词，AI自己判断哪些跟这个站的内容调性搭），一次性喂给 Gemini 写一份策略建议。
// 2026-08-11 新增，用户接手一个闲置很久的站点（f71.com）要重新安排人手时提出
// 的需求——不是定时报告，是按需触发、用户愿意等（maxDuration 给到180秒），
// 输出也不追求简短，要写得完整有据。
export async function POST(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service, user } = ctx

  const { site_id, question } = await req.json() as { site_id?: string; question?: string }
  if (!site_id) return NextResponse.json({ error: '缺少 site_id' }, { status: 400 })

  const { data: site, error: siteErr } = await service
    .from('sites')
    .select('id, domain, name, is_enabled, has_rank_data, has_rank_title, has_index_pages, focus_level')
    .eq('id', site_id).single()
  if (siteErr || !site) return NextResponse.json({ error: '站点不存在' }, { status: 404 })

  const dateEnd = getMY()
  const dateStart = getMY(-90)

  const [summary, envStats, groupsRaw, gapResult] = await Promise.all([
    fetchSiteResearchSummary(service, site_id, dateStart, dateEnd),
    computeEnvironmentStats(service, dateEnd),
    service.from('task_groups').select('id, name, site_domains').contains('site_domains', [site.domain])
      .then((r: { data: { id: string; name: string; site_domains: string[] }[] | null }) => r.data ?? []),
    computeOpportunityGaps(service, dateStart, dateEnd),
  ])

  const siteTier = envStats?.siteTiers.get(site_id) ?? null

  const groups = await Promise.all(
    groupsRaw.map(async (g: { id: string; name: string }) => {
      const [effectiveness, { count }] = await Promise.all([
        fetchGroupEffectivenessSummary(service, g.id, dateStart, dateEnd),
        service.from('task_group_members').select('user_id', { count: 'exact', head: true }).eq('group_id', g.id),
      ])
      return { group_name: g.name, memberCount: count ?? 0, ...effectiveness }
    })
  )

  const prompt = buildSiteDiagnosticPrompt(site, summary, dateStart, dateEnd, envStats, siteTier, groups, gapResult.gaps, question ?? null)
  const { result, error } = await callGeminiJSON<{ diagnosis: string }>(prompt, { maxOutputTokens: 4096 })
  if (!result) return NextResponse.json({ error: error || 'AI 诊断失败' }, { status: 500 })

  const { data: saved, error: saveErr } = await service
    .from('site_diagnostics')
    .insert({ site_id, question: question || null, result: result.diagnosis, created_by: user.id })
    .select('id, created_at')
    .single()
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ id: saved.id, created_at: saved.created_at, question: question || null, result: result.diagnosis })
}

export async function GET(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('site_id')
  if (!siteId) return NextResponse.json({ error: '缺少 site_id' }, { status: 400 })

  const { data, error } = await service
    .from('site_diagnostics')
    .select('id, question, result, created_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ diagnostics: data ?? [] })
}
