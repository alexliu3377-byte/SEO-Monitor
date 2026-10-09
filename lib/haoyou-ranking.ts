import * as cheerio from 'cheerio'

export interface HaoyouPopularItem {
  rank: number
  name: string
  tags: string[]
  score: string
  url: string
}

export interface SearchTrendItem {
  rank: number
  name: string
  url: string
  source: '好游快爆'
}

function absoluteUrl(value: string): string {
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('//')) return `https:${value}`
  return `https://www.3839.com${value.startsWith('/') ? '' : '/'}${value}`
}

export function parseHaoyouSearchTrends(html: string): SearchTrendItem[] {
  const $ = cheerio.load(html)
  const items: SearchTrendItem[] = []
  $('#header_hot_search .list li a').each((_, element) => {
    if (items.length >= 20) return false
    const name = $(element).text().replace(/\s+/g, ' ').trim()
    if (!name) return
    items.push({
      rank: items.length + 1,
      name,
      url: absoluteUrl($(element).attr('href') ?? ''),
      source: '好游快爆',
    })
  })
  return items
}

export function parseHaoyouPopularRanking(html: string): HaoyouPopularItem[] {
  const $ = cheerio.load(html)
  const items: HaoyouPopularItem[] = []

  $('.game-item').each((_, element) => {
    if (items.length >= 20) return false
    const row = $(element)
    const purchaseText = `${row.find('[data-price-gid]').text()} ${row.find('.sp-tag').text()}`
    if (row.find('[data-price-gid]').length > 0 || /付费|买断|预购/.test(purchaseText)) return

    const name = row.find('.sp-name').first().text().replace(/\s+/g, ' ').trim()
    if (!name) return
    const rank = Number.parseInt(row.find('.item-num').first().text().trim(), 10)
    const href = row.find('.item-con').attr('data-url') ?? row.find('a[href]').first().attr('href') ?? ''
    items.push({
      rank: Number.isFinite(rank) && rank > 0 ? rank : items.length + 1,
      name,
      tags: row.find('.sp-tags span').map((__, tag) => $(tag).text().trim()).get().filter(Boolean).slice(0, 3),
      score: row.find('.sp-score').first().text().trim(),
      url: absoluteUrl(href),
    })
  })

  return items
}
