import type { SiteResearchSummary } from '@/lib/site-research-summary'
import type { EnvironmentStats } from '@/lib/environment-stats'
import type { WeightTier } from '@/lib/weight-tiers'
import type { GroupEffectivenessSummary } from '@/lib/tracking-summary'
import type { GapKeyword } from '@/lib/opportunity-gap'
import { classifyContentCategory } from '@/lib/content-category'

// 研究中心"站点诊断"——用户自由提问（不用先选站点），AI自己从问题文本里识别
// 提到了哪些站点（0个=纯"大环境"问题、1个=单站诊断、多个=跨站点找规律），读
// 完整历史数据后写一份策略建议。2026-08-11 新增，跟同一批"结构化数字先行"的
// 周报/月报/年报刻意反着来：那边是用户被动收到定时报告，要求AI只写
// 100-200字点评、数字都摆在页面上；这边是用户主动发起、愿意等，就应该让
// AI写得更完整、更有可执行性，不追求短。
//
// 2026-08-12 跟着研究报告v1一起补两处：① 排名词列表原本跟旧版 Stage1 一样
// 把 prev_rank/volume_change 压成一个"🔥需求涨"布尔标记，现在原样暴露真实
// 涨跌数字，AI能引用具体涨了多少名；② 接入 lib/opportunity-gap.ts 的机会
// 缺口——这个功能本来就是回答"这个站该做什么"这类问题，机会缺口正是"市场
// 在赢什么、我们没做什么"的直接依据。缺口是portfolio-wide算出来的，不跟
// 具体站点绑定，所以喂给AI后明确要求它自己判断哪些词群跟对应站点的内容
// 调性搭（不是无脑照单全收）。
//
// 2026-08-27 从"必须先选一个站点"改成自由提问、支持多站点一起分析——真实
// 用户反馈：问了一个不是自己运营的参考站点（sj.zol.com.cn），AI却建议"人手
// 安排"，因为旧版prompt从头到尾都假设"用户在评估要不要投入资源经营这个
// 站点"。这版按 isOwnSite 严格区分措辞：自己的站点（task_groups.site_domains
// 里能找到）才谈资源投入/人手安排；非自己的站点只能是"行业参考对比"，明确
// 禁止给它任何内部运营建议。多站点时额外要求AI找跨站点共同规律（"大环境"
// 判断，比如"这几个下滑的站点都偏科只做应用，说明游戏内容更重要"这类洞察）。

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

export interface DiagnosticSiteEntry {
  site: SiteConfig
  isOwnSite: boolean
  summary: SiteResearchSummary
  siteTier: WeightTier | null
  groups: GroupInfo[] // 只有 isOwnSite=true 时才会有内容
}

// 单站点时排名词列表给足2000个上限；多站点时按比例收紧，避免prompt随站点数
// 线性爆炸——用户一次问5、6个站点很正常，每个站点还给2000个会让prompt巨大
// 又贵又慢。
function rankedListCapFor(siteCount: number): number {
  if (siteCount <= 1) return 2000
  return 300
}

function renderSiteBlock(entry: DiagnosticSiteEntry, cap: number): string {
  const { site, isOwnSite, summary, siteTier } = entry
  const weightDaily = summary.weightTrend.map(w => `${w.record_date}:PC${w.pc_weight}/移动${w.mobile_weight}`).join('；') || '无数据'
  const indexDaily = summary.indexTrend.map(i => `${i.snapshot_date}:${i.index_count}`).join('；') || '无数据'
  const rankChangeDaily = summary.rankChangeTrend.map(r => `${r.date}:涨${r.rankup}/跌${r.rankdown}`).join('；') || '无数据'
  const newKwDaily = summary.newKeywordsTrend.map(r => `${r.date}:应用${r.app}/游戏${r.game}`).join('；') || '无数据'

  const rankedRows = summary.effectivenessRows.filter(r => r.score != null)
  const rankedList = rankedRows.slice(0, cap)
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
  const rankedTruncatedNote = rankedRows.length > cap ? `（只列了得分最高的${cap}个，实际共${rankedRows.length}个）` : ''

  const tierStats = siteTier ? `属于「${siteTier}」档位` : '算不出所属档位（可能最新一天没有权重数据）'

  const ownershipNote = isOwnSite
    ? '【这是你自己运营的站点】可以谈资源投入/人手安排/要不要调整分组任务安排。'
    : '【这不是你自己运营的站点，只是行业参考/对比对象】不要给任何"该找人做""该投入资源"这类内部运营建议——只能从它的表现里提炼行业观察（比如"同类站点最近都在往哪个方向发力"），当成外部市场信号来用。'

  const groupsText = isOwnSite
    ? (entry.groups.length > 0
        ? entry.groups.map(g => `【${g.group_name}】${g.memberCount}名组员，累计获取排名${g.ranked} / 获取收录${g.indexed} / 追踪中${g.tracking} / 无效${g.invalid}${g.ranked + g.indexed + g.tracking + g.invalid === 0 ? '（这个组目前完全没有任何提交记录）' : ''}`).join('\n')
        : '（这个站点目前没有关联任何分组任务——组员没法在分组任务里认领词去做这个站点）')
    : '（非自己运营站点，不适用分组任务概念，不展示）'

  return `
### 站点：${site.domain}（${site.name}）
${ownershipNote}
配置：关键词抓取${site.is_enabled ? '开启' : '❌已关闭（这段时间新内容不会被自动发现）'}；排名追踪${site.has_rank_data ? '开启' : '关闭'}；竞品追踪${site.has_rank_title ? '开启' : '关闭'}；收录监控${site.has_index_pages ? '开启' : '关闭'}；关注级别${site.focus_level}；${tierStats}

权重每日明细：${weightDaily}
收录量每日明细：${indexDaily}
涨跌词每日明细：${rankChangeDaily}
新增关键词每日明细（应用/游戏，自动发现非组员提交）：${newKwDaily}
排名关键词列表${rankedTruncatedNote}（括号内：排名/较上期变化/搜索量/得分/内容分类），共${rankedRows.length}个：${rankedList || '无'}
${isOwnSite ? `关联分组任务团队现状：\n${groupsText}` : groupsText}`
}

