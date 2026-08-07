import { createClient } from '@supabase/supabase-js'
import { activityStart, activityEnd } from '../lib/activity-log'
import { fetchSiteResearchSummary } from '../lib/site-research-summary'
import { buildSiteAnalysisPrompt } from '../lib/site-research-prompt'
import { fetchGroupEffectivenessSummary } from '../lib/tracking-summary'
import { callGeminiJSON } from '../lib/gemini'

// 每周研究报告——GitHub Actions 直接跑（不经过 Vercel，maxDuration 300s 装不下
// 87个站点的逐站 Gemini 调用）。见 CLAUDE.md 要求：改动抓取规则要同步
// lib/crawl-rules.ts，这个脚本本身不是"抓取"，写的是新表 weekly_research_reports，
// 已经在 lib/crawl-rules.ts 加了对应章节。

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function getMalaysiaDate(offsetDays = 0): string {
  const ms = Date.now() + 8 * 3600000 + offsetDays * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

// 默认取"上周一到上周日"（MYT）——今天所在周的周一往前推7天。
function defaultPeriod(): { start: string; end: string } {
  const today = new Date(Date.now() + 8 * 3600000)
  const weekday = today.getUTCDay() // 0=周日
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1
  const thisMonday = new Date(today.getTime() - daysSinceMonday * 86400000)
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000)
  const lastSunday = new Date(thisMonday.getTime() - 1 * 86400000)
  return { start: lastMonday.toISOString().slice(0, 10), end: lastSunday.toISOString().slice(0, 10) }
}

interface SiteAnalysisEntry {
  site_id: string
  domain: string
  name: string
  skipped: boolean
  skip_reason: string | null
  analysis: string | null
  error: string | null
}

