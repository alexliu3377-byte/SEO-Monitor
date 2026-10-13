import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGroupHotRadarPayload, groupHotRadarFilterHash } from '../lib/group-hot-radar-cache'
import type { HotRadarPayload } from '../lib/hot-radar'

const payload: HotRadarPayload = {
  newWords: [
    { keyword: '新词', count: 4, siteCount: 2, sites: ['a.com', 'b.com'], first_date: '2026-10-01', last_date: '2026-10-02' },
    { keyword: '其他词', count: 1, siteCount: 1, sites: ['c.com'], first_date: '2026-10-02', last_date: '2026-10-02' },
  ],
  rankWords: [
    { keyword: '涨词', siteCount: 2, volume: 100, sites: ['a.com', 'c.com'], first_date: '2026-10-01', last_date: '2026-10-03', rankDays: 2 },
  ],
  streakWords: [
    { keyword: '连续词', domain: 'a.com', streak: 3, volume: 80, first_date: '2026-10-01', last_date: '2026-10-03' },
    { keyword: '别站词', domain: 'b.com', streak: 2, volume: 60, first_date: '2026-10-02', last_date: '2026-10-03' },
  ],
  volumeRisingWords: [
    { keyword: '搜索量词', volume: 20, prevVolume: 10, change: 10, baselineVolume: 10, baselineDate: '2026-10-01', netChange: 10, last_date: '2026-10-03', sites: [], rankTrend: null },
  ],
}

test('buildGroupHotRadarPayload filters rank and new sources independently', () => {
  const result = buildGroupHotRadarPayload(payload, {
    rankDomains: ['A.COM'],
    newDomains: ['https://b.com/'],
  })

  assert.deepEqual(result.newWords.map(row => [row.keyword, row.sites, row.siteCount]), [
    ['新词', ['b.com'], 1],
  ])
  assert.deepEqual(result.rankWords.map(row => [row.keyword, row.sites, row.siteCount]), [
    ['涨词', ['a.com'], 1],
  ])
  assert.deepEqual(result.streakWords.map(row => row.keyword), ['连续词'])
  assert.deepEqual(result.volumeRisingWords, payload.volumeRisingWords)
})

test('empty selections preserve the complete shared radar result', () => {
  const result = buildGroupHotRadarPayload(payload, { rankDomains: [], newDomains: [] })
  assert.deepEqual(result, payload)
})

test('filter hash is stable across domain formatting and selection order', () => {
  const first = groupHotRadarFilterHash({ rankDomains: ['www.B.com', 'a.com'], newDomains: ['C.com'] })
  const second = groupHotRadarFilterHash({ rankDomains: ['https://a.com/', 'b.com'], newDomains: ['c.com'] })
  assert.equal(first, second)
})
