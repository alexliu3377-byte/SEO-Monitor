/* eslint-disable @typescript-eslint/no-explicit-any */
import { unzipSync } from 'fflate'
import { parseStringPromise } from 'xml2js'

export type RankImportDirection = 'rankup' | 'rankdown'

export interface ParsedRankImportRow {
  keyword: string
  type: RankImportDirection
  rank_position: number | null
  prev_rank: number | null
  volume: number
  title: string | null
  url: string
}

export interface ParsedKeywordVolumeRow {
  keyword: string
  volume: number
  latest_trend: RankImportDirection
}

export interface AizhanImportSummary {
  sheetCount: number
  ignoredSheetCount: number
  totalRows: number
  acceptedRows: number
  uniqueRankRows: number
  uniqueKeywords: number
  rankupRows: number
  rankdownRows: number
  excludedSubdomain: number
  excludedNonPositiveVolume: number
  invalidRows: number
  duplicateRows: number
}

export interface ParsedAizhanWorkbook {
  rankRows: ParsedRankImportRow[]
  keywordVolumeRows: ParsedKeywordVolumeRow[]
  summary: AizhanImportSummary
}

const REQUIRED_HEADERS = ['keyword', 'new_rank', 'old_rank', 'title', 'zs', 'url'] as const
const MAX_WORKBOOK_ROWS = 100_000

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function nodeText(node: any): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node._ === 'string' || typeof node._ === 'number') return String(node._)
  if (node.t != null) return nodeText(node.t)
  if (node.r != null) return asArray(node.r).map(run => nodeText(run?.t)).join('')
  return ''
}

function cleanCell(value: string): string {
  return value.trim().replace(/^'+|'+$/g, '').trim()
}

function columnName(reference: string): string {
  return reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\.$/, '')
}

