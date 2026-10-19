import test from 'node:test'
import assert from 'node:assert/strict'
import { radarTabDate, radarTabScope } from '../lib/radar-tab-state'

const now=Date.parse('2026-10-19T05:00:00Z')
test('each tab and group keeps its own date, without borrowing another tab selection', () => {
  const dates: Record<string,string> = { [radarTabScope('wordLib','a')]: '2026-10-17', [radarTabScope('rank','a')]: '2026-10-16' }
  assert.equal(radarTabDate('wordLib',dates[radarTabScope('wordLib','a')],now),'2026-10-17')
  assert.equal(radarTabDate('rank',dates[radarTabScope('rank','a')],now),'2026-10-16')
  assert.equal(radarTabDate('wordLib',dates[radarTabScope('wordLib','b')],now),'2026-10-18')
  assert.equal(radarTabDate('newWords',undefined,now),'2026-10-18')
  assert.equal(radarTabDate('volumeRising',undefined,now),'all')
  assert.equal(radarTabDate('rank','2026-10-12',now),'all')
  assert.equal(radarTabDate('rank','2026-10-19',now),'all')
  assert.equal(radarTabDate('rank','all',now),'all')
  assert.equal(radarTabDate('wordLib','all',now),'all')
})
