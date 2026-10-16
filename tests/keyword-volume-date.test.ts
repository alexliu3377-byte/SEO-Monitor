import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVolumeRiseDate, formatVolumeRiseDate } from '../lib/keyword-volume-date'
import { selectHotRadarSections, type HotRadarPayload } from '../lib/hot-radar'

test('discovery date is independent of repeated fresh crawls and unchanged cumulative growth', () => {
  const row = normalizeVolumeRiseDate({ riseDate: '2026-10-09', volumeDate: '2026-10-16', last_date: '2026-10-16', netChange: 19937, change: 0 })
  assert.equal(row.last_date, '2026-10-09')
  assert.equal(row.volumeDate, '2026-10-16')
  assert.equal(row.netChange, 19937)
  assert.equal(normalizeVolumeRiseDate(row).last_date, '2026-10-09')
})

test('old global and group caches cannot relabel crawl dates as known rise dates', () => {
  const old = { keyword: '原有累计词', last_date: '2026-10-16', netChange: 20 }
  const normalized = normalizeVolumeRiseDate(old)
  assert.equal(normalized.last_date, '')
  assert.equal(normalized.volumeDate, '2026-10-16')
  assert.equal(normalized.riseDate, null)
  assert.deepEqual(normalizeVolumeRiseDate(normalized), normalized)
  const selected = selectHotRadarSections({ volumeRisingWords: [old] } as unknown as HotRadarPayload, ['volumeRisingWords'])
  assert.deepEqual(selected.volumeRisingWords, [normalized])
  assert.equal(formatVolumeRiseDate(normalized.last_date), '未记录')
})

test('date controls use only actual discovery dates; unknown history never becomes today', () => {
  const rows = [
    { keyword: '今天上涨', riseDate: '2026-10-16', last_date: '2026-10-16' },
    { keyword: '旧涨幅', riseDate: '2026-10-09', last_date: '2026-10-16' },
    { keyword: '未知日期', last_date: '2026-10-16' },
  ].map(normalizeVolumeRiseDate)
  assert.deepEqual(rows.filter(row => row.last_date === '2026-10-16').map(row => row.keyword), ['今天上涨'])
  assert.equal(rows.length, 3) // historical cumulative entries remain available under all dates
  assert.equal(formatVolumeRiseDate('2026-10-09'), '2026/10/09')
  for (const date of [null, undefined, '', '2026-02-30', '2026-10-16T00:00:00Z', 'today']) {
    assert.equal(formatVolumeRiseDate(date), '未记录')
  }
})
