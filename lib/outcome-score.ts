// 排名的"价值"不是档位本身决定的，而是档位 × 这个词的搜索量——同样排第5，
// 搜索量20万的词价值远高于搜索量50的词，之前纯档位加分体现不出这个差距。
// 用 log10 压缩搜索量的量级跨度（10/100/1000/10000 大致对应权重2/3/4/5），
// 避免给搜索量本身另外分档、以后又要反复调整档位边界。
// 收录只是排名的前置门槛，不再单独占大头分数。
// 排名变化不对称：上涨代表优化生效值得奖励，下跌很多时候只是自然波动
// （搜索引擎刷新/竞品更新/地域差异），惩罚力度明显小于同等幅度的上涨奖励。
// 不再封顶 100 分——四块纯累加，分数越高代表这个词创造的流量价值越大。
// 2026-08-04：整套常量按用户要求整体 ÷10（原100/80/60/40/20/10/20/15/10/-2/
// -5/-10/-15 → 10/8/6/4/2/1/2/1.5/1/-0.2/-0.5/-1/-1.5），单条累计总分从原本
// 常见几百、月度汇总几千，缩到单条几十、月度汇总几百——原因是"总分"是累加
// 制，做得越多的老员工数字天然越大，新人一比容易觉得遥不可及；单纯缩小常量
// 不能消除这个比例差距，但能让绝对数字看起来没那么吓人。分数因此允许带一位
// 小数（Math.round(...*10)/10），不再强制整数。
//
// 这套公式代表"关键词价值"（资产视角）——不管是谁在什么时候做的，这个词现在
// 值多少钱。'新增'型claim（新内容拿到排名/收录）用这套就够了，问的问题本来
// 就是"这个新东西值不值钱"。'更新'型claim不再用这套（见下面 explainUpdateEffectScore
// ——2026-08-14 曾经在这里给'更新'按档位打折，仍然是在按当前绝对值发钱，只是
// 发得少一点；2026-08-14 当天二次修正，改成完全独立的"增量视角"公式，这里的
// 函数不再感知 operationType，纯粹只回答"这个词现在值多少钱"）。

export interface OutcomeScoreBreakdown {
  rankPos: number | null
  rankVolume: number | null
  isIndexed: boolean
  rankChange: number | null
  rankScore: number
  volumeWeight: number
  baseValue: number
  indexScore: number
  changeScore: number
  total: number
}

export function explainOutcomeScore(
  rankPos: number | null,
  isIndexed: boolean,
  rankChange: number | null,
  rankVolume: number | null
): OutcomeScoreBreakdown {
  let rankScore = 0
  if (rankPos != null) {
    if (rankPos <= 3) rankScore = 10
    else if (rankPos <= 10) rankScore = 8
    else if (rankPos <= 20) rankScore = 6
    else if (rankPos <= 30) rankScore = 4
    else rankScore = 2
  }
  // 没排上名时排名量不产生价值——避免"没排名但搜索量很大"被误算出一截分数。
  const volumeWeight = rankPos != null ? 1 + Math.log10((rankVolume ?? 0) + 1) : 0
  const baseValue = rankScore * volumeWeight

  const indexScore = isIndexed ? 1 : 0

  let changeScore = 0
  if (rankChange != null) {
    if (rankChange > 20) changeScore = 2
    else if (rankChange >= 10) changeScore = 1.5
    else if (rankChange >= 1) changeScore = 1
    else if (rankChange >= -5) changeScore = rankChange === 0 ? 0 : -0.2
    else if (rankChange >= -10) changeScore = -0.5
    else if (rankChange >= -20) changeScore = -1
    else changeScore = -1.5
  }

  const total = Math.round((baseValue + indexScore + changeScore) * 10) / 10
  return { rankPos, rankVolume, isIndexed, rankChange, rankScore, volumeWeight, baseValue, indexScore, changeScore, total }
}

export function computeOutcomeScore(
  rankPos: number | null,
  isIndexed: boolean,
  rankChange: number | null,
  rankVolume: number | null
): number {
  return explainOutcomeScore(rankPos, isIndexed, rankChange, rankVolume).total
}

