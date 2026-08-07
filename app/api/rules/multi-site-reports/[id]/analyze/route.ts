import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchSiteResearchSummary } from '@/lib/site-research-summary'
import { callGeminiJSON } from '@/lib/gemini'

// 2026-08-07 用户明确要求"不要压缩成摘要，我要全部资料都跑一遍，可以让他
// 慢慢运行"——所以这里不做"先摘要再给AI"，而是照搬单站点研究任务
// （app/api/rules/research-tasks/[id]/analyze/route.ts）那种"按天全量列出+
// 排名词全量列表"的喂法，只是现在对每个选中的站点都摊开一份，拼成一个大
// prompt一次性给AI通读。maxDuration 拉到跟 cron.ts 一样的项目里最高值
// （300秒），因为用户接受"慢"，不需要为了赶时间牺牲数据完整度。
export const maxDuration = 300

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { data: report, error: reportErr } = await service.from('multi_site_research_reports').select('*').eq('id', id).single()
  if (reportErr || !report) return NextResponse.json({ error: '报告不存在' }, { status: 404 })

  const { date_start, date_end, site_ids } = report as { date_start: string; date_end: string; site_ids: string[] }

  const { data: sitesRaw } = await service.from('sites').select('id, domain, name, has_rank_data, has_rank_title').in('id', site_ids)
  const sites = (sitesRaw ?? []) as { id: string; domain: string; name: string; has_rank_data: boolean; has_rank_title: boolean }[]

  function trendDirection(values: number[]): string {
    if (values.length < 2) return '数据不足'
    const first = values[0], last = values[values.length - 1]
    if (first === 0) return last > 0 ? '从0新增' : '持平'
    const pct = (last - first) / first * 100
    if (pct > 5) return `上涨${Math.round(pct)}%`
    if (pct < -5) return `下跌${Math.round(pct * -1)}%`
    return '持平'
  }

  // 单个站点全量数据能摊多大都不封顶的话，10个站点一起可能直接把 prompt
  // 撑爆模型的上下文上限（不是"省钱"考虑，是真的会报错/被截断）——每站
  // 排名词列表还是留一个安全上限，比单站点研究任务的2000低一些（那边只有
  // 一个站点，这边最多10个站点共享一个prompt）。
  const RANKED_CAP_PER_SITE = 1200

  const siteBlocks: string[] = []
  const siteDigests: {
    domain: string; name: string; hasRankData: boolean; hasRankTitle: boolean
    weightTrend: string; indexTrend: string; totalRankup: number; totalRankdown: number
    totalNewApp: number; totalNewGame: number; topKeywordsCount: number; topKeywords: string[]
  }[] = []

  for (const site of sites) {
    const summary = await fetchSiteResearchSummary(service, site.id, date_start, date_end)

    const weightDaily = summary.weightTrend.map(w => `${w.record_date}:PC${w.pc_weight}/移动${w.mobile_weight}`).join('；') || '无数据'
    const indexDaily = summary.indexTrend.map(i => `${i.snapshot_date}:${i.index_count}`).join('；') || '无数据'
    const rankChangeDaily = summary.rankChangeTrend.map(r => `${r.date}:涨${r.rankup}/跌${r.rankdown}`).join('；') || '无数据'
    const newKwDaily = summary.newKeywordsTrend.map(r => `${r.date}:应用${r.app}/游戏${r.game}`).join('；') || '无数据'

    const rankedRows = summary.effectivenessRows.filter(r => r.score != null)
    const rankedList = rankedRows.slice(0, RANKED_CAP_PER_SITE)
      .map(r => `${r.keyword}(第${r.rank_position}名/量${r.volume}/分${r.score}${r.searchVolumeRising ? '/🔥需求涨' : ''})`).join('、')
    const rankedNote = rankedRows.length > RANKED_CAP_PER_SITE ? `（只列了得分最高的${RANKED_CAP_PER_SITE}个，实际共${rankedRows.length}个）` : ''

    siteBlocks.push(`════════ 站点：${site.domain}（${site.name}） ════════
排名数据情况：${!site.has_rank_data && !site.has_rank_title ? '这段时间没开涨跌/排名抓取，以下排名相关明细缺失，只看权重/收录/新增内容' : site.has_rank_title ? '有具体排名位置' : '只有涨跌方向，没有具体名次'}

【权重每日明细】${weightDaily}
【收录量每日明细】${indexDaily}
【涨跌词每日明细】${rankChangeDaily}
【新增关键词每日明细（应用/游戏）】${newKwDaily}
【排名关键词全量列表${rankedNote}，按得分从高到低，括号内为排名/搜索量/得分，🔥表示这个词搜索量本身同期也在涨】
共${rankedRows.length}个排名中的词。
${rankedList || '无'}`)

    const weightSeries = summary.weightTrend.map(w => w.pc_weight + w.mobile_weight)
    const indexSeries = summary.indexTrend.map(i => i.index_count)
    siteDigests.push({
      domain: site.domain,
      name: site.name,
      hasRankData: site.has_rank_data,
      hasRankTitle: site.has_rank_title,
      weightTrend: trendDirection(weightSeries),
      indexTrend: trendDirection(indexSeries),
      totalRankup: summary.rankChangeTrend.reduce((s, r) => s + r.rankup, 0),
      totalRankdown: summary.rankChangeTrend.reduce((s, r) => s + r.rankdown, 0),
      totalNewApp: summary.newKeywordsTrend.reduce((s, r) => s + r.app, 0),
      totalNewGame: summary.newKeywordsTrend.reduce((s, r) => s + r.game, 0),
      topKeywordsCount: rankedRows.length,
      topKeywords: rankedRows.slice(0, 8).map(r => `${r.keyword}(第${r.rank_position}名/分${r.score})`),
    })
  }

  const prompt = `你是 SEO Monitor 的多站点研究助手，专注于百度SEO策略分析。下面是${sites.length}个竞品站点在同一段时间（${date_start} 至 ${date_end}）的完整监控明细——每个站点的数据都是全量的，不是精选摘要，数据量会很大，这正是需要你帮忙的地方：人工没办法同时通读这么多站点的完整明细找规律，请你逐个站点仔细看完全部明细后，做跨站点综合分析，不要只逐个站点复述数据。

${siteBlocks.join('\n\n')}

请基于以上${sites.length}个站点的完整明细，回答：
1. 这几个站点有没有共同的规律或同步的异动（比如都在同一段时间涨/跌、某类内容在多个站点都在增长）
2. 有没有明显跟大多数站点不一样的站点，可能是什么原因
3. 给一条具体、可执行的结论（比如"XX类内容近期在多个站点都验证有效，值得跟进"，或"XX时间点多个站点同时下跌，怀疑是大盘/算法层面的事而不是单个站点的问题"）

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "synthesis": "跨站点综合分析结论（中文，600-1000字，要具体引用数据里的站点名/关键词/日期，不要空泛）"
}`

  const { result, error } = await callGeminiJSON<{ synthesis: string }>(prompt, { maxOutputTokens: 4096 })
  if (!result) return NextResponse.json({ error: error || 'AI 分析失败' }, { status: 500 })

  const { error: saveErr } = await service.from('multi_site_research_reports')
    .update({ site_digests: siteDigests, cross_site_synthesis: result.synthesis })
    .eq('id', id)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ site_digests: siteDigests, cross_site_synthesis: result.synthesis })
}
