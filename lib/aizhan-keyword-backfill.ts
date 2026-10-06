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

export function parseAizhanKeywordPage(html: string, currentUrl: string): {
  rows: AizhanKeywordRow[]
  sawZeroVolume: boolean
  nextUrl: string | null
} {
  const $ = cheerio.load(html)
  const rows: AizhanKeywordRow[] = []
  let sawZeroVolume = false
  $('tr').each((_, tr) => {
    const rowText = $(tr).text()
    if (!/第\s*\d+\s*页/.test(rowText) || !/第\s*\d+\s*位/.test(rowText)) return
    const linkedKeyword = $(tr).find('a[href*="baidu.com/s"]').first()
    const linkedVolume = $(tr).find('a[href*="ci.aizhan.com"]').first()
    const keyword = linkedKeyword.text().trim()
    const volumeText = linkedVolume.text().replace(/[,\s]/g, '').trim()
    if (!keyword || !/^\d+$/.test(volumeText)) return
    const volume = Number.parseInt(volumeText, 10)
    if (volume <= 0) {
      sawZeroVolume = true
      return
    }
    rows.push({ keyword, volume })
  })

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
