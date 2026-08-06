import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

type CaseRow = { id: string; keyword: string; discovery_date: string; site_id: string; rank_position: number | null; rank_type: string | null }
type RuleStatRow = { rule_id: string; effectiveness: string; discovery_date: string }

// 2026-08-05：规则中心重做后，这个接口不再自动调 AI、不再写 rule_drafts——
// 纯 SQL 聚合，返回"这些站点/规则值得研究"的建议列表，交给"推荐研究" tab
// 展示，由人工决定要不要为某条建议发起"站点研究任务"。原来的 Layer 2
// （Gemini 调用 + 写 rule_drafts）已经删除；vercel.json 里每周日自动跑的
// cron 也一并去掉了——现在是纯读接口，前端打开"推荐研究" tab 时实时算。
export async function GET(req: Request) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const since90 = getMY(-90)
  const since30 = getMY(-30)

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

  const siteIds = Array.from(new Set((newCases ?? []).map((c: CaseRow) => c.site_id)))
  const domainMap = new Map<string, string>()
  if (siteIds.length > 0) {
    const { data: sites } = await service.from('sites').select('id, domain').in('id', siteIds)
    for (const s of (sites ?? []) as { id: string; domain: string }[]) domainMap.set(s.id, s.domain)
  }

  // 按"站点+月份"聚类未打 rule_id 的有效案例——聚类数量大说明这个站点这段
  // 时间可能有值得研究的规律，交给人工判断要不要发起研究任务。
  const groups = new Map<string, { siteId: string; domain: string; month: string; count: number; keywords: string[] }>()
  for (const c of (newCases ?? []) as CaseRow[]) {
    const domain = domainMap.get(c.site_id) ?? c.site_id
    const month = c.discovery_date.slice(0, 7)
    const key = `${c.site_id}|${month}`
    if (!groups.has(key)) groups.set(key, { siteId: c.site_id, domain, month, count: 0, keywords: [] })
    const g = groups.get(key)!
    g.count++
    if (g.keywords.length < 6) g.keywords.push(c.keyword)
  }
  const siteSuggestions = Array.from(groups.values()).sort((a, b) => b.count - a.count)

  // 成功率比历史下降 >20个百分点的规则——可能是竞品打法变了/规则过时了，
  // 也值得挑对应站点发起研究任务重新看看。
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
  const decliningRules = Object.values(ruleHealth)
    .filter(h => h.recentT >= 5 && h.histT >= 10 && (h.histS / h.histT) - (h.recentS / h.recentT) > 0.20)
    .map(h => ({
      name: h.name,
      histRate: Math.round(h.histS / h.histT * 100),
      recentRate: Math.round(h.recentS / h.recentT * 100),
      histCount: h.histT,
      recentCount: h.recentT,
    }))

  return NextResponse.json({ siteSuggestions, decliningRules })
}