function exactSiteUrl(value: string, domain: string): string | null {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
    const normalized = normalizeDomain(domain)
    if (hostname !== normalized && hostname !== `www.${normalized}`) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function parsePositiveVolume(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseRank(value: string): number | null {
  if (!value || /名外|之外|out/i.test(value)) return null
  const matched = value.match(/\d+/)
  if (!matched) return null
  const parsed = Number(matched[0])
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : null
}

function directionFromSheetName(name: string): RankImportDirection | null {
  const normalized = name.trim().toLowerCase()
  if (normalized.includes('rankup') || /上涨|上升|涨幅/.test(normalized)) return 'rankup'
  if (normalized.includes('rankdown') || /下跌|下降|跌幅/.test(normalized)) return 'rankdown'
  return null
}

function resolveWorkbookPath(target: string): string {
  const normalized = target.replace(/\\/g, '/').replace(/^\//, '')
  if (normalized.startsWith('xl/')) return normalized
  return `xl/${normalized.replace(/^\.\//, '')}`
}

function cellValue(cell: any, sharedStrings: string[]): string {
  const type = String(cell?.$?.t ?? '')
  if (type === 'inlineStr') return cleanCell(nodeText(cell?.is))
  const raw = cleanCell(nodeText(cell?.v))
  if (type === 's') {
    const index = Number(raw)
    return Number.isInteger(index) ? cleanCell(sharedStrings[index] ?? '') : ''
  }
  return raw
}

export async function parseAizhanRankWorkbook(
  input: ArrayBuffer | Uint8Array,
  siteDomain: string,
): Promise<ParsedAizhanWorkbook> {
  const files = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input))
  const decoder = new TextDecoder('utf-8')
  const readXml = async (path: string) => {
    const bytes = files[path]
    if (!bytes) throw new Error(`Excel 缺少 ${path}`)
    return parseStringPromise(decoder.decode(bytes), { explicitArray: false, attrkey: '$', charkey: '_' })
  }

  const [workbookXml, relationshipsXml] = await Promise.all([
    readXml('xl/workbook.xml'),
    readXml('xl/_rels/workbook.xml.rels'),
  ])
  const relationshipMap = new Map<string, string>()
  for (const relationship of asArray(relationshipsXml?.Relationships?.Relationship)) {
    const id = String(relationship?.$?.Id ?? '')
    const target = String(relationship?.$?.Target ?? '')
    if (id && target) relationshipMap.set(id, resolveWorkbookPath(target))
  }

  let sharedStrings: string[] = []
  if (files['xl/sharedStrings.xml']) {
    const sharedXml = await readXml('xl/sharedStrings.xml')
    sharedStrings = asArray(sharedXml?.sst?.si).map(nodeText)
  }

  const sheets = asArray(workbookXml?.workbook?.sheets?.sheet)
  if (sheets.length === 0) throw new Error('Excel 没有工作表')

  const rankMap = new Map<string, ParsedRankImportRow>()
  const summary: AizhanImportSummary = {
    sheetCount: sheets.length,
    ignoredSheetCount: 0,
    totalRows: 0,
    acceptedRows: 0,
    uniqueRankRows: 0,
    uniqueKeywords: 0,
    rankupRows: 0,
    rankdownRows: 0,
    excludedSubdomain: 0,
    excludedNonPositiveVolume: 0,
    invalidRows: 0,
    duplicateRows: 0,
  }

  for (const sheet of sheets) {
    const name = String(sheet?.$?.name ?? '')
    const direction = directionFromSheetName(name)
    if (!direction) {
      summary.ignoredSheetCount++
      continue
    }
    const relationId = String(sheet?.$?.['r:id'] ?? '')
    const path = relationshipMap.get(relationId)
    if (!path) throw new Error(`无法读取工作表：${name}`)
    const sheetXml = await readXml(path)
    const rows = asArray(sheetXml?.worksheet?.sheetData?.row)
    let headerIndex = -1
    let headerColumns = new Map<string, string>()

    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
      const candidate = new Map<string, string>()
      for (const cell of asArray(rows[rowIndex]?.c)) {
        const value = cellValue(cell, sharedStrings).trim().toLowerCase()
        if (value) candidate.set(value, columnName(String(cell?.$?.r ?? '')))
      }
      if (REQUIRED_HEADERS.every(header => candidate.has(header))) {
        headerIndex = rowIndex
        headerColumns = candidate
        break
      }
    }
    if (headerIndex < 0) throw new Error(`工作表“${name}”缺少必要列：${REQUIRED_HEADERS.join('、')}`)

    for (const row of rows.slice(headerIndex + 1)) {
      const values = new Map<string, string>()
      for (const cell of asArray(row?.c)) {
        values.set(columnName(String(cell?.$?.r ?? '')), cellValue(cell, sharedStrings))
      }
      const get = (header: typeof REQUIRED_HEADERS[number]) => values.get(headerColumns.get(header) ?? '') ?? ''
      const keyword = cleanCell(get('keyword'))
      if (!keyword) continue
      summary.totalRows++
      if (summary.totalRows > MAX_WORKBOOK_ROWS) throw new Error(`Excel 数据超过 ${MAX_WORKBOOK_ROWS.toLocaleString()} 行限制`)

      const rawUrl = cleanCell(get('url'))
      const url = exactSiteUrl(rawUrl, siteDomain)
      if (!url) {
        try {
          const hostname = new URL(rawUrl).hostname.toLowerCase()
          if (hostname) summary.excludedSubdomain++
          else summary.invalidRows++
        } catch {
          summary.invalidRows++
        }
        continue
      }
      const volume = parsePositiveVolume(cleanCell(get('zs')))
      if (volume == null) {
        summary.excludedNonPositiveVolume++
        continue
      }

      summary.acceptedRows++
      const parsed: ParsedRankImportRow = {
        keyword,
        type: direction,
        rank_position: parseRank(cleanCell(get('new_rank'))),
        prev_rank: parseRank(cleanCell(get('old_rank'))),
        volume,
        title: cleanCell(get('title')) || null,
        url,
      }
      const key = `${direction}\u0000${keyword}`
      const existing = rankMap.get(key)
      if (!existing || parsed.volume > existing.volume) rankMap.set(key, parsed)
    }
  }

  const rankRows = Array.from(rankMap.values())
  const rankupVolume = new Map<string, number>()
  const rankdownVolume = new Map<string, number>()
  for (const row of rankRows) {
    const target = row.type === 'rankup' ? rankupVolume : rankdownVolume
    const existing = target.get(row.keyword)
    if (existing == null || row.volume > existing) target.set(row.keyword, row.volume)
  }
  const keywordVolumeMap = new Map<string, ParsedKeywordVolumeRow>()
  for (const [keyword, volume] of rankdownVolume) keywordVolumeMap.set(keyword, { keyword, volume, latest_trend: 'rankdown' })
  // Match the crawler: if a keyword appears in both directions, rankup wins.
  for (const [keyword, volume] of rankupVolume) keywordVolumeMap.set(keyword, { keyword, volume, latest_trend: 'rankup' })

  summary.uniqueRankRows = rankRows.length
  summary.uniqueKeywords = keywordVolumeMap.size
  summary.rankupRows = rankRows.filter(row => row.type === 'rankup').length
  summary.rankdownRows = rankRows.filter(row => row.type === 'rankdown').length
  summary.duplicateRows = summary.acceptedRows - summary.uniqueRankRows

  if (summary.uniqueRankRows === 0) throw new Error('过滤后没有可导入的数据')
  return { rankRows, keywordVolumeRows: Array.from(keywordVolumeMap.values()), summary }
}
