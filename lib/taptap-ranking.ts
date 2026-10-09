import { load } from 'cheerio'

export type TapTapRankingItem = {
  rank: number
  name: string
  labels: string[]
  url: string | null
}

type JsonLdListItem = {
  position?: unknown
  name?: unknown
  url?: unknown
}

type JsonLdItemList = {
  '@type'?: unknown
  name?: unknown
  itemListElement?: unknown
}

function asItemLists(value: unknown): JsonLdItemList[] {
  if (Array.isArray(value)) return value.flatMap(asItemLists)
  if (!value || typeof value !== 'object') return []

  const record = value as Record<string, unknown>
  const current = record['@type'] === 'ItemList' ? [record as JsonLdItemList] : []
  const graph = Array.isArray(record['@graph']) ? record['@graph'].flatMap(asItemLists) : []
  return [...current, ...graph]
}

export function parseTapTapPopularRankingHtml(html: string): TapTapRankingItem[] {
  const $ = load(html)
  const lists: JsonLdItemList[] = []

  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      lists.push(...asItemLists(JSON.parse($(element).text())))
    } catch {
      // Ignore unrelated or temporarily malformed structured data blocks.
    }
  })

  const popularList = lists.find((list) => list.name === '热门榜')
    ?? lists.find((list) => Array.isArray(list.itemListElement))
  if (!popularList || !Array.isArray(popularList.itemListElement)) return []

  return popularList.itemListElement
    .map((raw, index): TapTapRankingItem | null => {
      if (!raw || typeof raw !== 'object') return null
      const item = raw as JsonLdListItem
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!name) return null

      const parsedPosition = Number(item.position)
      return {
        rank: Number.isInteger(parsedPosition) && parsedPosition > 0 ? parsedPosition : index + 1,
        name,
        labels: [],
        url: typeof item.url === 'string' ? item.url : null,
      }
    })
    .filter((item): item is TapTapRankingItem => item !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 20)
}
