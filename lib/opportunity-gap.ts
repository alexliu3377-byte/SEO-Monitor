import { fetchCompetitorWinningKeywords, type CompetitorWinningKeyword } from '@/lib/competitor-effectiveness'
import { fetchOwnCoveredKeywordSet } from '@/lib/tracking-summary'

export type GapKeyword = CompetitorWinningKeyword

export interface OpportunityGapResult {
  gaps: GapKeyword[]
  competitorTotalCount: number
}

// 研究报告"机会缺口"——竞品这段时间真正拿到效果、但我方历史上完全没做过的
// 词。"是否零覆盖"是纯事实判断，代码里做精确字符串比对（不靠AI去对比两份
// 清单，容易漏判/误判）；聚类成词群、判优先级、给建议留给 Stage2 的 AI。
// 竞品侧按周期（这期真的赢了什么），我方侧不按周期、看全历史（几个月前
// 做过、现在还在排名的词依然算已覆盖，不该因为这期没提交就被判成缺口）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeOpportunityGaps(service: any, dateStart: string, dateEnd: string): Promise<OpportunityGapResult> {
  const [{ keywords: competitorWinning, totalCount }, ownSet] = await Promise.all([
    fetchCompetitorWinningKeywords(service, dateStart, dateEnd),
    fetchOwnCoveredKeywordSet(service),
  ])

  const gaps = competitorWinning
    .filter(k => !ownSet.has(k.keyword.trim()))
    .sort((a, b) => b.volume - a.volume)

  return { gaps, competitorTotalCount: totalCount }
}
