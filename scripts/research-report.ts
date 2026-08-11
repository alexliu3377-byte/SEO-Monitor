import { createClient } from '@supabase/supabase-js'
import { activityStart, activityEnd } from '../lib/activity-log'
import { fetchSiteResearchSummary, type SiteResearchSummary } from '../lib/site-research-summary'
import { buildSiteAnalysisPrompt } from '../lib/site-research-prompt'
import { fetchCompetitorEffectivenessSummary } from '../lib/competitor-effectiveness'
import { fetchGroupEffectivenessSummary } from '../lib/tracking-summary'
import { computeEnvironmentStats } from '../lib/environment-stats'
import { callGeminiJSON } from '../lib/gemini'

// 研究报告——GitHub Actions 直接跑（不经过 Vercel）。周报/月报/年报共用这一套
// 两段式AI逻辑，只是 periodStart/periodEnd 跨度不同。
//
// 三个模式，对应 workflow 的 setup → 并行 Stage1 分片 → 汇总 Stage2 三段：
//   --mode=init                                创建/复用 research_reports 行，打印 REPORT_ID
//   --mode=stage1 --report-id= --shard= --shard-total=   处理分给这个分片的站点，写入 research_report_sites（每站点一行，
//                                               分片并行写不会互相覆盖——这是跟旧版单进程 JSONB 数组最大的区别，
//                                               2026-08-07 发现年报量级单进程顺序跑推算要7+小时，
//                                               超过 GitHub Actions 单 job 6 小时硬上限，改成分片）
//   --mode=stage2 --report-id=                 汇总所有分片的 research_report_sites + 竞品成效 + 大环境，跑最终综合
//   不传 --mode（本地手动测试用）依次跑 init→stage1(单分片)→stage2，等价于旧版单进程顺序跑
//
// 见 CLAUDE.md 要求：改动抓取规则要同步 lib/crawl-rules.ts，这个脚本本身不是
// "抓取"，写的是 research_reports/research_report_sites 表，已在该文件加了章节。

type PeriodType = 'week' | 'month' | 'year'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

function arg(args: string[], name: string): string | undefined {
  return args.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
}

// 默认周期，按 period_type 分三种：
// - week：上周一~上周日
// - month：上个月1号~最后一天（今天8月1号跑 → 覆盖7月）
// - year：去年1月1号~12月31号（今天2027-01-01跑 → 覆盖2026全年）
function defaultPeriod(periodType: PeriodType): { start: string; end: string } {
  const today = new Date(Date.now() + 8 * 3600000)

  if (periodType === 'week') {
    const weekday = today.getUTCDay() // 0=周日
    const daysSinceMonday = weekday === 0 ? 6 : weekday - 1
    const thisMonday = new Date(today.getTime() - daysSinceMonday * 86400000)
    const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000)
    const lastSunday = new Date(thisMonday.getTime() - 1 * 86400000)
    return { start: lastMonday.toISOString().slice(0, 10), end: lastSunday.toISOString().slice(0, 10) }
  }

  if (periodType === 'month') {
    const y = today.getUTCFullYear(); const m = today.getUTCMonth() // 0-indexed，当前月
    const prevMonthDate = new Date(Date.UTC(y, m - 1, 1))
    const py = prevMonthDate.getUTCFullYear(); const pm = prevMonthDate.getUTCMonth()
    const lastDay = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate()
    return { start: `${py}-${pad2(pm + 1)}-01`, end: `${py}-${pad2(pm + 1)}-${pad2(lastDay)}` }
  }

  // year
  const py = today.getUTCFullYear() - 1
  return { start: `${py}-01-01`, end: `${py}-12-31` }
}

interface ReportRow {
  id: string
  period_type: PeriodType
  period_start: string
  period_end: string
}

