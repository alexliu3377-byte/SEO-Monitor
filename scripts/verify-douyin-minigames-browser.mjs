import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import View from './components/douyin-minigames-tab';createRoot(document.getElementById('root')).render(<View/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
const css = (await postcss([tailwindcss({ content: ['components/douyin-minigames-tab.tsx','components/game-discovery-controls.tsx','components/simple-pagination.tsx','components/page-number-input.tsx'] })]).process(await readFile('app/globals.css','utf8'), { from: 'app/globals.css' })).css
const html = `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`
const browser = await chromium.launch({ headless: true })
const requests = [], errors = []
let fail = false, empty = false
const route = async route => {
  const request = route.request(), url = new URL(request.url())
  assert.equal(request.method(), 'GET')
  assert.equal(url.hostname, 'minigames.test', 'The UI must not contact the source website')
  if (url.pathname === '/api/charts/douyin-minigames') {
    requests.push(url.search)
    if (fail) return route.fulfill({ status: 503, json: { error: '测试读取失败' } })
    const page = Number(url.searchParams.get('page')), board = url.searchParams.get('board')
    return route.fulfill({ json: { total: empty ? 0 : 100, collectedAt: empty ? null : '2026-10-21T00:00:00Z',
      items: empty ? [] : Array.from({ length: 20 }, (_, i) => ({ rank: (page - 1) * 20 + i + 1, game_id: String(i), title: `${board}游戏${(page - 1) * 20 + i + 1}`, summary: '官方游戏简介' })) } })
  }
  return route.fulfill({ contentType: 'text/html', body: html })
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route)
  await page.goto('https://minigames.test/'); await page.getByText('new游戏1', { exact: true }).waitFor()
  assert.deepEqual(requests, ['?board=new&page=1'])
  assert.equal(await page.locator('tbody tr').count(), 20)
  assert.equal(await page.getByRole('link').getAttribute('href'), 'https://game.open-douyin.com/')
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await page.getByText('new游戏21', { exact: true }).waitFor()
  await page.getByRole('button', { name: '热门榜', exact: true }).click(); await page.getByText('hot游戏1', { exact: true }).waitFor()
  assert.equal(requests.at(-1), '?board=hot&page=1')
  await page.getByRole('button', { name: '最后一页', exact: true }).click(); await page.getByText('hot游戏81', { exact: true }).waitFor()
  await page.screenshot({ path: '.task-work/douyin-minigames-desktop.png' })
  fail = true; await page.getByRole('button', { name: '畅销榜', exact: true }).click(); await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('tbody tr').count(), 0, 'Do not show the previous board as a failed new board')
  fail = false; await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('grossing游戏1', { exact: true }).waitFor()
  empty = true; await page.reload(); await page.getByText('尚未采集到小游戏榜单', { exact: true }).waitFor(); empty = false
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const mobilePage = await mobile.newPage(); mobilePage.on('pageerror', error => errors.push(error.message)); await mobilePage.route('**/*', route)
  await mobilePage.goto('https://minigames.test/'); await mobilePage.getByText('new游戏1', { exact: true }).waitFor()
  assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await mobilePage.getByRole('button', { name: '热门榜', exact: true }).focus()
  assert.ok(await mobilePage.locator(':focus').getAttribute('class'))
  assert.ok((await mobilePage.getByRole('button', { name: '热门榜', exact: true }).boundingBox()).height >= 44)
  assert.ok((await mobilePage.getByRole('link').boundingBox()).height >= 44)
  await mobilePage.screenshot({ path: '.task-work/douyin-minigames-mobile.png' })
  await mobile.close(); assert.deepEqual(errors, [])
  console.log(JSON.stringify({ currentPageOnly: true, filterResetsPage: true, sharedJumpPagination: true, noSourceRequestsOnOpen: true, sourceLinkOnContentTitle: true, errorRetry: true, emptyState: true, mobile375: true, browserErrors: errors, productionWrites: 0 }))
} finally { await browser.close() }
