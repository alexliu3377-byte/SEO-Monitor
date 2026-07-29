export function computeOutcomeScore(rankPos: number | null, isIndexed: boolean, rankChange: number | null): number {
  let rankScore = 0
  if (rankPos != null) {
    if (rankPos <= 3) rankScore = 60
    else if (rankPos <= 10) rankScore = 50
    else if (rankPos <= 20) rankScore = 40
    else if (rankPos <= 30) rankScore = 30
    else rankScore = 20
  }
  const indexScore = isIndexed ? 20 : 0
  let changeScore = 0
  if (rankChange != null && rankChange > 0) {
    if (rankChange > 20) changeScore = 20
    else if (rankChange >= 10) changeScore = 15
    else changeScore = 10
  }
  return rankScore + indexScore + changeScore
}