// 各站点分析页面要展示的结构化数字（权重/收录/移动IP）——2026-08-10 用户
// 要求先摆数字再看AI的简短说明，不用AI在文字里重复这些数字。summary 里
// 已经有这段时间的 weightTrend/indexTrend 全量数据，顺手算，不用再查一次。
function computeSiteStats(summary: SiteResearchSummary) {
  const lastWeight = summary.weightTrend[summary.weightTrend.length - 1]
  const avg = (vals: number[]) => vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  return {
    pc_weight: lastWeight?.pc_weight ?? null,
    mobile_weight: lastWeight?.mobile_weight ?? null,
    avg_index_count: avg(summary.indexTrend.map(i => i.index_count)),
    avg_mobile_ip: avg(summary.weightTrend.map(w => ((w.mobile_ip ?? 0) + (w.mobile_ip_max ?? 0)) / 2)),
  }
}

async function loadReport(reportId: string): Promise<ReportRow> {
  const { data, error } = await supabase.from('research_reports')
    .select('id, period_type, period_start, period_end').eq('id', reportId).single()
  if (error || !data) throw new Error(`报告 ${reportId} 不存在: ${error?.message}`)
  return data as ReportRow
}

// ── init：创建/复用报告行 ────────────────────────────────────────────────

async function runInit(args: string[]) {
  const periodTypeArg = arg(args, 'period-type')
  const periodType: PeriodType = (periodTypeArg === 'month' || periodTypeArg === 'year') ? periodTypeArg : 'week'
  const periodStart = arg(args, 'period-start') || defaultPeriod(periodType).start
  const periodEnd = arg(args, 'period-end') || defaultPeriod(periodType).end

  const { data: existing } = await supabase.from('research_reports')
    .select('id').eq('period_type', periodType).eq('period_start', periodStart).eq('period_end', periodEnd)
    .maybeSingle()

  let reportId: string
  if (existing) {
    reportId = existing.id
    await supabase.from('research_reports').update({ status: 'running', error: null }).eq('id', reportId)
    console.log(`[init] 复用已有报告 ${reportId}`)
  } else {
    const { data: inserted, error } = await supabase.from('research_reports')
      .insert({ period_type: periodType, period_start: periodStart, period_end: periodEnd, status: 'running' })
      .select('id').single()
    if (error || !inserted) { console.error('[init] 创建失败:', error?.message); process.exit(1) }
    reportId = inserted.id
    console.log(`[init] 新建报告 ${reportId}`)
  }

  console.log(`[init] ${periodType} 周期 ${periodStart} ~ ${periodEnd}`)
  console.log(`REPORT_ID=${reportId}`)
  return reportId
}

// ── stage1：处理分给这个分片的站点，逐个写入 research_report_sites ──────────

