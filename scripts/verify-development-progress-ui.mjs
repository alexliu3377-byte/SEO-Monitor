// Browser-only fixture. No credentials, production requests or real data writes.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { chromium } from 'playwright'
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './app/(dashboard)/development-log/development-log-client';createRoot(document.getElementById('root')).render(<Page/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"development"' },
})
const css = await postcss([tailwindcss({ content: ['app/(dashboard)/development-log/*.tsx', 'components/app-dialog.tsx', 'components/page-number-input.tsx'] })])
  .process('@tailwind base;@tailwind components;@tailwind utilities;.btn-primary,.btn-secondary,.btn-ghost{border-radius:6px;padding:6px 12px;font-size:12px;min-height:32px}.btn-primary{background:#059669;color:white}.btn-secondary{border:1px solid #cbd5e1;background:white}.btn-ghost{color:#475569}button:disabled{opacity:.5}button:focus-visible{outline:2px solid #059669}button{cursor:pointer}', { from: undefined })
const date = new Date().toISOString()
const tasks = [{ id: '00000000-0000-4000-8000-000000000001', title: '开发日志进度与发布归档', description: '从想法到上线全程可追踪，保留测试与难题记录。', owner_name: '项目负责人', stage: 'testing',
  checklist: [{ id: '00000000-0000-4000-8000-000000000003', text: '完成进度看板和历史', done: true }, { id: '00000000-0000-4000-8000-000000000004', text: '完成验收', done: false }],
  blocker: '', next_step: '测试后部署并检查线上', test_notes: '', deployment_notes: '', revision: 1, release_id: null, created_at: date, updated_at: date, started_at: date, tested_at: null, deployed_at: null }]
let events = [{ id: 1, actor_name: '项目负责人', note: '创建事项并完成主体', snapshot: structuredClone(tasks[0]), created_at: date }]
const release = { id: '00000000-0000-4000-8000-000000000002', version: 'v0.0.1', title: '测试版本', release_date: date.slice(0, 10), status: 'completed', summary: '仅本地浏览器测试，不代表真实发布记录。', highlights: ['保留发布历史'], implementation_notes: [], limitations: [], experimental_features: [], source_note: null }
let readOnly = false
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript');res.end(bundle.outputFiles[0].text);return }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css');res.end(css.css);return }
  if (!url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'text/html');res.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>');return }
  res.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/api/development-log') { res.end(JSON.stringify({ releases: [release], total: 1, permissions: { canManage: !readOnly } }));return }
  const detail = url.pathname.match(/\/tasks\/(.+)$/)
  if (req.method === 'PATCH' || req.method === 'POST') {
    let raw = '';for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    let task = detail ? tasks.find(item => item.id === detail[1]) : null
    if (!task) { task = { ...body, id: '00000000-0000-4000-8000-000000000005', revision: 0, created_at: date, release_id: null };tasks.push(task) }
    if (body.action === 'archive') { task.release_id = body.releaseId;task.release = release }
    else Object.assign(task, body)
    task.revision++;task.updated_at = date
    events.unshift({ id: events.length + 1, actor_name: '项目负责人', note: body.note || '建立开发事项', snapshot: structuredClone(task), created_at: date })
    res.end(JSON.stringify({ task }));return
  }
  if (detail) { res.end(JSON.stringify({ task: tasks.find(item => item.id === detail[1]), events, total: events.length, canManage: !readOnly }));return }
  const filtered = tasks.filter(task => url.searchParams.get('releaseId') ? task.release_id === url.searchParams.get('releaseId') : (url.searchParams.get('scope') === 'history' ? !!task.release_id || task.stage === 'cancelled' : !task.release_id && task.stage !== 'cancelled') && (!url.searchParams.get('stage') || task.stage === url.searchParams.get('stage')))
  const counts = {};for (const task of tasks.filter(item => !item.release_id)) counts[task.stage] = (counts[task.stage] || 0) + 1
  res.end(JSON.stringify({ tasks: filtered, total: filtered.length, counts, canManage: !readOnly }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } })
const errors = [];page.on('pageerror', error => errors.push(error.message))
const root = `http://127.0.0.1:${server.address().port}`
const output = path.resolve('.task-work/development-progress')
try {
  await mkdir(output, { recursive: true })
  await page.goto(root)
  await page.getByRole('button', { name: '查看关联开发过程', exact: true }).click()
  await page.getByText('这个版本暂未关联开发事项。旧版本内容保留不变。').waitFor()
  await page.getByRole('button', { name: '查看进度', exact: true }).click()
  await page.getByRole('button', { name: '更新进度', exact: true }).click()
  await page.getByLabel('当前阶段').selectOption('ready')
  await page.getByLabel('完成检查项 2', { exact: true }).check()
  await page.getByLabel('测试结果 / 验收依据').fill('测试通过')
  await page.getByLabel('本次进展说明').fill('本地验收完成')
  await page.getByRole('button', { name: '保存进度', exact: true }).click()
  await page.getByRole('button', { name: '查看进度', exact: true }).click()
  await page.getByText('本地验收完成', { exact: true }).waitFor()
  await page.getByRole('button', { name: '更新进度', exact: true }).click()
  await page.getByLabel('当前阶段').selectOption('live')
  await page.getByLabel('部署与线上验证', { exact: true }).fill('部署及线上检查完成')
  await page.getByLabel('本次进展说明').fill('完成线上验收')
  await page.getByRole('button', { name: '保存进度', exact: true }).click()
  await page.getByRole('button', { name: '查看进度', exact: true }).click()
  await page.getByRole('button', { name: '归入发布版本', exact: true }).click()
  await page.getByLabel('发布版本', { exact: true }).selectOption(release.id)
  await page.getByRole('button', { name: '确认归档', exact: true }).click()
  await page.getByRole('button', { name: /开发日志进度与发布归档 · 查看难题/ }).click()
  await page.getByText('完成线上验收', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '更新进度', exact: true }).count(), 0)
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await page.getByRole('button', { name: '新增事项', exact: true }).click()
  await page.getByLabel('事项名称', { exact: true }).fill('新功能想法')
  await page.getByLabel('需求背景 / 想解决什么').fill('希望保留新想法并逐步推进')
  await page.getByRole('button', { name: '保存进度', exact: true }).click()
  await page.getByText('新功能想法', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.getByRole('button', { name: '查看进度', exact: true }).click()
  await page.getByRole('button', { name: '更新进度', exact: true }).click()
  await page.getByLabel('事项名称', { exact: true }).fill('未保存的修改')
  page.once('dialog', dialog => dialog.dismiss())
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 1)
  page.once('dialog', dialog => dialog.accept())
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  readOnly = true;await page.reload()
  await page.getByRole('button', { name: '查看进度', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '新增事项', exact: true }).count(), 0)
  await page.getByRole('button', { name: '查看进度', exact: true }).click()
  await page.getByText('进度历史 ·', { exact: false }).waitFor()
  assert.equal(await page.getByRole('button', { name: '更新进度', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ desktop: true, mobile375: true, noHorizontalOverflow: true, createEditArchive: true, historyPreserved: true, unsavedProtection: true, readOnlySuper: true, consoleErrors: 0, output, productionWrites: 0 }))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
  throw error
} finally { await browser.close();await new Promise(resolve => server.close(resolve)) }
