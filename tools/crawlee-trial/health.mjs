import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { mytDate } from './rules.mjs'

export const EXPECTED_STEPS = ['keywords', 'weight', 'rank', 'rank-title', 'index-pages']
export function assessHealth(steps, bili, now = Date.now()) {
  const today = mytDate(now)
  const issues = []
  for (const step of EXPECTED_STEPS) {
    const row = steps.find(item => item.step === step && item.data_date === today)
    if (!row?.processing_complete) issues.push(`${step}：今日批次尚未完成或缺少完成记录`)
    else if (!row.complete) {
      const unresolved = Array.isArray(row.unresolved) ? row.unresolved : []
      const details = unresolved.slice(0, 10).map(item => `${String(item.domain ?? 'unknown').replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 100)} (${['fail', 'empty', 'suspect'].includes(item.status) ? item.status : 'unknown'})`).join('、')
      issues.push(`${step}：流程结束但资料不完整，待确认来源 ${Array.isArray(row.unresolved) ? unresolved.length : '未知'} 个${details ? '：' + details : ''}`)
    }
  }
  const seen = Date.parse(bili?.last_seen_at ?? '')
  if (!Number.isFinite(seen) || seen > now + 300000 || mytDate(seen) !== today) issues.push('B 站：今日未发现有效的新采集记录；请检查电脑、网络、任务及 GitHub 排队情况')
  return { data_date: today, issues, status: issues.length ? 'failed' : 'passed', bilibili_last_seen_at: bili?.last_seen_at ?? null }
}

// Intentionally no Supabase SDK, RPC, write method, service response text, or item titles.
export async function readMetadata(table, parameters, env = process.env, fetcher = fetch) {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase health-check secrets')
  const origin = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new Error('Invalid Supabase origin')
  const url = new URL(`/rest/v1/${table}`, origin)
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value)
  const response = await fetcher(url, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  })
  if (!response.ok) throw new Error(`Health metadata read failed: ${table}, HTTP ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body)) throw new Error('Invalid metadata response')
  return body
}

async function main() {
  const now = Date.now()
  let report
  try {
    const steps = await readMetadata('crawl_step_completion', { select: 'data_date,step,processing_complete,complete,unresolved', data_date: `eq.${mytDate(now)}`, step: `in.(${EXPECTED_STEPS.join(',')})`, limit: '5' })
    const bili = await readMetadata('content_feed_items', { select: 'last_seen_at', source: 'eq.bilibili', order: 'last_seen_at.desc.nullslast', limit: '1' })
    report = assessHealth(steps, bili[0], now)
  } catch (error) {
    // Do not log arbitrary network exception strings, URLs or service-role secrets.
    report = { data_date: mytDate(now), status: 'failed', issues: [error.message.startsWith('Health metadata') || error.message.startsWith('Missing Supabase') ? error.message : '独立检查未能读取资料（请查看配置、Supabase 状态和网络）'] }
  }
  report.checked_at = new Date(now).toISOString()
  const text = ['# 每日采集独立检查', '', `MYT 日期：${report.data_date}；状态：${report.status}`, '', ...report.issues.map(issue => `- ${issue}`), '', '范围：五个 SEO 步骤的完成／完整性标记，以及 B 站今日采集新鲜度。不是所有来源、转写准确率或全站质量检查。', '', '逾期不代表已证实电脑关机；GitHub 排队、网络或来源为空也可能触发。由 GitHub 托管 Runner 执行，不依赖采集电脑在线。', '', '失败结果供 GitHub 原生通知使用；必须自行开启个人 Actions 邮件通知，尚未验证邮箱实际送达。', ''].join('\n')
  const output = new URL('./output/', import.meta.url)
  await mkdir(output, { recursive: true })
  await writeFile(new URL('health.json', output), JSON.stringify(report, null, 2))
  await writeFile(new URL('health.md', output), text)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text)
  console.log(text)
  if (report.status !== 'passed') process.exitCode = 1
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main()
