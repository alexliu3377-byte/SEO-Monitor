export interface TapTapSearchTrendItem {
  rank: number
  name: string
  labels: string[]
  source: 'TapTap'
}

export function parseTapTapSearchTrends(html: string): TapTapSearchTrendItem[] {
  const renderedItems: TapTapSearchTrendItem[] = []
  const anchorPattern =
    /class="[^"]*tap-hot-search-item__wrapper[^"]*"[^>]+href="\/search\/([^"?]+)|href="\/search\/([^"?]+)"[^>]*class="[^"]*tap-hot-search-item__wrapper/g
  let match: RegExpExecArray | null
  while ((match = anchorPattern.exec(html)) !== null) {
    if (renderedItems.length >= 20) break
    const encoded = match[1] ?? match[2]
    if (!encoded) continue
    let name = encoded
    try { name = decodeURIComponent(encoded) } catch { /* keep the original text */ }
    const anchorStart = html.lastIndexOf('<a ', match.index)
    const anchorEnd = html.indexOf('</a>', match.index) + 4
    const anchorHtml = anchorStart >= 0 && anchorEnd > anchorStart ? html.slice(anchorStart, anchorEnd) : ''
    const labels: string[] = []
    if (/活动/.test(anchorHtml)) labels.push('活动')
    if (/首发/.test(anchorHtml)) labels.push('首发')
    if (/UP/.test(anchorHtml)) labels.push('上升')
    renderedItems.push({ rank: renderedItems.length + 1, name, labels, source: 'TapTap' })
  }

  const serializedItems: string[] = []
  const hotIndex = html.indexOf('"hot_search"')
  if (hotIndex >= 0) {
    const chunk = html.slice(hotIndex, hotIndex + 8_000)
    const serviceMatches = Array.from(chunk.matchAll(/"service=[^"]*scenes=[^"]*"/g))
    for (let index = 0; index < serviceMatches.length && index < 20; index++) {
      const start = index === 0 ? 0 : (serviceMatches[index - 1].index ?? 0) + serviceMatches[index - 1][0].length
      const end = serviceMatches[index].index ?? start
      const quoted = Array.from(chunk.slice(start, end).matchAll(/"([^"]+)"/g)).map((item) => item[1])
      serializedItems.push(quoted.reverse().find((value) => /[^\x00-\x7F]/.test(value)) ?? '')
    }
  }

  const items: TapTapSearchTrendItem[] = []
  for (let rank = 1; rank <= 20; rank++) {
    const rendered = renderedItems[rank - 1]
    const serialized = serializedItems[rank - 1]
    if (rendered) items.push(rendered)
    else if (serialized) items.push({ rank, name: serialized, labels: [], source: 'TapTap' })
  }
  return items
}
