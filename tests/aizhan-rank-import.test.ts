import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { parseAizhanRankWorkbook } from '../lib/aizhan-rank-import'

function cell(reference: string, value: string) {
  const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<c r="${reference}" t="inlineStr"><is><t>${escaped}</t></is></c>`
}

function row(index: number, values: string[]) {
  const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
  return `<row r="${index}">${values.map((value, cellIndex) => cell(`${columns[cellIndex]}${index}`, value)).join('')}</row>`
}

function worksheet(rows: string[][]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((values, index) => row(index + 1, values)).join('')}</sheetData></worksheet>`
}

test('parses Aizhan rank workbook and excludes subdomains and non-positive volumes', async () => {
  const headers = ['(index)', 'keyword', 'new_rank', 'old_rank', 'title', 'zs', 'zs_pc', 'zs_wise', 'url']
  const workbook = zipSync({
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="rankup page 1" sheetId="1" r:id="rId1"/><sheet name="rankdown page 1" sheetId="2" r:id="rId2"/><sheet name="说明" sheetId="3" r:id="rId3"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(worksheet([
      headers,
      ['1', '主域词', '第12名', '第20名', '标题一', '100', '20', '80', 'http://www.sjwyx.com/ruanjian/1.html'],
      ['2', '子域词', '第2名', '第8名', '标题二', '200', '50', '150', 'http://abc.sjwyx.com/ruanjian/2.html'],
      ['3', '低量词', '第3名', '第9名', '标题三', '<10', '0', '<10', 'http://sjwyx.com/ruanjian/3.html'],
      ['4', '主域词', '第10名', '第18名', '标题四', '120', '30', '90', 'https://sjwyx.com/ruanjian/4.html'],
    ])),
    'xl/worksheets/sheet2.xml': strToU8(worksheet([
      headers,
      ['1', '主域词', '50名外', '第9名', '标题五', '90', '10', '80', 'http://www.sjwyx.com/ruanjian/1.html'],
      ['2', '跌词', '第40名', '第15名', '标题六', '60', '20', '40', 'http://sjwyx.com/ruanjian/6.html'],
    ])),
    'xl/worksheets/sheet3.xml': strToU8(worksheet([headers])),
  })

  const parsed = await parseAizhanRankWorkbook(workbook, 'sjwyx.com')
  assert.deepEqual(parsed.summary, {
    sheetCount: 3,
    ignoredSheetCount: 1,
    totalRows: 6,
    acceptedRows: 4,
    uniqueRankRows: 3,
    uniqueKeywords: 2,
    rankupRows: 1,
    rankdownRows: 2,
    excludedSubdomain: 1,
    excludedNonPositiveVolume: 1,
    invalidRows: 0,
    duplicateRows: 1,
  })
  const rankup = parsed.rankRows.find(row => row.type === 'rankup' && row.keyword === '主域词')
  assert.equal(rankup?.volume, 120)
  assert.equal(rankup?.rank_position, 10)
  const rankdown = parsed.rankRows.find(row => row.type === 'rankdown' && row.keyword === '主域词')
  assert.equal(rankdown?.rank_position, null)
  assert.equal(rankdown?.prev_rank, 9)
  assert.deepEqual(parsed.keywordVolumeRows.find(row => row.keyword === '主域词'), {
    keyword: '主域词',
    volume: 120,
    latest_trend: 'rankup',
  })
})