// ---------------------------------------------------------------------------
// "更新"型claim的增量评分（2026-08-14）
//
// 'baseValue×档位打折'这条老路（见上面头部注释）本质上还是在按"这个词现在
// 排第几"发钱，只是发得少一点——一个词稳定在第22名、这次"更新"完全没让它
// 变化，靠打折也还能拿3分。用户和ChatGPT讨论后指出：'更新'该问的问题是
// "这次操作比操作前多创造了多少增量"，不是"这个词现在值多少钱"（那是'新增'
// 该问的问题，资产视角，见上面 explainOutcomeScore）。
//
// 新公式：更新成效分 = (排名提升分 + 跨档奖励) × 搜索量系数 + 收录确认分
// 搜索量系数是乘数不是加法——没有真实提升时排名提升分是0，乘以任何系数还是
// 0，高搜索量的词不该无中生有出分数。
//
// "真新排名"判断需要真实历史（site_keyword_ranks 按URL查这个词之前有没有
// 排过名），不能只看 prev_rank_position 是否为null——为null可能是"这个词真
// 的从没排过名"，也可能只是"这条claim刚开始追踪、还没攒够前一天数据"。调用方
// 负责用 fetchFirstRankedDates 查出真实历史再传 isNewRank 进来（成效追踪主表
// 这么做）；月度汇总/规则中心等次要页面为了省一次批量查询，直接传 isNewRank:
// false（保守当"非提升"处理，见各调用点注释）。

// site_keyword_ranks.url 存的是带协议、有时带斜杠的完整URL，这里跟
// app/api/cron/route.ts、scripts/crawl.ts 里已有的同名函数逻辑一致（这两处
// 也各自维护了一份，是这个项目对这类小型纯函数一贯的处理方式，不为了共享
// 三次调用去抽公共 lib）。
function bareUrl(url: string): string {
  return url.replace(/^(https?:\/\/)?(www\.|m\.)?/i, '').replace(/\/$/, '')
}
function urlSubdomainVariants(url: string): string[] {
  const bare = bareUrl(url)
  const hosts = [bare, `www.${bare}`, `m.${bare}`]
  const variants = new Set<string>()
  for (const host of hosts) {
    for (const proto of ['', 'http://', 'https://']) {
      variants.add(`${proto}${host}`)
      variants.add(`${proto}${host}/`)
    }
  }
  return Array.from(variants)
}
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// 批量查一批URL各自"第一次真的排上名"是哪天——用于区分"真新排名"和"这条
// claim刚开始追踪、只是还没攒够前一天数据"。返回值按 bareUrl(url) 做key。
// 只需要对 prev_rank_position 为null的行调用（有真实prev_rank_position的行
// 已经证明不是新的，不用查）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchFirstRankedDates(service: any, urls: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const bareUrls = Array.from(new Set(urls.filter(Boolean).map(bareUrl)))
  if (bareUrls.length === 0) return result
  const allVariants = bareUrls.flatMap(urlSubdomainVariants)
  for (const chunk of chunkArray(allVariants, 150)) {
    const { data } = await service
      .from('site_keyword_ranks')
      .select('url, stat_date')
      .in('url', chunk)
      .not('rank_position', 'is', null)
      .eq('platform', 'mobile')
    for (const r of (data ?? []) as { url: string; stat_date: string }[]) {
      const key = bareUrl(r.url)
      const existing = result.get(key)
      if (!existing || r.stat_date < existing) result.set(key, r.stat_date)
    }
  }
  return result
}

// 供调用方（成效追踪接口）用同一套URL归一化逻辑算lookup key，避免自己再重
// 复实现一遍、跟这里的key不一致导致查了也匹配不上。
export { bareUrl }

