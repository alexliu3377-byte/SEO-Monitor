import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from 'cheerio'
import { baselineDate, trialDate, isDetailUrl, comparePage, SOURCES } from '../rules.mjs'
import { assessHealth, readMetadata, EXPECTED_STEPS } from '../health.mjs'

const now = Date.parse('2026-10-26T16:03:00Z') // MYT Oct 27, 00:03
test('dates use the snapshot time and cross midnight correctly', () => {
  assert.equal(trialDate('5分钟前发布', now), '2026-10-26')
  assert.equal(trialDate('1小时前更新', now), '2026-10-26')
  assert.equal(trialDate('2天前发布', now), '2026-10-25')
  assert.equal(baselineDate('5分钟前发布', now), null)
  assert.equal(baselineDate('5分钟前', now), '2026-10-27')
  assert.equal(trialDate('2026-02-30 12:00', now), null)
  assert.equal(trialDate('2026-10-26 15:30', now), '2026-10-26')
  assert.equal(trialDate('共123款', now), null)
  assert.equal(trialDate('', now), null)
  assert.equal(trialDate('99999999999天前', now), null)
})
test('only same-site numeric detail links survive', () => {
  assert.equal(isDetailUrl('https://www.niucoo.cn/game/123.html', SOURCES[0]), true)
  for (const url of ['https://www.niucoo.cn/game/', 'https://www.niucoo.cn/game/jsby/', 'https://evil.example/game/123.html', 'https://www.niucoo.cn.evil.example/game/123.html', 'javascript:alert(1)', 'https://u:p@www.niucoo.cn/game/123.html']) assert.equal(isDetailUrl(url, SOURCES[0]), false)
})
test('health flags business partial success and missing local collection', () => {
  const steps = EXPECTED_STEPS.map(step => ({ step, data_date: '2026-10-27', processing_complete: true, complete: true }))
  const bili = { last_seen_at: '2026-10-26T16:01:00Z' }
  assert.equal(assessHealth(steps, bili, now).status, 'passed')
  steps[0].complete = false
  steps[0].unresolved = [{ domain: 'example.invalid', status: 'empty' }]
  assert.equal(assessHealth(steps, { last_seen_at: '2026-10-25T20:00:00Z' }, now).issues.length, 2)
  assert.equal(assessHealth([], null, now).issues.length, 6)
  assert.equal(assessHealth(steps.slice(1), bili, now).issues.length, 1)
})
test('database health is GET-only, redirect-safe, bounded and does not emit raw service errors', async () => {
  let called = false
  const rows = await readMetadata('crawl_step_completion', { limit: '5' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-secret' }, async (url, options) => {
    called = true
    assert.equal(url.searchParams.get('limit'), '5')
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    return { ok: true, json: async () => [] }
  })
  assert.equal(called, true)
  assert.deepEqual(rows, [])
})

test('same snapshot excludes category entrances and retains real game dates', () => {
  const dom = load('<li><a href="https://www.niucoo.cn/game/jsby/"><div class="imgInfo"><p>角色扮演</p><p class="tip">共123款</p></div></a></li><li><a href="https://www.niucoo.cn/game/123.html"><div class="imgInfo"><p>游戏 A</p><p class="tip">2026-10-26 12:30</p></div></a></li>')
  const report = comparePage(dom, SOURCES[0], now)
  assert.equal(report.baseline.candidates, 2)
  assert.equal(report.baseline.unknown_dates, 1)
  assert.equal(report.trial.candidates, 1)
  assert.equal(report.trial.excluded_noncontent_links, 1)
  assert.equal(report.trial.yesterday, 1)
  assert.deepEqual(report.issues, [])
})
test('unknown and future dates fail review rather than defaulting to yesterday', () => {
  const html = '<li class="chwAppList"><a class="name" href="/game/123.html">A</a><div><em>日期未知</em></div></li><li class="chwAppList"><a class="name" href="/game/124.html">B</a><div><em>2026-10-28</em></div></li>'
  const report = comparePage(load(html), SOURCES[1], now)
  assert.equal(report.trial.unknown_dates, 1)
  assert.equal(report.trial.future_dates, 1)
  assert.equal(report.trial.yesterday, 0)
  assert.equal(report.issues.length, 2)
  assert.equal(comparePage(load('<p>empty</p>'), SOURCES[1], now).issues.length, 1)
})