async function main() {
  const args = process.argv.slice(2)
  const periodStartArg = args.find(a => a.startsWith('--period-start='))?.split('=')[1]
  const periodEndArg = args.find(a => a.startsWith('--period-end='))?.split('=')[1]
  const def = defaultPeriod()
  const periodStart = periodStartArg || def.start
  const periodEnd = periodEndArg || def.end

  console.log(`[research-report] 周期 ${periodStart} ~ ${periodEnd}`)

  const activityId = await activityStart(supabase, {
    type: 'cron_task', source: 'github_actions', step: 'weekly-research-report',
  })

  // upsert 一行 status='running'，若同周期已有 site_analyses（比如上次中途断了）
  // 就接着跑，跳过已经分析过的站点——断点续跑。
  const { data: existing } = await supabase
    .from('weekly_research_reports')
    .select('id, site_analyses')
    .eq('period_start', periodStart).eq('period_end', periodEnd)
    .maybeSingle()

  let reportId: string

  if (existing) {
    reportId = existing.id
    const doneCount = ((existing.site_analyses ?? []) as SiteAnalysisEntry[]).length
    await supabase.from('weekly_research_reports').update({ status: 'running', error: null }).eq('id', reportId)
    console.log(`[research-report] 复用已有报告 ${reportId}，已完成 ${doneCount} 个站点，接着跑剩下的`)
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('weekly_research_reports')
      .insert({ period_start: periodStart, period_end: periodEnd, status: 'running' })
      .select('id').single()
    if (insertErr || !inserted) {
      console.error('[research-report] 创建报告行失败:', insertErr?.message)
      if (activityId) await activityEnd(supabase, activityId, { status: 'fail', summary: insertErr?.message })
      process.exit(1)
    }
    reportId = inserted.id
  }

  // 从这里开始任何未预料的异常（不是已经按站点吞掉的那种）都要让报告行落到
  // status='failed' 并带上原因，不能就这么崩掉、留一行永远卡在 'running' 的
  // 报告——页面会一直显示"生成中"，跟真的还在跑没法区分。
  try {
    await runReport(reportId, periodStart, periodEnd, activityId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('weekly_research_reports').update({ status: 'failed', error: msg }).eq('id', reportId)
    if (activityId) await activityEnd(supabase, activityId, { status: 'fail', summary: msg })
    throw e
  }
}

async function runReport(reportId: string, periodStart: string, periodEnd: string, activityId: string | null) {
  const startedAt = Date.now()

  // upsert 一行 status='running'，若同周期已有 site_analyses（比如上次中途断了）
  // 就接着跑，跳过已经分析过的站点——断点续跑。
  const { data: existing } = await supabase
    .from('weekly_research_reports')
    .select('site_analyses')
    .eq('id', reportId)
    .single()

  const siteAnalyses: SiteAnalysisEntry[] = (existing?.site_analyses ?? []) as SiteAnalysisEntry[]
  const doneSiteIds = new Set(siteAnalyses.map(s => s.site_id))

  const { data: sites } = await supabase.from('sites').select('id, domain, name').eq('is_enabled', true)
  const siteList = (sites ?? []) as { id: string; domain: string; name: string }[]
  console.log(`[research-report] ${siteList.length} 个启用站点`)

  let geminiCallCount = 0
  let geminiFailCount = 0

  for (const site of siteList) {
    if (doneSiteIds.has(site.id)) continue

    // 数据拉取本身也可能失败（比如某个站点的历史数据量太大，DB 查询超时）——
    // 跟下面的 Gemini 调用一样，单个站点的任何失败都不能让整次运行崩掉，
    // 已经跑完的其它站点、已经写回 DB 的 checkpoint 不能因为这一个站点报废。
    try {
      const summary = await fetchSiteResearchSummary(supabase, site.id, periodStart, periodEnd)
      const hasData = summary.weightTrend.length > 0 || summary.indexTrend.length > 0 ||
        summary.rankChangeTrend.length > 0 || summary.newKeywordsTrend.length > 0 || summary.effectivenessRows.length > 0

      if (!hasData) {
        siteAnalyses.push({ site_id: site.id, domain: site.domain, name: site.name, skipped: true, skip_reason: '这段时间没有抓到任何数据', analysis: null, error: null })
        console.log(`[research-report] ${site.domain} 跳过（无数据）`)
      } else {
        const prompt = buildSiteAnalysisPrompt(site, summary, periodStart, periodEnd)
        geminiCallCount++
        const { result, error } = await callGeminiJSON<{ analysis: string }>(prompt, { maxOutputTokens: 1024 })
        if (result) {
          siteAnalyses.push({ site_id: site.id, domain: site.domain, name: site.name, skipped: false, skip_reason: null, analysis: result.analysis, error: null })
          console.log(`[research-report] ${site.domain} 分析完成`)
        } else {
          geminiFailCount++
          siteAnalyses.push({ site_id: site.id, domain: site.domain, name: site.name, skipped: false, skip_reason: null, analysis: null, error: error || 'AI 分析失败' })
          console.log(`[research-report] ${site.domain} 分析失败: ${error}`)
        }
        await delay(4000)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      siteAnalyses.push({ site_id: site.id, domain: site.domain, name: site.name, skipped: false, skip_reason: null, analysis: null, error: `数据拉取失败: ${msg}` })
      console.log(`[research-report] ${site.domain} 数据拉取失败: ${msg}`)
    }

    // 每个站点跑完立刻写回 DB——中途断了也不会丢已经跑完的部分。
    await supabase.from('weekly_research_reports').update({
      site_analyses: siteAnalyses,
      sites_considered: siteList.length,
      sites_analyzed: siteAnalyses.filter(s => !s.skipped && s.analysis).length,
      sites_skipped: siteAnalyses.filter(s => s.skipped).length,
      gemini_call_count: geminiCallCount,
      gemini_fail_count: geminiFailCount,
    }).eq('id', reportId)
  }

  // 自己团队成效——组数少，不单独占一次 Stage1 AI 调用，原始数据直接留到 Stage2。
  const { data: groups } = await supabase.from('task_groups').select('id, name')
  const ownTeamAnalyses = []
  for (const group of (groups ?? []) as { id: string; name: string }[]) {
    const s = await fetchGroupEffectivenessSummary(supabase, group.id, periodStart, periodEnd)
    ownTeamAnalyses.push({ group_id: group.id, group_name: group.name, summary: { ranked: s.ranked, indexed: s.indexed, tracking: s.tracking, invalid: s.invalid }, top_claims: s.topClaims })
  }

  // 大环境输入——这一周 environment_segments_daily + environment_daily 全部行，
  // 存进 environment_input 做历史快照（不依赖以后这两张表算法有没有变过）。
  const [{ data: envDaily }, { data: envSegments }] = await Promise.all([
    supabase.from('environment_daily').select('*').gte('date', periodStart).lte('date', periodEnd).order('date'),
    supabase.from('environment_segments_daily').select('*').gte('date', periodStart).lte('date', periodEnd).order('date'),
  ])
  const environmentInput = { daily: envDaily ?? [], segments: envSegments ?? [] }

  await supabase.from('weekly_research_reports').update({ own_team_analyses: ownTeamAnalyses, environment_input: environmentInput }).eq('id', reportId)

  // Stage 2：一次调用综合全部输入。
  const envDailyText = (envDaily ?? []).map((d: { date: string; avg_index_change_pct: number | null; total_rankup: number; total_rankdown: number; is_school_holiday: boolean; is_holiday: boolean; crawl_anomaly: boolean }) =>
    `${d.date}${d.is_school_holiday ? '(学生假期)' : ''}${d.is_holiday ? '(法定节假日)' : ''}${d.crawl_anomaly ? '(疑似漏抓)' : ''}:收录中位数变化${d.avg_index_change_pct ?? '无数据'}%/涨${d.total_rankup}跌${d.total_rankdown}`
  ).join('；') || '无数据'

  const envSegmentsText = (envSegments ?? []).map((s: { date: string; dimension: string; segment: string; site_count: number; avg_index_change_pct: number | null; deviation_pct: number | null; is_anomaly: boolean }) =>
    `${s.date} [${s.dimension}=${s.segment}] ${s.site_count}站:变化${s.avg_index_change_pct ?? '无'}%(偏离大盘${s.deviation_pct ?? '无'}个百分点)${s.is_anomaly ? '⚠异常' : ''}`
  ).join('\n') || '无数据'

  const siteAnalysesText = siteAnalyses
    .filter(s => !s.skipped && s.analysis)
    .map(s => `【${s.domain}（${s.name}）】\n${s.analysis}`)
    .join('\n\n') || '（本周没有站点产出有效分析）'

  const ownTeamText = ownTeamAnalyses.map(g =>
    `【${g.group_name}】获取排名${g.summary.ranked} / 获取收录${g.summary.indexed} / 追踪中${g.summary.tracking} / 无效${g.summary.invalid}\n表现最好的词：${g.top_claims.slice(0, 10).map(c => `${c.keyword}(第${c.rank_position ?? '未排名'}名/量${c.volume}/分${c.score})`).join('、') || '无'}`
  ).join('\n\n') || '（没有分组任务数据）'

  const stage2Prompt = `你是 SEO Monitor 的首席分析师，每周综合全站数据写一份报告。以下是这一周（${periodStart} 至 ${periodEnd}）的全部输入，请仔细阅读后写出三段报告。

【大环境·每日大盘】
${envDailyText}

【大环境·分段数据（体量档位/内容侧重两个维度，跟大盘中位数的偏离）】
${envSegmentsText}

【各站点AI分析（已经通读过每个站点完整原始数据后写的分析，不是原始数字）】
${siteAnalysesText}

【自己团队成效（各分组任务的排名/收录成效，含表现最好的词）】
${ownTeamText}

请写三段内容：
1. environment：大环境这一周怎么样，哪些站点/分段持续变化值得注意（权重上涨要连续多天才算数，别把单日跳动当成真上涨）。如果这周数据平淡没有值得说的，直接说"这周大环境平稳，没有明显异动"，不要硬编内容。
2. effectiveness：自己团队和各站点的成效情况，哪些词/站点表现突出。没有可靠数据就说没有，不要编。
3. conclusion：综合结论，尝试对表现突出的站点给出可能的原因假设（比如是不是暑假效应、是不是某类内容验证有效），并指出如果有成效数据支撑，是哪些具体关键词驱动的。没有把握的假设要说清楚"推测"，不要说得像确定的事实。

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "environment": "中文，300-600字",
  "effectiveness": "中文，300-600字",
  "conclusion": "中文，300-600字"
}`

  const { result: stage2Result, error: stage2Error } = await callGeminiJSON<{ environment: string; effectiveness: string; conclusion: string }>(stage2Prompt, { maxOutputTokens: 8192 })

  const durationMs = Date.now() - startedAt

  if (!stage2Result) {
    await supabase.from('weekly_research_reports').update({ status: 'failed', error: stage2Error || 'Stage2 综合分析失败' }).eq('id', reportId)
    console.error('[research-report] Stage2 失败:', stage2Error)
    if (activityId) await activityEnd(supabase, activityId, { status: 'fail', durationMs, summary: `Stage2失败: ${stage2Error}` })
    process.exit(1)
  }

  await supabase.from('weekly_research_reports').update({
    status: 'completed',
    report_sections: stage2Result,
    completed_at: new Date().toISOString(),
  }).eq('id', reportId)

  console.log(`[research-report] 完成，报告ID=${reportId}，耗时${Math.round(durationMs / 1000)}s`)
  if (activityId) {
    await activityEnd(supabase, activityId, {
      status: geminiFailCount > 0 ? 'warn' : 'done',
      ok: siteAnalyses.filter(s => !s.skipped && s.analysis).length,
      skip: siteAnalyses.filter(s => s.skipped).length,
      fail: geminiFailCount,
      durationMs,
      summary: `${periodStart}~${periodEnd}，${siteList.length}站点，${geminiCallCount}次AI调用，${geminiFailCount}次失败`,
    })
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