async function runStage1(reportId: string, shard: number, shardTotal: number) {
  const report = await loadReport(reportId)
  const activityId = await activityStart(supabase, {
    type: 'cron_task', source: 'github_actions', step: `research-report-${report.period_type}-stage1`,
  })
  const startedAt = Date.now()

  const { data: sites } = await supabase.from('sites').select('id, domain, name').eq('is_enabled', true).order('id')
  const siteList = ((sites ?? []) as { id: string; domain: string; name: string }[])
    .filter((_, i) => i % shardTotal === shard)
  console.log(`[stage1] 分片 ${shard}/${shardTotal}：${siteList.length} 个站点`)

  const { data: doneRows } = await supabase.from('research_report_sites')
    .select('site_id').eq('report_id', reportId)
  const doneSiteIds = new Set((doneRows ?? []).map((r: { site_id: string }) => r.site_id))

  let geminiCallCount = 0
  let geminiFailCount = 0
  let okCount = 0
  let skipCount = 0

  for (const site of siteList) {
    if (doneSiteIds.has(site.id)) { okCount++; continue }

    // 数据拉取本身也可能失败（比如某个站点历史数据量太大导致 DB 查询超时）——
    // 跟下面的 Gemini 调用一样，单个站点的任何失败都不能让整个分片崩掉。
    try {
      const summary = await fetchSiteResearchSummary(supabase, site.id, report.period_start, report.period_end)
      const hasData = summary.weightTrend.length > 0 || summary.indexTrend.length > 0 ||
        summary.rankChangeTrend.length > 0 || summary.newKeywordsTrend.length > 0 || summary.effectivenessRows.length > 0
      const stats = computeSiteStats(summary)

      if (!hasData) {
        await supabase.from('research_report_sites').upsert({
          report_id: reportId, site_id: site.id, domain: site.domain, name: site.name,
          skipped: true, skip_reason: '这段时间没有抓到任何数据',
        }, { onConflict: 'report_id,site_id' })
        skipCount++
        console.log(`[stage1] ${site.domain} 跳过（无数据）`)
      } else {
        const prompt = buildSiteAnalysisPrompt(site, summary, report.period_start, report.period_end)
        geminiCallCount++
        const { result, error } = await callGeminiJSON<{ analysis: string }>(prompt, { maxOutputTokens: 1024 })
        if (result) {
          await supabase.from('research_report_sites').upsert({
            report_id: reportId, site_id: site.id, domain: site.domain, name: site.name,
            skipped: false, analysis: result.analysis, ...stats,
          }, { onConflict: 'report_id,site_id' })
          okCount++
          console.log(`[stage1] ${site.domain} 分析完成`)
        } else {
          geminiFailCount++
          await supabase.from('research_report_sites').upsert({
            report_id: reportId, site_id: site.id, domain: site.domain, name: site.name,
            skipped: false, error: error || 'AI 分析失败', ...stats,
          }, { onConflict: 'report_id,site_id' })
          console.log(`[stage1] ${site.domain} 分析失败: ${error}`)
        }
        await delay(4000)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await supabase.from('research_report_sites').upsert({
        report_id: reportId, site_id: site.id, domain: site.domain, name: site.name,
        skipped: false, error: `数据拉取失败: ${msg}`,
      }, { onConflict: 'report_id,site_id' })
      console.log(`[stage1] ${site.domain} 数据拉取失败: ${msg}`)
    }
  }

  const durationMs = Date.now() - startedAt
  console.log(`[stage1] 分片 ${shard}/${shardTotal} 完成，耗时${Math.round(durationMs / 1000)}s`)
  if (activityId) {
    await activityEnd(supabase, activityId, {
      status: geminiFailCount > 0 ? 'warn' : 'done',
      ok: okCount, skip: skipCount, fail: geminiFailCount, durationMs,
      summary: `分片${shard}/${shardTotal}，${siteList.length}站点，${geminiCallCount}次AI调用，${geminiFailCount}次失败`,
    })
  }
}

// ── stage2：汇总所有分片结果 + 竞品成效 + 大环境，跑最终综合 ─────────────────

async function runStage2(reportId: string) {
  const report = await loadReport(reportId)
  const { period_type: periodType, period_start: periodStart, period_end: periodEnd } = report
  const activityId = await activityStart(supabase, {
    type: 'cron_task', source: 'github_actions', step: `research-report-${periodType}-stage2`,
  })
  const startedAt = Date.now()

  const { data: siteRows } = await supabase.from('research_report_sites')
    .select('site_id, domain, name, skipped, skip_reason, analysis, error').eq('report_id', reportId)
  const siteAnalyses = (siteRows ?? []) as { site_id: string; domain: string; name: string; skipped: boolean; skip_reason: string | null; analysis: string | null; error: string | null }[]

  const { data: sites } = await supabase.from('sites').select('id').eq('is_enabled', true)
  const sitesConsidered = (sites ?? []).length

  // 竞品成效——读 competitor_tracking_records（has_rank_title=true 的竞品站点
  // 每天自动被追踪，已排除自己的站点），不单独占一次 Stage1 AI 调用，原始数据
  // 直接留到 Stage2 一起喂。
  // 自己站点成效——2026-08-07 用户要求单独拆一段，不要跟竞品混在一起，换回
  // 之前用过的分组任务（task_groups/site_tracking_records）追踪机制。
  const [competitorSummary, groups] = await Promise.all([
    fetchCompetitorEffectivenessSummary(supabase, periodStart, periodEnd),
    supabase.from('task_groups').select('id, name').then((r: { data: { id: string; name: string }[] | null }) => r.data ?? []),
  ])
  const ownSummaries = await Promise.all(
    groups.map(async (g: { id: string; name: string }) => ({
      group_id: g.id, group_name: g.name,
      ...(await fetchGroupEffectivenessSummary(supabase, g.id, periodStart, periodEnd)),
    }))
  )

  // 大环境输入——这段时间 environment_segments_daily + environment_daily 全部行，
  // 存进 environment_input 做历史快照（不依赖以后这两张表算法有没有变过）。
  const [{ data: envDaily }, { data: envSegments }] = await Promise.all([
    supabase.from('environment_daily').select('*').gte('date', periodStart).lte('date', periodEnd).order('date'),
    supabase.from('environment_segments_daily').select('*').gte('date', periodStart).lte('date', periodEnd).order('date'),
  ])
  const environmentInput = { daily: envDaily ?? [], segments: envSegments ?? [] }

  // 大环境结构化数字——2026-08-10 用户要求先摆整体+大/中/小站的权重/收录数字，
  // AI只写简短说明，不用在文字里复述这些数字。取 period_end 当天（或往前找
  // 最近一天有数据的）weight_history + index_snapshots 现算，跟AI分析完全
  // 独立、代码直接算好存库。
  const fullEnvironmentStats = await computeEnvironmentStats(supabase, periodEnd)
  // 存库只要 asOfDate/overall/tiers 这三个字段（跟页面 EnvironmentStats 类型
  // 对得上）——siteTiers 是个 Map，直接把整个对象丢给 .update() 会被
  // JSON.stringify 悄悄序列化成 {}，不能囫囵存整个返回值。
  const environmentStats = fullEnvironmentStats
    ? { asOfDate: fullEnvironmentStats.asOfDate, overall: fullEnvironmentStats.overall, tiers: fullEnvironmentStats.tiers }
    : null

  const analyzedCount = siteAnalyses.filter(s => !s.skipped && s.analysis).length
  const skippedCount = siteAnalyses.filter(s => s.skipped).length
  const failedCount = siteAnalyses.filter(s => !s.skipped && !s.analysis).length

  await supabase.from('research_reports').update({
    competitor_effectiveness: competitorSummary,
    own_effectiveness: ownSummaries,
    environment_input: environmentInput,
    environment_stats: environmentStats,
    sites_considered: sitesConsidered,
    sites_analyzed: analyzedCount,
    sites_skipped: skippedCount,
    gemini_call_count: analyzedCount + failedCount,
    gemini_fail_count: failedCount,
  }).eq('id', reportId)

  // Stage 2：一次调用综合全部输入。2026-08-10 起结构化数字（大环境/成效breakdown）
  // 都已经代码算好、直接存库展示，AI 不用在文字里复述这些数字，只写简短点评——
  // prompt 里把这些数字格式化成文本给AI参考，明确要求"数字已经摆在页面上了，
  // 只需要点重点，不要逐条复述"。
  const envDailyText = (envDaily ?? []).map((d: { date: string; avg_index_change_pct: number | null; total_rankup: number; total_rankdown: number; is_school_holiday: boolean; is_holiday: boolean; crawl_anomaly: boolean }) =>
    `${d.date}${d.is_school_holiday ? '(学生假期)' : ''}${d.is_holiday ? '(法定节假日)' : ''}${d.crawl_anomaly ? '(疑似漏抓)' : ''}:收录中位数变化${d.avg_index_change_pct ?? '无数据'}%/涨${d.total_rankup}跌${d.total_rankdown}`
  ).join('；') || '无数据'

  const envSegmentsText = (envSegments ?? []).map((s: { date: string; dimension: string; segment: string; site_count: number; avg_index_change_pct: number | null; deviation_pct: number | null; is_anomaly: boolean }) =>
    `${s.date} [${s.dimension}=${s.segment}] ${s.site_count}站:变化${s.avg_index_change_pct ?? '无'}%(偏离大盘${s.deviation_pct ?? '无'}个百分点)${s.is_anomaly ? '⚠异常' : ''}`
  ).join('\n') || '无数据'

  const envStatsText = environmentStats
    ? `截至${environmentStats.asOfDate}：整体 PC权重${environmentStats.overall.pcWeight ?? '无'}/移动权重${environmentStats.overall.mobileWeight ?? '无'}/平均收录${environmentStats.overall.indexCount ?? '无'}；` +
      (['大站', '中站', '小站'] as const).map(t => {
        const s = environmentStats.tiers[t]
        return `${t}(${s.siteCount}个)：PC权重${s.pcWeight ?? '无'}/移动权重${s.mobileWeight ?? '无'}/平均收录${s.indexCount ?? '无'}`
      }).join('；')
    : '无数据'

  const siteAnalysesText = siteAnalyses
    .filter(s => !s.skipped && s.analysis)
    .map(s => `【${s.domain}（${s.name}）】\n${s.analysis}`)
    .join('\n\n') || '（这段时间没有站点产出有效分析）'

  const competitorText = competitorSummary.topClaims.length > 0
    ? `有效${competitorSummary.effective} / 追踪中${competitorSummary.tracking} / 无效${competitorSummary.invalid}；内容类型：游戏${competitorSummary.contentBreakdown.游戏} / 应用${competitorSummary.contentBreakdown.应用}\n表现最好的竞品词：${competitorSummary.topClaims.slice(0, 10).map(c => `${c.domain}的"${c.keyword}"(第${c.rank_position}名/量${c.volume}/分${c.score})`).join('、')}`
    : '（这段时间没有竞品成效数据）'

  const ownTextByGroup = new Map<string, string>()
  for (const g of ownSummaries) {
    ownTextByGroup.set(g.group_name, g.topClaims.length > 0
      ? `获取排名${g.ranked} / 获取收录${g.indexed} / 追踪中${g.tracking} / 无效${g.invalid}；内容类型（获取排名的词）：游戏${g.contentBreakdown.游戏} / 应用${g.contentBreakdown.应用} / 专题${g.contentBreakdown.专题} / 资讯${g.contentBreakdown.资讯}\n表现最好的词：${g.topClaims.slice(0, 10).map(c => `${c.keyword}(第${c.rank_position ?? '未排名'}名/量${c.volume}/分${c.score})`).join('、') || '无'}`
      : '（这段时间没有成效数据）')
  }
  const ownText = ownSummaries.length > 0
    ? ownSummaries.map(g => `【${g.group_name}】${ownTextByGroup.get(g.group_name)}`).join('\n\n')
    : '（没有分组任务数据）'

  const periodLabel = periodType === 'week' ? '这一周' : periodType === 'month' ? '这一个月' : '这一年'
  const groupNamesForSchema = ownSummaries.map(g => `"${g.group_name}": "..."`).join(', ')

  const stage2Prompt = `你是 SEO Monitor 的首席分析师，定期综合全站数据写一份报告。页面上已经会把下面这些结构化数字直接展示出来，你不用在说明文字里逐条复述这些数字，只需要点出最值得注意的重点、异常、因果关系——简短、抓重点，不要写成大段散文。以下是${periodLabel}（${periodStart} 至 ${periodEnd}）的全部输入：

【大环境·整体+大/中/小站权重收录】
${envStatsText}

【大环境·每日大盘】
${envDailyText}

【大环境·分段数据（体量档位/内容侧重两个维度，跟大盘中位数的偏离）】
${envSegmentsText}

【各站点AI分析（已经通读过每个站点完整原始数据后写的分析，不是原始数字）】
${siteAnalysesText}

【自己站点成效（分组任务里组员提交内容的排名/收录追踪，不含竞品，按内容类型——游戏/应用/专题/资讯——分类，看得出是什么内容带来收益）】
${ownText}

【竞品成效（has_rank_title 开启追踪的竞品站点，新发现内容是否涨排名/收录，不含自己的站点）】
${competitorText}

请写以下几段内容，自己站点成效和竞品成效必须分开写，不要混在一起：
1. environmentNote：大环境${periodLabel}怎么样，哪个档位/分段的表现跟大盘不一样值得注意（权重上涨要连续多天才算数，别把单日跳动当成真上涨）。数据平淡就直接说"大环境平稳，没有明显异动"，不要硬编。
2. ownGroupNotes：**对象**，key是每个分组的名字（${groupNamesForSchema}），value是这个组的简短说明——重点说清楚这个组的收益主要是什么类型内容（游戏/应用/专题/资讯）带来的，没有可靠数据就说没有。
3. competitorNote：竞品成效情况，哪些竞品词/站点表现突出，游戏还是应用类内容更有效。没有可靠数据就说没有。
4. conclusion：综合结论——具体点出哪些站点因为什么词搜索量上升带来了收益、对比自己站点成效与竞品成效谁更好、指出这段时间"没有做到什么"所以没拿到更好的成绩。没把握的假设要说清楚"推测"，不要说得像确定的事实。可以比其它几段稍长一点，因为要做归因对比。

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "environmentNote": "中文，100-200字",
  "ownGroupNotes": { ${groupNamesForSchema || '"组名": "..."'} },
  "competitorNote": "中文，100-200字",
  "conclusion": "中文，200-350字"
}`

  const { result: stage2Result, error: stage2Error } = await callGeminiJSON<{ environmentNote: string; ownGroupNotes: Record<string, string>; competitorNote: string; conclusion: string }>(stage2Prompt, { maxOutputTokens: 8192 })

  const durationMs = Date.now() - startedAt

  if (!stage2Result) {
    await supabase.from('research_reports').update({ status: 'failed', error: stage2Error || 'Stage2 综合分析失败' }).eq('id', reportId)
    console.error('[stage2] 失败:', stage2Error)
    if (activityId) await activityEnd(supabase, activityId, { status: 'fail', durationMs, summary: `Stage2失败: ${stage2Error}` })
    process.exit(1)
  }

  await supabase.from('research_reports').update({
    status: 'completed',
    report_sections: stage2Result,
    completed_at: new Date().toISOString(),
  }).eq('id', reportId)

  console.log(`[stage2] 完成，报告ID=${reportId}，耗时${Math.round(durationMs / 1000)}s`)
  if (activityId) {
    await activityEnd(supabase, activityId, {
      status: failedCount > 0 ? 'warn' : 'done',
      ok: analyzedCount, skip: skippedCount, fail: failedCount, durationMs,
      summary: `${periodStart}~${periodEnd}，${sitesConsidered}站点，${analyzedCount}个分析成功`,
    })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const mode = arg(args, 'mode') ?? 'all'

  if (mode === 'init') { await runInit(args); return }

  if (mode === 'stage1') {
    const reportId = arg(args, 'report-id')
    const shard = Number(arg(args, 'shard') ?? '0')
    const shardTotal = Number(arg(args, 'shard-total') ?? '1')
    if (!reportId) { console.error('stage1 需要 --report-id='); process.exit(1) }
    await runStage1(reportId, shard, shardTotal)
    return
  }

  if (mode === 'stage2') {
    const reportId = arg(args, 'report-id')
    if (!reportId) { console.error('stage2 需要 --report-id='); process.exit(1) }
    // stage2 是最后一段——它崩了报告就真的没法自己完成了，不能让报告卡在
    // 'running' 状态出不来（不像 stage1 单个分片崩掉，其它分片/finalize 还能继续）。
    try {
      await runStage2(reportId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await supabase.from('research_reports').update({ status: 'failed', error: msg }).eq('id', reportId)
      throw e
    }
    return
  }

  // 'all'：本地手动测试/调试用，一个进程里依次跑完 init→单分片stage1→stage2，
  // 等价于线上 GitHub Actions 拆成的三段。
  const reportId = await runInit(args)
  await runStage1(reportId, 0, 1)
  await runStage2(reportId)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
