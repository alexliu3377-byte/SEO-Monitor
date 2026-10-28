export const maxDuration = 240

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchSiteResearchSummary, type SiteResearchSummary } from '@/lib/site-research-summary'
import { computeEnvironmentStats } from '@/lib/environment-stats'
import { fetchGroupEffectivenessSummary, fetchOwnSiteDomains } from '@/lib/tracking-summary'
import { computeOpportunityGaps } from '@/lib/opportunity-gap'
import { extractDomainTokens, resolveDomains, type ResolvedSite } from '@/lib/domain-lookup'
import { buildDiagnosticPrompt, type DiagnosticSiteEntry } from '@/lib/site-diagnostic-prompt'
import { callGeminiJSON, QUALITY_MODELS } from '@/lib/gemini'

import { createDiagnosticCache, createQueryLimiter, mapWithConcurrency } from '@/lib/diagnostic-work'

const siteSummaryCache = createDiagnosticCache<SiteResearchSummary>()
const scheduleDiagnosticPage = createQueryLimiter(4)
const MAX_SITES = 15

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

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

// 研究中心"站点诊断"——2026-08-27 起用户直接自由提问，不用先选站点：AI自己从
// 问题文本里识别提到了哪些站点（正则抓域名 token 去 sites 表匹配），0个=纯
// "大环境"问题、1个=单站诊断、多个=跨站点找规律一起分析。见
// lib/site-diagnostic-prompt.ts 顶部注释，同一次改动修了个真实bug：旧版对
// 任何站点都会建议"人手安排"，哪怕这个站根本不是用户自己运营的。
export async function POST(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service, user } = ctx

  const { question } = await req.json() as { question?: string }
  if (typeof question !== 'string' || !question.trim()) return NextResponse.json({ error: '请输入问题' }, { status: 400 })

  const dateEnd = getMY()
  const dateStart = getMY(-90)

  const tokens = extractDomainTokens(question)
  const inputs = await (async () => {
    const resolved = await resolveDomains(service, tokens)
    const [ownDomains, envStats, gapResult] = await Promise.all([
      fetchOwnSiteDomains(service),
      computeEnvironmentStats(service, dateEnd),
      computeOpportunityGaps(service, dateStart, dateEnd),
    ])
    return { ...resolved, ownDomains, envStats, gapResult }
  })().catch(() => null)
  if (!inputs) return NextResponse.json({ error: '诊断基础资料读取失败，请稍后重试' }, { status: 503 })
  const { matched: matchedAll, unmatched, ownDomains, envStats, gapResult } = inputs
  const truncated = matchedAll.length > MAX_SITES
  const matched = matchedAll.slice(0, MAX_SITES)


  const groupSummaries = new Map<string, Promise<DiagnosticSiteEntry['groups'][number]>>()
  function groupSummary(g: { id: string; name: string }) {
    let pending = groupSummaries.get(g.id)
    if (!pending) {
      pending = Promise.all([
        fetchGroupEffectivenessSummary(service, g.id, dateStart, dateEnd),
        service.from('task_group_members').select('user_id', { count: 'exact', head: true }).eq('group_id', g.id),
      ]).then(([effectiveness, result]) => {
        if (result.error) throw result.error
        return { group_name: g.name, memberCount: result.count ?? 0, ...effectiveness }
      })
      groupSummaries.set(g.id, pending)
    }
    return pending
  }

  // 每个站点单独 try/catch，某一个站点拉数据失败不影响其它站点（照抄
  // scripts/research-report.ts Stage1 对多站点的容错模式）。
  const entries: DiagnosticSiteEntry[] = (await mapWithConcurrency(matched, 2, async (site: ResolvedSite): Promise<DiagnosticSiteEntry | null> => {
    try {
      const isOwnSite = ownDomains.has(site.domain)
      const summary = await siteSummaryCache(JSON.stringify([user.id, site.id, dateStart, dateEnd]),
        () => fetchSiteResearchSummary(service, site.id, dateStart, dateEnd, scheduleDiagnosticPage))
      const siteTier = envStats?.siteTiers.get(site.id) ?? null

      let groups: DiagnosticSiteEntry['groups'] = []
      if (isOwnSite) {
        const { data: groupsRaw, error: groupsError } = await service.from('task_groups').select('id, name, site_domains').contains('site_domains', [site.domain])
        if (groupsError) throw groupsError
        groups = await mapWithConcurrency(
          (groupsRaw ?? []) as { id: string; name: string }[], 2, groupSummary,
        )
      }

      return {
        site: {
          domain: site.domain, name: site.name, is_enabled: site.is_enabled,
          has_rank_data: site.has_rank_data, has_rank_title: site.has_rank_title,
          has_index_pages: site.has_index_pages, focus_level: site.focus_level,
        },
        isOwnSite, summary, siteTier, groups,
      }
    } catch (e) {
      console.error(`站点诊断：${site.domain} 数据拉取失败`, e)
      return null
    }
  })).filter((e): e is DiagnosticSiteEntry => e !== null)

  const successfulIds = new Set(entries.map(entry => entry.site.domain))
  const failedSites = matched.filter(site => !successfulIds.has(site.domain)).map(site => site.domain)
  if (matched.length > 0 && entries.length === 0) return NextResponse.json({
    error: '所选站点资料读取失败，未生成诊断，请稍后重试', failed_sites: failedSites,
  }, { status: 503 })
  const failureNote = failedSites.length ? `资料不完整：${failedSites.join('、')} 读取失败，本次未分析这些站点。` : ''

  const prompt = failureNote + '\n' + '资料说明：同一用户的站点资料可能复用最近60秒内的读取结果；不代表实时采集。\n' + buildDiagnosticPrompt(entries, unmatched, envStats, gapResult.gaps, question, dateStart, dateEnd)
  const { result, error } = await callGeminiJSON<{ diagnosis: string }>(prompt, { maxOutputTokens: 8192, models: QUALITY_MODELS })
  if (!result) return NextResponse.json({ error: error || 'AI 诊断失败' }, { status: 500 })

  const siteIds = matched.filter(s => successfulIds.has(s.domain)).map(s => s.id)
  const diagnosis = failureNote ? `${failureNote}\n\n${result.diagnosis}` : result.diagnosis
  const { data: saved, error: saveErr } = await service
    .from('site_diagnostics')
    .insert({ site_ids: siteIds, question, result: diagnosis, created_by: user.id })
    .select('id, created_at')
    .single()
  if (saveErr) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({
    id: saved.id, created_at: saved.created_at, question, result: diagnosis,
    failed_sites: failedSites,
    matched_sites: matched.filter(s => successfulIds.has(s.domain)).map(s => ({ id: s.id, domain: s.domain, name: s.name, isOwnSite: ownDomains.has(s.domain) })),
    unmatched_domains: unmatched,
    truncated,
  })
}

export async function GET(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { searchParams } = new URL(req.url)
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0)
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10) || 20))

  const { data, count, error } = await service
    .from('site_diagnostics')
    .select('id, question, result, created_at, site_ids', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  const rows = (data ?? []) as { id: string; question: string | null; result: string; created_at: string; site_ids: string[] }[]
  const allSiteIds = Array.from(new Set(rows.flatMap(r => r.site_ids ?? [])))
  const domainMap = new Map<string, string>()
  if (allSiteIds.length > 0) {
    const { data: siteRows } = await service.from('sites').select('id, domain').in('id', allSiteIds)
    for (const s of (siteRows ?? []) as { id: string; domain: string }[]) domainMap.set(s.id, s.domain)
  }

  const diagnostics = rows.map(r => ({
    id: r.id, question: r.question, result: r.result, created_at: r.created_at,
    domains: (r.site_ids ?? []).map(id => domainMap.get(id)).filter((d): d is string => !!d),
  }))

  return NextResponse.json({ diagnostics, total: count ?? 0, page, pageSize })
}
