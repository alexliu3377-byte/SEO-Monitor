import * as cheerio from 'cheerio'

export type AizhanKeywordRow = { keyword: string; volume: number }

const AIZHAN_HOST = 'baidurank.aizhan.com'

export function normalizeAizhanKeywordUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.hostname !== AIZHAN_HOST || url.username || url.password || url.port) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const expIndex = parts.indexOf('exp')
    if (parts[0] !== 'mobile' || parts.length < 7 || expIndex < 3 || parts[expIndex + 1] !== '-1') return null
    if (!/^[a-z0-9.-]+$/i.test(parts[1]) || !parts[1].includes('.')) return null
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function safeNextUrl(href: string, currentUrl: string): string | null {
  try {
    const current = new URL(currentUrl)
    const next = new URL(href, current)
    const currentPrefix = current.pathname.split('/').slice(0, 3).join('/')
    if (next.protocol !== 'https:' || next.hostname !== AIZHAN_HOST || !next.pathname.startsWith(currentPrefix)) return null
    return next.toString()
  } catch {
    return null
  }
}

export function parseAizhanKeywordPage(html: string, currentUrl: string): {
  rows: AizhanKeywordRow[]
  sawZeroVolume: boolean
  nextUrl: string | null
} {
  const $ = cheerio.load(html)
  const selectedTableElement = $('table').toArray().find(table => {
    const headers = $(table).find('thead th').map((__, th) => $(th).text().replace(/\s+/g, '')).get()
    const nextKeywordIndex = headers.findIndex(text => text.includes('关键词'))
    const nextVolumeIndex = headers.findIndex(text => text.includes('搜索量') || text.includes('搜索指数'))
    return nextKeywordIndex >= 0 && nextVolumeIndex >= 0
  })

  const rows: AizhanKeywordRow[] = []
  let sawZeroVolume = false
  if (selectedTableElement) {
    const selectedTable = $(selectedTableElement)
    const headers = selectedTable.find('thead th').map((_, th) => $(th).text().replace(/\s+/g, '')).get()
    const keywordIndex = headers.findIndex(text => text.includes('关键词'))
    const volumeIndex = headers.findIndex(text => text.includes('搜索量') || text.includes('搜索指数'))
    const headerCount = selectedTable.find('thead th').length
    selectedTable.find('tbody tr').each((_, tr) => {
      const cells = $(tr).find('td')
      if (cells.length === 0) return
      // The directory cell is often row-spanned, so subsequent rows contain
      // one fewer td than the header. Shift both indexes by that leading gap.
      const leadingGap = Math.max(0, headerCount - cells.length)
      const keywordCell = cells.eq(Math.max(0, keywordIndex - leadingGap))
      const volumeCell = cells.eq(Math.max(0, volumeIndex - leadingGap))
      const keyword = (keywordCell.find('a').first().text() || keywordCell.text()).trim()
      const volumeText = volumeCell.text().replace(/,/g, '').trim()
      if (!keyword || !/^\d+$/.test(volumeText)) return
      const volume = Number.parseInt(volumeText, 10)
      if (volume <= 0) {
        sawZeroVolume = true
        return
      }
      rows.push({ keyword, volume })
    })
  }

  let nextUrl: string | null = null
  $('a').each((_, anchor) => {
    if (nextUrl) return
    const text = $(anchor).text().replace(/\s+/g, '')
    const rel = ($(anchor).attr('rel') || '').toLowerCase()
    if (!text.includes('下一页') && rel !== 'next') return
    const href = $(anchor).attr('href') || ''
    nextUrl = safeNextUrl(href, currentUrl)
  })

  return { rows, sawZeroVolume, nextUrl }
}