export function buildDiagnosticPrompt(
  entries: DiagnosticSiteEntry[],
  unmatchedDomains: string[],
  envStats: EnvironmentStats | null,
  gaps: GapKeyword[],
  question: string,
  dateStart: string,
  dateEnd: string
): string {
  const cap = rankedListCapFor(entries.length)
  const siteBlocks = entries.map(e => renderSiteBlock(e, cap)).join('\n')

  const envText = envStats
    ? `截至${envStats.asOfDate}，全站整体：PC权重${envStats.overall.pcWeight ?? '无'}/移动权重${envStats.overall.mobileWeight ?? '无'}/平均收录${envStats.overall.indexCount ?? '无'}。分档位：大站PC权重${envStats.tiers.大站.pcWeight ?? '无'}/移动权重${envStats.tiers.大站.mobileWeight ?? '无'}（${envStats.tiers.大站.siteCount}个）；中站PC权重${envStats.tiers.中站.pcWeight ?? '无'}/移动权重${envStats.tiers.中站.mobileWeight ?? '无'}（${envStats.tiers.中站.siteCount}个）；小站PC权重${envStats.tiers.小站.pcWeight ?? '无'}/移动权重${envStats.tiers.小站.mobileWeight ?? '无'}（${envStats.tiers.小站.siteCount}个）。`
    : '（暂时算不出大环境对比数据，可能是全站权重快照缺失）'

  const GAP_CAP = 200
  const gapsText = gaps.length > 0
    ? gaps.slice(0, GAP_CAP).map(k => `${k.keyword}(${k.domain}/第${k.rank_position}名/量${k.volume}/${k.content_type === 'game' ? '游戏' : '应用'}/发布于${k.content_date ?? '未知'})`).join('、')
      + (gaps.length > GAP_CAP ? `（只列了搜索量最高的${GAP_CAP}个，实际共${gaps.length}个）` : '')
    : '（这段时间没有发现竞品明显领先但我方全公司零覆盖的词）'

  const unmatchedNote = unmatchedDomains.length > 0
    ? `\n【提到但系统里没有追踪的域名】${unmatchedDomains.join('、')}——这些不在系统里，没有历史数据，请直接说明"未追踪，如需要请先去网站管理里添加"，不要凭空编造这些站点的数据。`
    : ''

  const structureGuide = entries.length === 0
    ? `请只用【大环境对比】和【市场机会参考】回答用户的问题，不涉及具体某个站点。`
    : entries.length === 1
      ? `请按以下结构写：
1. 现状评估：这个站点目前处于什么状态（权重/收录趋势、有没有持续维护的迹象、跟同档位站点比怎么样）
2. 关键发现：从数据里看出的具体信号
3. 具体建议：结合站点的own/reference身份给出对应类型的建议（自己的站点给可执行动作；非自己的站点只给市场判断，不给内部运营动作）`
      : `这次用户一次问了${entries.length}个站点，请按以下结构写：
1. 逐站点分析：每个站点各自的现状+关键发现（自己的站点和非自己的站点用不同措辞，见上面每个站点条目里的说明）
2. 综合规律/大环境判断：这几个站点放在一起看，有没有共同的模式或反差（比如"下滑的几个站点都偏科只做应用，可能说明游戏内容最近更吃香"这类跨站点洞察）——这是用户最想要的部分，务必认真给
3. 建议：自己的站点给可执行动作；非自己的站点只给市场判断，不给内部运营动作`

  return `你是奇心内容发布系统的首席策略顾问，用户直接向你提问（不一定针对某个具体站点，可能是关于一个站点、多个站点、或整体行情的问题），需要你读完相关历史数据后给出详细、具体、可执行的分析——用户愿意花时间看完整分析，请尽量详细、有理有据，每条判断都要能看出是从哪条数据推出来的，不要写空话套话。严格区分"自己运营的站点"和"行业参考站点"两种身份，绝对不要对非自己运营的站点提任何内部运营/人手安排建议。

用户的问题：「${question.trim()}」

数据统计时间范围：${dateStart} 至 ${dateEnd}

【大环境对比】
${envText}

【市场机会参考——这段时间其它竞品站点真正拿到效果、但我方全公司历史上都没做过的词，按搜索量从高到低】
${gapsText}
${unmatchedNote}
${siteBlocks}

${structureGuide}

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "diagnosis": "完整的分析内容（中文，包含上面的结构，可以有几百到一两千字，具体取决于数据丰富程度和站点数量，数据少就写短一点不要硬凑）"
}`
}
