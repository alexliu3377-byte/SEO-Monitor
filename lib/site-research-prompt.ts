import type { SiteResearchSummary } from '@/lib/site-research-summary'
import { classifyContentCategory } from '@/lib/content-category'

// 抽自 app/api/rules/research-tasks/[id]/analyze/route.ts（该路由随规则中心重做被删除，
// 但这套"按天全量列出，不压缩"的喂法本身要继续用——scripts/research-report.ts 的 Stage 1
// 每个站点都调这个函数建 prompt）。
//
// 2026-08-12 重写：之前只让AI"点1-2个最值得注意的点"写100-200字，逼着它当
// 摘要器——排名词列表里 prev_rank/searchVolumeRising 这些delta数字，代码里
// （lib/site-research-summary.ts 的 EffectivenessRow）早就算好了，却被压成一个
// "🔥需求涨"布尔标记喂给AI，涨了多少名/多少搜索量这些真正有价值的信息在到达
// AI之前就丢了。现在把这些数字原样暴露出来，让AI找"本期真正在发力的词/词群"
// 而不是复述一段话——Stage2 综合报告要用到这里的 momentumKeywords/findings，
// 不再只读一句压缩过的summary。
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
    .map(r => {
      const rankDelta = r.rank_position != null && r.prev_rank != null ? r.prev_rank - r.rank_position : null
      const rankPart = r.prev_rank == null ? '新进榜'
        : rankDelta === 0 ? '排名不变'
        : rankDelta! > 0 ? `较上期${r.prev_rank}名升${rankDelta}` : `较上期${r.prev_rank}名降${Math.abs(rankDelta!)}`
      const vol = r.searchVolumeRising
      const volPart = vol ? `，量${vol.volume}较上期${vol.prev_volume}涨${vol.volume_change}` : `，量${r.volume}`
      const category = classifyContentCategory(r.url, r.keyword)
      return `${r.keyword}(第${r.rank_position}名/${rankPart}${volPart}/分${r.score}/${category})`
    }).join('、')
  const rankedTruncatedNote = rankedRows.length > RANKED_CAP ? `（只列了得分最高的${RANKED_CAP}个，实际共${rankedRows.length}个）` : ''

  return `你是 SEO Monitor 的站点研究员，专注于百度SEO策略分析。你的任务不是总结数据，而是从这个站点这段时间的完整监控明细里，找出真正值得研究的信号——数据量可能很大，这正是需要你帮忙的地方：人工很难逐条看完找规律。

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

【排名关键词全量列表${rankedTruncatedNote}，括号内：当前排名/较上期排名变化（新进榜=之前没有排名数据）/当前搜索量（较上期有涨的话会标出涨了多少）/综合得分/内容分类】
共${rankedRows.length}个排名中的词。
${rankedList || '无'}

请完成两件事：

1. 找出这个站本期真正在发力的词——不是简单挑得分最高的几个，而是结合"排名有没有实质提升"+"搜索量本身是否也在涨"+"是不是新进榜"综合判断。把找到的词按语义聚类成有意义的词群（自己起词群名，不要只按游戏/应用这种粗分类分组），说清楚每个词群的量级（多少个词、大致搜索量）。真正在动的词多就多列，数据平淡就少列甚至不列，不要为了凑数硬列，最多列30个。

2. 写2-5条有研究价值的发现（数量不固定，没有就明说没有），每条包含：具体观察（引用日期/数字）、你的解释、置信度（high=有明确证据支持/medium=有迹象但证据不够充分/low=只是猜测）。判断权重/收录是否"上涨"必须连续多天维持在更高水平才算数，单日跳动不算；不要仅凭两个指标同时变化就认定有因果关系，证据不足时用"可能""疑似"。

页面上已经会单独展示这个站点的权重/收录/移动IP数字，你不用复述这些数字本身。

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "summary": "分析结论（中文，100-200字，页面展示用，浓缩最值得注意的1-2个点）",
  "momentumKeywords": [
    { "keyword": "...", "cluster": "词群名", "category": "游戏|应用|专题|资讯", "rankPosition": 数字, "rankChange": 数字（正数=上升，负数=下降，新进榜填null）, "volume": 数字, "volumeChange": 数字（没有涨跌数据就填0） }
  ],
  "findings": [
    { "observation": "具体观察，引用数字", "interpretation": "你的解释", "confidence": "high|medium|low" }
  ]
}`
}
