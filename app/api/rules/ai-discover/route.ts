export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { callGeminiJSON } from '@/lib/gemini'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

type CaseRow = { id: string; keyword: string; discovery_date: string; site_id: string; rank_position: number | null; rank_type: string | null }
type RuleStatRow = { rule_id: string; effectiveness: string; discovery_date: string }

async function handler(req: Request) {
  // Accept either Bearer CRON_SECRET (from cron) or admin/super user session
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  let authed = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)

  if (!authed) {
    const authClient = createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = createServiceClient() as any
    const { data: profile } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
    if (['super', 'admin'].includes(profile?.role)) authed = true
  }
  if (!authed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const since90 = getMY(-90)
  const since30 = getMY(-30)

  // ── Layer 1: SQL pre-filter ────────────────────────────────────────────────

  // 1a. Unmatched effective cases (potential new rules)
  const [{ data: newCases }, { data: ruleStatRows }, { data: rulesData }] = await Promise.all([
    service
      .from('competitor_tracking_records')
      .select('id, keyword, discovery_date, site_id, rank_position, rank_type')
      .eq('effectiveness', '有效')
      .is('rule_id', null)
      .gte('discovery_date', since90)
      .order('discovery_date', { ascending: false })
      .limit(300),
    service
      .from('competitor_tracking_records')
      .select('rule_id, effectiveness, discovery_date')
      .not('rule_id', 'is', null)
      .gte('discovery_date', since90),
    service.from('rules').select('id, rule_number, name').order('rule_number', { ascending: true }),
  ])

  // 1b. Site domains for case context
  const siteIds = Array.from(new Set((newCases ?? []).map((c: CaseRow) => c.site_id)))
  const domainMap = new Map<string, string>()
  if (siteIds.length > 0) {
    const { data: sites } = await service.from('sites').select('id, domain').in('id', siteIds)
    for (const s of (sites ?? []) as { id: string; domain: string }[]) domainMap.set(s.id, s.domain)
  }

  // 1c. Find declining rules (recent rate < historical rate by >20pp with enough data)
  const ruleNameMap = new Map<string, string>(
    (rulesData ?? []).map((r: { id: string; rule_number: number; name: string }) => [r.id, `#${r.rule_number} ${r.name}`])
  )
  const ruleHealth: Record<string, { name: string; recentS: number; recentT: number; histS: number; histT: number }> = {}
  for (const row of (ruleStatRows ?? []) as RuleStatRow[]) {
    if (!ruleHealth[row.rule_id]) ruleHealth[row.rule_id] = { name: ruleNameMap.get(row.rule_id) ?? row.rule_id, recentS: 0, recentT: 0, histS: 0, histT: 0 }
    const h = ruleHealth[row.rule_id]
    if (row.discovery_date >= since30) { h.recentT++; if (row.effectiveness === '有效') h.recentS++ }
    else { h.histT++; if (row.effectiveness === '有效') h.histS++ }
  }
  const decliningRules = Object.values(ruleHealth).filter(h => {
    if (h.recentT < 5 || h.histT < 10) return false
    return (h.histS / h.histT) - (h.recentS / h.recentT) > 0.20
  })

  const MIN_CASES = 10
  if ((newCases?.length ?? 0) < MIN_CASES && decliningRules.length === 0) {
    return NextResponse.json({ skipped: true, reason: `数据不足：新案例${newCases?.length ?? 0}条（需≥${MIN_CASES}），且无下降规则` })
  }

  // ── Build compact summary for AI ──────────────────────────────────────────

  // Group new cases by site + month
  const groups = new Map<string, { domain: string; month: string; count: number; keywords: string[]; ids: string[] }>()
  for (const c of (newCases ?? []) as CaseRow[]) {
    const domain = domainMap.get(c.site_id) ?? c.site_id
    const month = c.discovery_date.slice(0, 7)
    const key = `${domain}|${month}`
    if (!groups.has(key)) groups.set(key, { domain, month, count: 0, keywords: [], ids: [] })
    const g = groups.get(key)!
    g.count++
    g.ids.push(c.id)
    if (g.keywords.length < 4) g.keywords.push(c.keyword)
  }

  let newCasesSummary = `近90天竞品有效追踪（无规则标记）共 ${newCases?.length ?? 0} 条：\n`
  for (const g of Array.from(groups.values())) {
    newCasesSummary += `- ${g.domain} | ${g.month} | ${g.count}条 | 词样例: ${g.keywords.join('、')}\n`
  }

  let ruleReviewSummary = ''
  if (decliningRules.length > 0) {
    ruleReviewSummary = '\n需重新评估的规则（近30天成功率明显下降）：\n'
    for (const h of decliningRules) {
      const hr = Math.round(h.histS / h.histT * 100)
      const rr = Math.round(h.recentS / h.recentT * 100)
      ruleReviewSummary += `- ${h.name}：历史${hr}%（${h.histT}条）→ 近30天${rr}%（${h.recentT}条）\n`
    }
  }

  const existingRules = (rulesData ?? [])
    .slice(0, 20)
    .map((r: { rule_number: number; name: string }) => `#${r.rule_number} ${r.name}`)
    .join('、')

  const prompt = `你是 SEO Monitor 的规则发现引擎，专注于百度SEO策略。

现有规则（避免重复）：${existingRules || '暂无'}

${newCasesSummary}${ruleReviewSummary}

请分析以上数据，完成以下两项任务：
1. 从"近90天竞品有效追踪"中，识别出可能成为新规则的模式（如批量操作、时间聚集、跨站共同行为）
2. 对"需重新评估的规则"，分析可能的原因并给出建议

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "new_rule_drafts": [
    {
      "pattern_description": "简要描述发现的规律（中文，50字内）",
      "case_count": 数字,
      "draft_name": "规则名称（中文，20字内）",
      "draft_type": "add 或 update 或 mixed",
      "draft_description": "触发条件→执行动作→预期效果（中文，50-120字）",
      "draft_confidence": 0-100的整数,
      "draft_stage_applicability": ["起站期","成长期","成熟期","通用"] 的子集
    }
  ],
  "rule_review_drafts": [
    {
      "pattern_description": "描述规则效果下降情况（中文，50字内）",
      "case_count": 数字,
      "draft_name": "重评：原规则名",
      "draft_type": "update",
      "draft_description": "下降原因推测→建议调整方向（中文，50-120字）",
      "draft_confidence": 0-100的整数,
      "draft_stage_applicability": []
    }
  ]
}`

  // ── Layer 2: Gemini call (non-streaming JSON mode) ──────────────────────

  type DiscoverResult = { new_rule_drafts?: unknown[]; rule_review_drafts?: unknown[] }
  const { result: aiResult, error: lastErr } = await callGeminiJSON<DiscoverResult>(prompt)

  if (!aiResult) return NextResponse.json({ error: lastErr || 'Gemini call failed' }, { status: 500 })

  // ── Save drafts to rule_drafts table ───────────────────────────────────

  const allCaseIds = (newCases ?? []).map((c: CaseRow) => c.id)
  const draftsToInsert: unknown[] = []

  for (const d of (aiResult.new_rule_drafts ?? []) as Record<string, unknown>[]) {
    draftsToInsert.push({
      draft_category: 'new_rule',
      pattern_description: d.pattern_description ?? '',
      case_count: d.case_count ?? 0,
      draft_name: d.draft_name ?? '未命名草稿',
      draft_type: ['add', 'update', 'mixed'].includes(d.draft_type as string) ? d.draft_type : 'add',
      draft_rule_status: 'testing',
      draft_description: d.draft_description ?? null,
      draft_confidence: Math.min(100, Math.max(0, Number(d.draft_confidence ?? 50))),
      draft_stage_applicability: Array.isArray(d.draft_stage_applicability) ? d.draft_stage_applicability : [],
      supporting_cases: allCaseIds.slice(0, 50),
      status: 'pending',
    })
  }

  for (const d of (aiResult.rule_review_drafts ?? []) as Record<string, unknown>[]) {
    draftsToInsert.push({
      draft_category: 'rule_review',
      pattern_description: d.pattern_description ?? '',
      case_count: d.case_count ?? 0,
      draft_name: d.draft_name ?? '重评草稿',
      draft_type: 'update',
      draft_rule_status: 'testing',
      draft_description: d.draft_description ?? null,
      draft_confidence: Math.min(100, Math.max(0, Number(d.draft_confidence ?? 50))),
      draft_stage_applicability: [],
      supporting_cases: [],
      status: 'pending',
    })
  }

  if (draftsToInsert.length > 0) {
    await service.from('rule_drafts').insert(draftsToInsert)
  }

  return NextResponse.json({
    success: true,
    new_cases_analyzed: newCases?.length ?? 0,
    declining_rules: decliningRules.length,
    drafts_saved: draftsToInsert.length,
  })
}

// Vercel Cron calls GET; manual trigger from UI uses POST
export const GET = handler
export const POST = handler
