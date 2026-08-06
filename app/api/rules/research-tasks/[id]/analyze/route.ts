import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { callGeminiJSON } from '@/lib/gemini'
import { computeOutcomeScore } from '@/lib/outcome-score'

export const maxDuration = 60

// 站点研究任务的 AI 分析——跟旧的 ai-suggest（全站聚合数据+聊天式问答）不同，
// 这里只喂"这一个站点、这段时间"的历史数据 + 人工补充的定性信息（为什么监控它/
// 内容分类/发布方式/新增或更新为主），让 AI 针对这一个站点做具体分析，
// 而不是对全站数据做泛泛猜测。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { data: task, error: taskErr } = await service.from('site_research_tasks').select('*').eq('id', id).single()
  if (taskErr || !task) return NextResponse.json({ error: '研究任务不存在' }, { status: 404 })
  const { data: site } = await service.from('sites').select('*').eq('id', task.site_id).single()
  if (!site) return NextResponse.json({ error: '站点不存在' }, { status: 404 })

  const { date_start, date_end } = task as { date_start: string; date_end: string }

  const [{ data: weightRows }, { data: indexRows }, { data: rankChangeRows }, { data: rankRows }, { data: rawKwRows }] = await Promise.all([
    service.from('weight_history').select('record_date, pc_weight, mobile_weight')
      .eq('site_id', site.id).gte('record_date', date_start).lte('record_date', date_end).order('record_date'),
    service.from('index_snapshots').select('snapshot_date, index_count')
      .eq('site_id', site.id).gte('snapshot_date', date_start).lte('snapshot_date', date_end).order('snapshot_date'),
    service.from('rank_changes').select('stat_date, type')
      .eq('site_id', site.id).gte('stat_date', date_start).lte('stat_date', date_end).limit(20000),
    // 排名成效直接用 site_keyword_ranks（keyword+具体第几名+搜索量），跳过
    // "是不是新增页面"这层归因——那需要 raw_keywords.source_url 匹配，多数
    // 竞品站点还没配文章链接选择器，这条路径本来就走不通。
    service.from('site_keyword_ranks').select('keyword, stat_date, rank_position, prev_rank, volume')
      .eq('site_id', site.id).eq('platform', 'mobile').gte('stat_date', date_start).lte('stat_date', date_end)
      .order('stat_date', { ascending: false })
      .limit(20000),
    service.from('raw_keywords').select('content_date, content_type')
      .eq('site_id', site.id).gte('content_date', date_start).lte('content_date', date_end).limit(20000),
  ])

  const weight = (weightRows ?? []) as { record_date: string; pc_weight: number; mobile_weight: number }[]
  const index = (indexRows ?? []) as { snapshot_date: string; index_count: number }[]
  const rankChanges = (rankChangeRows ?? []) as { stat_date: string; type: string }[]
  const rawKw = (rawKwRows ?? []) as { content_date: string | null; content_type: string }[]

  // 每个关键词只留最新一天的快照
  const seenKw = new Set<string>()
  const latestRanks = ((rankRows ?? []) as { keyword: string; stat_date: string; rank_position: number | null; prev_rank: number | null; volume: number }[])
    .filter(r => { if (seenKw.has(r.keyword)) return false; seenKw.add(r.keyword); return true })
  const ranked = latestRanks.filter(r => r.rank_position != null)

  // 搜索量上涨交叉引用，跟主详情接口（route.ts）同一个逻辑
  const volumeTrendMap = new Map<string, { volume_change: number }>()
  const rankedKeywords = ranked.map(r => r.keyword)
  for (let i = 0; i < rankedKeywords.length; i += 150) {
    const { data: kv } = await service.from('keyword_volume').select('keyword, volume_change')
      .in('keyword', rankedKeywords.slice(i, i + 150))
    for (const k of (kv ?? []) as { keyword: string; volume_change: number }[]) volumeTrendMap.set(k.keyword, k)
  }

  // 用户反馈"资料太多人力分析很难"——目的就是让AI把人工看不完的量都吃下去，
  // 不是只挑几十条给它看意思意思。这里不做"总结再总结"，尽量把明细摊开：
  // 权重/收录/涨跌/新增按天列出（不是只给首尾两个点），排名词给全量列表
  // （按分数排序，2000条封顶——真遇到比这更多的站点，prompt本身也快到
  // 模型上下文的实际可用上限了，且这个量级已经远超"精选30条"的旧版）。
  const weightDaily = weight.map(w => `${w.record_date}:PC${w.pc_weight}/移动${w.mobile_weight}`).join('；') || '无数据'
  const indexDaily = index.map(i => `${i.snapshot_date}:${i.index_count}`).join('；') || '无数据'

  const rankChangeByDate = new Map<string, { up: number; down: number }>()
  for (const r of rankChanges) {
    if (!rankChangeByDate.has(r.stat_date)) rankChangeByDate.set(r.stat_date, { up: 0, down: 0 })
    const d = rankChangeByDate.get(r.stat_date)!
    if (r.type === 'rankup') d.up++; else if (r.type === 'rankdown') d.down++
  }
  const rankChangeDaily = Array.from(rankChangeByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => `${date}:涨${d.up}/跌${d.down}`).join('；') || '无数据'

  const newKwByDate = new Map<string, { app: number; game: number }>()
  for (const r of rawKw) {
    if (!r.content_date) continue
    if (!newKwByDate.has(r.content_date)) newKwByDate.set(r.content_date, { app: 0, game: 0 })
    const d = newKwByDate.get(r.content_date)!
    if (r.content_type === 'game') d.game++; else d.app++
  }
  const newKwDaily = Array.from(newKwByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => `${date}:应用${d.app}/游戏${d.game}`).join('；') || '无数据'

  const RANKED_CAP = 2000
  const rankedScored = ranked.map(r => {
    const rankChange = (r.rank_position != null && r.prev_rank != null) ? r.prev_rank - r.rank_position : null
    return { ...r, score: computeOutcomeScore(r.rank_position, true, rankChange, r.volume), rising: (volumeTrendMap.get(r.keyword)?.volume_change ?? 0) > 0 }
  }).sort((a, b) => b.score - a.score)
  const rankedList = rankedScored.slice(0, RANKED_CAP)
    .map(r => `${r.keyword}(第${r.rank_position}名/量${r.volume}/分${r.score}${r.rising ? '/🔥需求涨' : ''})`).join('、')
  const rankedTruncatedNote = rankedScored.length > RANKED_CAP ? `（只列了得分最高的${RANKED_CAP}个，实际共${rankedScored.length}个）` : ''

  const prompt = `你是 SEO Monitor 的站点研究助手，专注于百度SEO策略分析。下面是这一个竞品站点、这一段时间的完整监控明细，数据量可能很大——这正是需要你帮忙的地方：人工很难逐条看完这些数据找规律，请你通读全部明细后提炼出人工不容易发现的规律或异常点，不要只说"权重涨了/词多了"这种表面结论。

站点：${site.domain}（${site.name}）
研究时间范围：${date_start} 至 ${date_end}

【人工补充的背景信息】
为什么监控这个站点：${site.research_notes || '（未填写）'}
游戏分类：${(site.game_categories || []).join('、') || '（未填写）'}
应用分类：${(site.app_categories || []).join('、') || '（未填写）'}
发布方式：${site.publish_mode === 'auto' ? '自动发布' : site.publish_mode === 'manual' ? '手动发布' : '（未填写）'}${site.publish_interval_notes ? `，${site.publish_interval_notes}` : ''}
内容侧重：${site.content_focus === 'new' ? '新增为主' : site.content_focus === 'update' ? '更新为主' : site.content_focus === 'mixed' ? '新增更新都有' : '（未填写）'}

【权重每日明细】
${weightDaily}

【收录量每日明细】
${indexDaily}

【涨跌词每日明细】
${rankChangeDaily}

【新增关键词每日明细（应用/游戏）】
${newKwDaily}

【排名关键词全量列表${rankedTruncatedNote}，按得分从高到低，括号内为排名/搜索量/得分，🔥表示这个词的搜索量本身同期也在涨】
共${rankedScored.length}个排名中的词。
${rankedList || '无'}

请结合背景信息和以上全部明细，分析这个站点的SEO策略可能是什么、为什么有效/无效，找出数据里的时间关联（比如某天权重/收录突然变化，前后有没有对应的关键词或涨跌词波动），并判断这是否是一个可以总结成规则的可复制模式。

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "analysis": "分析结论（中文，200-400字，要具体到这个站点的实际情况，结合人工补充的背景信息）",
  "has_candidate_rule": true 或 false,
  "candidate_rule": {
    "name": "规则名称（中文，20字内，has_candidate_rule=false时可为空字符串）",
    "type": "add 或 update 或 mixed",
    "description": "触发条件→执行动作→预期效果（中文，50-120字）",
    "confidence": 0-100的整数
  }
}`

  const { result, error } = await callGeminiJSON<{
    analysis: string
    has_candidate_rule: boolean
    candidate_rule: { name: string; type: string; description: string; confidence: number }
  }>(prompt, { maxOutputTokens: 1024 })

  if (!result) return NextResponse.json({ error: error || 'AI 分析失败' }, { status: 500 })

  const candidateRule = result.has_candidate_rule ? result.candidate_rule : null
  await service.from('site_research_tasks')
    .update({ ai_analysis: result.analysis, ai_candidate_rule: candidateRule })
    .eq('id', id)

  return NextResponse.json({ ai_analysis: result.analysis, ai_candidate_rule: candidateRule })
}
