import type { SiteResearchSummary } from '@/lib/site-research-summary'

// 抽自 app/api/rules/research-tasks/[id]/analyze/route.ts（该路由随规则中心重做被删除，
// 但这套"按天全量列出，不压缩"的喂法本身要继续用——scripts/research-report.ts 的 Stage 1
// 每个站点都调这个函数建 prompt）。
export function buildSiteAnalysisPrompt(
  site: { domain: string; name: string },
  summary: SiteResearchSummary,
  dateStart: string,
  dateEnd: string
): string {
  const weightDaily = summary.weightTrend.map(w => `${w.record_date}:PC${w.pc_weight}/移动${w.mobile_weight}`).join('；') || '无数据'
  const indexDaily = summary.indexTrend.map(i => `${i.snapshot_date}:${i.index_count}`).join('；') || '无数据'
  const rankChangeDaily = summary.rankChangeTrend.map(r => `${r.date}:涨${r.rankup}/跌${r.rankdown}`).join('；') || '无数据'
  const newKwDaily = summary.newKeywordsTrend.map(r => `${r.date}:应用${r.app}/游戏${r.game}`).join('；') || '无数据'

  const RANKED_CAP = 2000
  const rankedRows = summary.effectivenessRows.filter(r => r.score != null)
  const rankedList = rankedRows.slice(0, RANKED_CAP)
    .map(r => `${r.keyword}(第${r.rank_position}名/量${r.volume}/分${r.score}${r.searchVolumeRising ? '/🔥需求涨' : ''})`).join('、')
  const rankedTruncatedNote = rankedRows.length > RANKED_CAP ? `（只列了得分最高的${RANKED_CAP}个，实际共${rankedRows.length}个）` : ''

  return `你是 SEO Monitor 的站点研究助手，专注于百度SEO策略分析。下面是这一个站点、这一段时间的完整监控明细，数据量可能很大——这正是需要你帮忙的地方：人工很难逐条看完这些数据找规律，请你通读全部明细后提炼出人工不容易发现的规律或异常点，不要只说"权重涨了/词多了"这种表面结论。

站点：${site.domain}（${site.name}）
研究时间范围：${dateStart} 至 ${dateEnd}

【权重每日明细】
${weightDaily}

【收录量每日明细】
${indexDaily}

【涨跌词每日明细】
${rankChangeDaily}

【新增关键词每日明细（应用/游戏）】
${newKwDaily}

【排名关键词全量列表${rankedTruncatedNote}，按得分从高到低，括号内为排名/搜索量/得分，🔥表示这个词的搜索量本身同期也在涨】
共${rankedRows.length}个排名中的词。
${rankedList || '无'}

请特别注意：判断权重是否"上涨"时，必须要求连续多天维持在更高水平才算数——单日的跳动式波动不算真正上涨，只有稳定住了才能确定"站稳了"。收录/IP 同理，关注持续趋势而不是单点变化。

页面上已经会单独展示这个站点的权重/收录/移动IP数字，你不用在分析里重复这些数字本身，只需要通读完明细后点出1-2个最值得注意的规律/异常/可能原因，简短、抓重点，不用逐项复述。

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "analysis": "分析结论（中文，100-200字，只讲最值得注意的1-2个点，具体到这个站点的实际情况，引用具体日期/数字，不用面面俱到）"
}`
}
