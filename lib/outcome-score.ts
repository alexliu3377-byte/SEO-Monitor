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

// 前端"得分"点开的解释弹窗、以及 computeOutcomeScore 本身都基于这一个函数，
// 保证展示出来的每一步数字跟实际用于统计的总分是同一套计算，不会对不上。
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
