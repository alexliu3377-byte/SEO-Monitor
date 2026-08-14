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
  updateDiscount: number | null
  total: number
}

// 2026-08-14：'更新'类型的claim之前跟'新增'用同一套算法——baseValue只看
// "现在排第几"，不看这个排名是不是这次更新带来的。漏洞：一个词已经排第15名
// （之前别的工作做上去的），随便谁隔天对同一个词+URL重新提交一条"更新"
// claim，只要排名没掉，baseValue照样按第15名满额计分——等于白捡一次高分，
// 不用管这次更新到底有没有让排名变得更好。
// 修复：'更新'类型且排名没有真的提升（rankChange不是正数，含0和null——
// null发生在这条claim第一天还没有前一天数据可比）时，baseValue按当前档位
// 打折，档位越高保留比例越高（维持住顶级排名本身也有价值，竞品也在抢），
// 档位越低保留比例越低。真的提升了（rankChange>0）不受这套折扣影响，还是
// 全额计分——这才是这个组员这次工作真正创造的价值。'新增'完全不受影响。
const UPDATE_NO_IMPROVEMENT_DISCOUNT: { max: number; keep: number }[] = [
  { max: 3, keep: 0.4 },
  { max: 10, keep: 0.3 },
  { max: 20, keep: 0.2 },
  { max: 30, keep: 0.15 },
  { max: 40, keep: 0.1 },
  { max: Infinity, keep: 0.05 },
]

function updateDiscountFor(rankPos: number): number {
  return (UPDATE_NO_IMPROVEMENT_DISCOUNT.find(b => rankPos <= b.max) ?? UPDATE_NO_IMPROVEMENT_DISCOUNT[UPDATE_NO_IMPROVEMENT_DISCOUNT.length - 1]).keep
}

// 前端"得分"点开的解释弹窗、以及 computeOutcomeScore 本身都基于这一个函数，
// 保证展示出来的每一步数字跟实际用于统计的总分是同一套计算，不会对不上。
// operationType 传 '更新' 才会触发上面的折扣判断；不传/传其它值（比如'新增'
// 或者不适用折扣逻辑的场景，如竞品追踪、研究报告里的原始排名列表）一律不打折，
// 行为跟改动前完全一致。
export function explainOutcomeScore(
  rankPos: number | null,
  isIndexed: boolean,
  rankChange: number | null,
  rankVolume: number | null,
  operationType?: string | null
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
  let baseValue = rankScore * volumeWeight

  let updateDiscount: number | null = null
  const isRealImprovement = rankChange != null && rankChange > 0
  if (operationType === '更新' && rankPos != null && !isRealImprovement) {
    updateDiscount = updateDiscountFor(rankPos)
    baseValue = Math.round(baseValue * updateDiscount * 10) / 10
  }

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
  return { rankPos, rankVolume, isIndexed, rankChange, rankScore, volumeWeight, baseValue, indexScore, changeScore, updateDiscount, total }
}

export function computeOutcomeScore(
  rankPos: number | null,
  isIndexed: boolean,
  rankChange: number | null,
  rankVolume: number | null,
  operationType?: string | null
): number {
  return explainOutcomeScore(rankPos, isIndexed, rankChange, rankVolume, operationType).total
}
