import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { callGeminiJSON } from '@/lib/gemini'

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

  const [{ data: weightRows }, { data: indexRows }, { data: rankChangeRows }, { data: rankRows }] = await Promise.all([
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
  ])

  const weight = (weightRows ?? []) as { record_date: string; pc_weight: number; mobile_weight: number }[]
  const index = (indexRows ?? []) as { snapshot_date: string; index_count: number }[]
  const rankChanges = (rankChangeRows ?? []) as { stat_date: string; type: string }[]

  // 每个关键词只留最新一天的快照
  const seenKw = new Set<string>()
  const latestRanks = ((rankRows ?? []) as { keyword: string; stat_date: string; rank_position: number | null; prev_rank: number | null; volume: number }[])
    .filter(r => { if (seenKw.has(r.keyword)) return false; seenKw.add(r.keyword); return true })

  const weightSummary = weight.length > 0
    ? `${weight[0].record_date}（PC${weight[0].pc_weight}/移动${weight[0].mobile_weight}）→ ${weight[weight.length - 1].record_date}（PC${weight[weight.length - 1].pc_weight}/移动${weight[weight.length - 1].mobile_weight}）`
    : '无数据'
  const indexSummary = index.length > 0
    ? `${index[0].snapshot_date}（${index[0].index_count}）→ ${index[index.length - 1].snapshot_date}（${index[index.length - 1].index_count}）`
    : '无数据'
  const rankupCount = rankChanges.filter(r => r.type === 'rankup').length
  const rankdownCount = rankChanges.filter(r => r.type === 'rankdown').length
  const ranked = latestRanks.filter(r => r.rank_position != null)
  const topRanked = ranked
    .sort((a, b) => (a.rank_position ?? 999) - (b.rank_position ?? 999))
    .slice(0, 30)
    .map(t => `${t.keyword}(第${t.rank_position}名/搜索量${t.volume})`).join('、')

  const prompt = `你是 SEO Monitor 的站点研究助手，专注于百度SEO策略分析。请针对下面这一个竞品站点、这一段时间的数据做具体分析，不要给泛泛而谈的建议。

站点：${site.domain}（${site.name}）
研究时间范围：${date_start} 至 ${date_end}

【人工补充的背景信息】
为什么监控这个站点：${site.research_notes || '（未填写）'}
游戏分类：${(site.game_categories || []).join('、') || '（未填写）'}
应用分类：${(site.app_categories || []).join('、') || '（未填写）'}
发布方式：${site.publish_mode === 'auto' ? '自动发布' : site.publish_mode === 'manual' ? '手动发布' : '（未填写）'}${site.publish_interval_notes ? `，${site.publish_interval_notes}` : ''}
内容侧重：${site.content_focus === 'new' ? '新增为主' : site.content_focus === 'update' ? '更新为主' : site.content_focus === 'mixed' ? '新增更新都有' : '（未填写）'}

【系统监控到的数据】
权重变化：${weightSummary}
收录量变化：${indexSummary}
涨跌词：涨入${rankupCount}次，跌出${rankdownCount}次
排名中的关键词：共${ranked.length}个
排名靠前的词（部分，括号内为排名/搜索量）：${topRanked || '无'}

请结合背景信息和监控数据，分析这个站点的SEO策略可能是什么、为什么有效/无效，并判断这是否是一个可以总结成规则的可复制模式。

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
