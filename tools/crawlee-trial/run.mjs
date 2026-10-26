import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { runComparison } from './crawler.mjs'
import { mytDate } from './rules.mjs'

const output = new URL('./output/', import.meta.url)
await mkdir(output, { recursive: true })
const report = { captured_at: new Date().toISOString(), data_date: mytDate(Date.now() - 86400000), production_writes: 0, model_calls: 0, comparisons: [] }
try { report.comparisons = await runComparison() }
catch { report.error = 'Trial runner failed before all results were recorded; inspect the Actions log.' }
const cell = value => String(value ?? '—').replace(/[|\r\n]/g, ' ')
const lines = [
  '# Crawlee 只读对照试跑', '',
  `昨日口径：${report.data_date}；抓取时间：${report.captured_at}（UTC）。`, '',
  '同一份页面比较旧规则与试验规则。不替换现有入库，不补写或删除资料，不调用模型。', '',
  '| 来源 | 状态 | 请求次数 | 耗时 ms | 旧候选 / 日期未知 | 试验详情 / 日期未知 | 排除非详情 | 试验昨日 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...report.comparisons.map(row => `| ${row.domain} | ${row.status} | ${row.attempts ?? '—'} | ${row.duration_ms ?? '—'} | ${row.baseline ? row.baseline.candidates + ' / ' + row.baseline.unknown_dates : '—'} | ${row.trial ? row.trial.candidates + ' / ' + row.trial.unknown_dates : '—'} | ${row.trial?.excluded_noncontent_links ?? '—'} | ${row.trial?.yesterday ?? '—'} |`),
  '', ...report.comparisons.flatMap(row => row.issues.map(issue => `- ${row.domain}：${cell(issue)}`)),
  ...(report.error ? ['', report.error] : []), '',
  '日期修正、类别过滤来自自定义业务规则；不是 Crawlee 自动变准确。旧规则未知日期未伪填昨日。零条昨日资料不等于漏抓，也不保证昨日确实没有发布。', '',
  '这是当前页面对照，不是凌晨完整快照重建、速度 A/B 基准或电脑断电恢复验证。', '',
].join('\n')
await writeFile(new URL('comparison.json', output), JSON.stringify(report, null, 2))
await writeFile(new URL('comparison.md', output), lines)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines)
console.log(lines)
if (report.error || report.comparisons.some(row => row.status !== 'passed')) process.exitCode = 1