type RankTier = 'other' | 'top30' | 'top20' | 'top10' | 'top3'
const TIER_ORDER: RankTier[] = ['other', 'top30', 'top20', 'top10', 'top3']
function tierOf(pos: number): RankTier {
  if (pos <= 3) return 'top3'
  if (pos <= 10) return 'top10'
  if (pos <= 20) return 'top20'
  if (pos <= 30) return 'top30'
  return 'other'
}
const TIER_CROSS_BONUS: Record<string, number> = {
  'other>top30': 2,
  'top30>top20': 3,
  'top20>top10': 5,
  'top10>top3': 6,
}
// 跨档奖励——一次涨幅跨过几个档位就把沿途每一段的奖励都加上（比如直接从
// 40名冲进前3，等于把 other→top30→top20→top10→top3 沿途全部走一遍）。
function tierCrossingBonus(prevPos: number, newPos: number): number {
  const prevIdx = TIER_ORDER.indexOf(tierOf(prevPos))
  const newIdx = TIER_ORDER.indexOf(tierOf(newPos))
  if (newIdx <= prevIdx) return 0
  let bonus = 0
  for (let i = prevIdx; i < newIdx; i++) bonus += TIER_CROSS_BONUS[`${TIER_ORDER[i]}>${TIER_ORDER[i + 1]}`] ?? 0
  return bonus
}

function newRankLiftScore(pos: number): number {
  if (pos <= 3) return 30
  if (pos <= 10) return 22
  if (pos <= 20) return 16
  if (pos <= 30) return 12
  if (pos <= 50) return 8
  return 4
}
function deltaRankLiftScore(rankChange: number): number {
  if (rankChange >= 20) return 15
  if (rankChange >= 10) return 10
  if (rankChange >= 5) return 6
  if (rankChange >= 1) return 3
  return 0
}
function volumeMultiplierFor(volume: number): number {
  if (volume >= 5000) return 1.4
  if (volume >= 1000) return 1.25
  if (volume >= 500) return 1.1
  if (volume >= 100) return 1.0
  return 0.8
}

export interface UpdateEffectBreakdown {
  rankPos: number | null
  prevRankPos: number | null
  rankVolume: number | null
  rankChange: number | null
  isNewRank: boolean
  rankLiftScore: number
  tierBonus: number
  volumeMultiplier: number
  indexConfirmScore: number
  keywordValue: number
  total: number
}

export function explainUpdateEffectScore(params: {
  rankPos: number | null
  prevRankPos: number | null
  rankVolume: number | null
  isIndexed: boolean
  indexFirstSeen: string | null
  submitDate: string
  isNewRank: boolean
}): UpdateEffectBreakdown {
  const { rankPos, prevRankPos, rankVolume, isIndexed, indexFirstSeen, submitDate, isNewRank } = params
  const rankChange = (rankPos != null && prevRankPos != null) ? prevRankPos - rankPos : null

  let rankLiftScore = 0
  let tierBonus = 0
  if (rankPos != null) {
    if (isNewRank) {
      // 真新排名档位分本身已经反映了排到多好，不再叠加跨档奖励，避免重复计分。
      rankLiftScore = newRankLiftScore(rankPos)
    } else if (rankChange != null && rankChange > 0) {
      rankLiftScore = deltaRankLiftScore(rankChange)
      tierBonus = tierCrossingBonus(prevRankPos!, rankPos)
    }
    // rankChange <= 0（含持平、下跌）或者 prevRankPos为null又不是真新排名
    // （数据没攒够，简化版调用方走这条）：排名提升分=0——这是本次改动最核心
    // 的一条，彻底解决"没提升也能拿分"。
  }

  const volumeMultiplier = volumeMultiplierFor(rankVolume ?? 0)

  // 这次claim期间URL真的新收录了（之前没收录、这次首次出现，或者压根没有
  // 更早的收录记录）才给分；本来就收录着的（indexFirstSeen早于submitDate）
  // 不算这次更新的功劳，给0。
  const indexConfirmScore = isIndexed && (indexFirstSeen == null || indexFirstSeen >= submitDate) ? 2 : 0

  // 参考数字："这个词现在值多少钱"（资产视角，不含涨跌分），跟"这次更新有没有
  // 用"分开展示，不混在一个数字里。
  const keywordValue = explainOutcomeScore(rankPos, isIndexed, null, rankVolume).total

  const total = Math.round(((rankLiftScore + tierBonus) * volumeMultiplier + indexConfirmScore) * 10) / 10

  return { rankPos, prevRankPos, rankVolume, rankChange, isNewRank, rankLiftScore, tierBonus, volumeMultiplier, indexConfirmScore, keywordValue, total }
}
