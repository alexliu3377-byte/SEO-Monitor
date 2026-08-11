import type { SiteResearchSummary } from '@/lib/site-research-summary'
import type { EnvironmentStats } from '@/lib/environment-stats'
import type { WeightTier } from '@/lib/weight-tiers'
import type { GroupEffectivenessSummary } from '@/lib/tracking-summary'

// 研究中心"站点诊断"——用户主动选一个站点、可以带一个具体问题，AI读完整
// 历史数据后写一份策略建议。2026-08-11 新增，跟同一批"结构化数字先行"的
// 周报/月报/年报刻意反着来：那边是用户被动收到定时报告，要求AI只写
// 100-200字点评、数字都摆在页面上；这边是用户主动发起、愿意等，就应该让
// AI写得更完整、更有可执行性，不追求短。

interface SiteConfig {
  domain: string
  name: string
  is_enabled: boolean
  has_rank_data: boolean
  has_rank_title: boolean
  has_index_pages: boolean
  focus_level: number
}

interface GroupInfo extends GroupEffectivenessSummary {
  group_name: string
  memberCount: number
}

export function buildSiteDiagnosticPrompt(
  site: SiteConfig,
  summary: SiteResearchSummary,
  dateStart: string,
  dateEnd: string,
  envStats: EnvironmentStats | null,
  siteTier: WeightTier | null,
  groups: GroupInfo[],
  question: string | null
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

  const tierStats = envStats && siteTier ? envStats.tiers[siteTier] : null
  const envText = envStats
    ? `截至${envStats.asOfDate}，全站整体：PC权重${envStats.overall.pcWeight ?? '无'}/移动权重${envStats.overall.mobileWeight ?? '无'}/平均收录${envStats.overall.indexCount ?? '无'}。` +
      (siteTier && tierStats
        ? `这个站点自己算出来属于「${siteTier}」档位，同档位站点（${tierStats.siteCount}个）平均：PC权重${tierStats.pcWeight ?? '无'}/移动权重${tierStats.mobileWeight ?? '无'}/平均收录${tierStats.indexCount ?? '无'}——把这个站点自己最新一天的权重/收录（见下面权重每日明细最后一条）跟同档位均值比一比，能看出是明显偏低、持平还是偏高。`
        : '这个站点算不出所属档位（可能最新一天没有权重数据）。')
    : '（暂时算不出大环境对比数据，可能是全站权重快照缺失）'

  const groupsText = groups.length > 0
    ? groups.map(g => `【${g.group_name}】${g.memberCount}名组员，累计获取排名${g.ranked} / 获取收录${g.indexed} / 追踪中${g.tracking} / 无效${g.invalid}${g.ranked + g.indexed + g.tracking + g.invalid === 0 ? '（这个组目前完全没有任何提交记录）' : ''}`).join('\n')
    : '（这个站点目前没有关联任何分组任务——组员没法在分组任务里认领词去做这个站点）'

  const questionBlock = question && question.trim()
    ? `用户的具体问题：「${question.trim()}」\n请重点回答这个问题，结合下面的历史数据给出具体、可执行的建议，不要只给泛泛而谈的通用建议。`
    : '用户没有填具体问题，请做通用诊断：这个站点目前的内容/排名/收录现状如何、有没有被闲置或明显缺人维护的迹象、接下来最值得优先做的2-3件事是什么。'

  return `你是 SEO Monitor 的首席策略顾问，用户正在评估要不要重新投入资源经营这个站点，需要你读完这个站点的完整历史数据后给出一份详细、具体、可执行的策略建议——这次不需要写得短，用户愿意花时间看完整分析，请尽量详细、有理有据，每条建议都要能看出是从哪条数据推出来的，不要写空话套话。

站点：${site.domain}（${site.name}）
数据统计时间范围：${dateStart} 至 ${dateEnd}
当前抓取配置：关键词数据抓取${site.is_enabled ? '开启' : '❌已关闭（这段时间新内容不会被自动发现）'}；排名追踪${site.has_rank_data ? '开启' : '关闭'}；竞品追踪${site.has_rank_title ? '开启' : '关闭'}；收录监控${site.has_index_pages ? '开启' : '关闭'}；关注级别${site.focus_level}

【大环境对比】
${envText}

【权重每日明细】
${weightDaily}

【收录量每日明细】
${indexDaily}

【涨跌词每日明细】
${rankChangeDaily}

【新增关键词每日明细（应用/游戏，来自自动发现，不是组员提交）】
${newKwDaily}

【排名关键词全量列表${rankedTruncatedNote}，按得分从高到低，括号内为排名/搜索量/得分，🔥表示这个词的搜索量本身同期也在涨】
共${rankedRows.length}个排名中的词。
${rankedList || '无'}

【关联分组任务团队现状——组员实际提交内容的追踪结果，反映"有没有人在做、做得怎么样"】
${groupsText}

${questionBlock}

请按以下结构写（用中文，段落之间空一行）：
1. 现状评估：这个站点目前处于什么状态（权重/收录趋势、有没有持续维护的迹象、跟同档位站点比怎么样）
2. 关键发现：从数据里看出的具体信号（比如某类内容排名效果好/差、某个时间点开始明显停滞、团队提交跟实际效果的差距）
3. 具体建议：接下来应该做什么，如果用户问了具体问题要在这里重点回答，建议要具体到"做什么/为什么/预期效果"，不要空泛

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "diagnosis": "完整的诊断内容（中文，包含上面三段结构，可以有几百到一千多字，具体取决于这个站点数据的丰富程度，数据少就写短一点不要硬凑）"
}`
}
