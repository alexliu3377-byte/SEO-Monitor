import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'

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

export function buildAizhanKeywordPageUrl(startUrl: string, page: number): string | null {
  const normalized = normalizeAizhanKeywordUrl(startUrl)
  if (!normalized || !Number.isInteger(page) || page < 1 || page > 50) return null
  const url = new URL(normalized)
  const parts = url.pathname.split('/').filter(Boolean)
  const expIndex = parts.indexOf('exp')
  if (expIndex < 2 || !/^\d+$/.test(parts[expIndex - 1])) return null
  parts[expIndex - 1] = String(page)
  url.pathname = `/${parts.join('/')}/`
  return url.toString()
}

function tableHeaders($: cheerio.CheerioAPI, table: AnyNode): string[] {
  const tableNode = $(table)
  const explicitHeaders = tableNode.find('thead th')
  const headers = explicitHeaders.length > 0
    ? explicitHeaders
    : tableNode.find('tr').first().find('th, td')
  return headers.map((_, cell) => $(cell).text().replace(/\s+/g, '')).get()
}

export function parseAizhanKeywordPage(html: string, currentUrl: string): {
  rows: AizhanKeywordRow[]
  sawZeroVolume: boolean
  nextUrl: string | null
} {
  const $ = cheerio.load(html)
  const selectedTableElement = $('table').toArray().find(table => {
    const headers = tableHeaders($, table)
    const nextKeywordIndex = headers.findIndex(text => text.includes('关键词'))
    const nextVolumeIndex = headers.findIndex(text => text.includes('搜索量') || text.includes('搜索指数'))
    return nextKeywordIndex >= 0 && nextVolumeIndex >= 0
  })

  const rows: AizhanKeywordRow[] = []
  let sawZeroVolume = false
  if (selectedTableElement) {
    const selectedTable = $(selectedTableElement)
    const headers = tableHeaders($, selectedTableElement)
    const keywordIndex = headers.findIndex(text => text.includes('关键词'))
    const volumeIndex = headers.findIndex(text => text.includes('搜索量') || text.includes('搜索指数'))
    const headerCount = headers.length
    // Do not scope this to tbody: Aizhan nests an export dialog (with its own
    // tbody) inside the header while the actual listing rows sit directly in
    // the outer table. The rank marker below filters the listing rows safely.
    const bodyRows = selectedTable.find('tr')
    bodyRows.each((_, tr) => {
      const cells = $(tr).find('td')
      if (cells.length === 0) return
      // Aizhan's directory cell uses an unusual rowspan layout and can be
      // emitted as its own row. The stable identifiers are the destination
      // links: keyword -> Baidu search, volume -> ci.aizhan.com detail.
      const linkedKeyword = $(tr).find('a[href*="baidu.com/s"]').first()
      const linkedVolume = $(tr).find('a[href*="ci.aizhan.com"]').first()
      // The directory cell is often row-spanned, so subsequent rows contain
      // one fewer td than the header. Shift both indexes by that leading gap.
      const leadingGap = Math.max(0, headerCount - cells.length)
      const keywordCell = cells.eq(Math.max(0, keywordIndex - leadingGap))
      const volumeCell = cells.eq(Math.max(0, volumeIndex - leadingGap))
      const directTexts = cells.toArray().map(cell => $(cell).text().replace(/\s+/g, ' ').trim())
      const rankIndex = directTexts.findIndex(text => /第\s*\d+\s*页/.test(text) && /第\s*\d+\s*位/.test(text))
      const rankKeywordCell = rankIndex > 0 ? cells.eq(rankIndex - 1) : keywordCell
      const rankVolumeCell = rankIndex >= 0 && rankIndex + 1 < cells.length ? cells.eq(rankIndex + 1) : volumeCell
      const keyword = (linkedKeyword.text() || rankKeywordCell.find('a').first().text() || rankKeywordCell.text()).trim()
      const volumeText = (linkedVolume.text() || rankVolumeCell.text()).replace(/[,\s]/g, '').trim()
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

export function describeAizhanKeywordHtml(html: string): string {
  const $ = cheerio.load(html)
  const sampleRankRows = $('tr').toArray()
    .filter(row => /第\s*\d+\s*页/.test($(row).text()))
    .slice(0, 2)
    .map(row => ({
      cells: $(row).find('th, td').toArray().map(cell => ({
        text: $(cell).text().replace(/\s+/g, ' ').trim().slice(0, 200),
        html: ($(cell).html() || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      })),
    }))
  const tables = $('table').slice(0, 5).map((_, table) => ({
    className: $(table).attr('class') || '',
    rows: $(table).find('tr').slice(0, 3).map((__, row) =>
      $(row).find('th, td').map((___, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get()
    ).get(),
  })).get()
  return JSON.stringify({
    title: $('title').text().trim(),
    htmlLength: html.length,
    tableCount: $('table').length,
    tables,
    sampleRankRows,
    textStart: $('body').text().replace(/\s+/g, ' ').trim().slice(0, 500),
  })
}
