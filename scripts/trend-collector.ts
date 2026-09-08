import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { chromium, type BrowserContext, type Page } from 'playwright'
import {
  cleanTrendText,
  extractCandidateTerms,
  isTrendPlatform,
  normalizeTrendSourceUrl,
  type TrendMetrics,
  type TrendPlatform,
} from '../lib/trend-discovery'

type PlatformConfig = { enabled: boolean; queries: string[] }
type CollectorConfig = {
  node: { id: string; name: string; version: string }
  maxResultsPerQuery: number
  delayBetweenQueriesMs: number
  platforms: Record<TrendPlatform, PlatformConfig>
}

type CollectedSignal = {
  externalId: string
  sourceUrl: string
  title: string
  excerpt: string | null
  tags: string[]
  candidateTerms: string[]
  queryTerm: string
  publishedAt: string | null
  collectedAt: string
  metrics: TrendMetrics
}

const HOME_URLS: Record<TrendPlatform, string> = {
  xiaohongshu: 'https://www.xiaohongshu.com/',
  douyin: 'https://www.douyin.com/',
  xiaoheihe: 'https://www.xiaoheihe.cn/',
}

const RESULT_LINK_SELECTORS: Partial<Record<TrendPlatform, string>> = {
  xiaohongshu: 'a[href*="/explore/"], a[href*="/discovery/item/"]',
  douyin: 'a[href*="/video/"]',
}

class CollectorBlockedError extends Error {}

function loadLocalEnvironment() {
  const path = resolve('.env.trend.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    if (!process.env[key]) process.env[key] = value
  }
}

function loadConfig(): CollectorConfig {
  const path = resolve(process.env.TREND_COLLECTOR_CONFIG || 'config/trend-collector.json')
  const config = JSON.parse(readFileSync(path, 'utf8')) as CollectorConfig
  config.node.id = process.env.TREND_NODE_ID?.trim() || config.node.id
  config.node.name = process.env.TREND_NODE_NAME?.trim() || config.node.name
  config.maxResultsPerQuery = Math.min(30, Math.max(1, config.maxResultsPerQuery || 12))
  config.delayBetweenQueriesMs = Math.min(60_000, Math.max(5_000, config.delayBetweenQueriesMs || 8_000))
  return config
}

function parsePlatformArgument(config: CollectorConfig): TrendPlatform[] {
  const index = process.argv.indexOf('--platform')
  const value = index >= 0 ? process.argv[index + 1] : 'all'
  if (value === 'all') {
    return (Object.keys(config.platforms) as TrendPlatform[]).filter(platform => config.platforms[platform].enabled)
  }
  if (!isTrendPlatform(value) || !config.platforms[value].enabled) {
    throw new Error(`平台参数无效或尚未启用：${value ?? ''}`)
  }
  return [value]
}

function profileDirectory(platform: TrendPlatform) {
  const root = resolve(process.env.TREND_PROFILE_DIR || '.trend-browser')
  return resolve(root, platform)
}

async function launchPlatformBrowser(platform: TrendPlatform): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDirectory(platform), {
    channel: process.env.TREND_BROWSER_CHANNEL || 'chrome',
    headless: process.env.TREND_HEADLESS === 'true',
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Kuala_Lumpur',
  })
}

function searchUrl(platform: TrendPlatform, query: string): string {
  if (platform === 'xiaohongshu') {
    return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_search_result_notes`
  }
  if (platform === 'douyin') return `https://www.douyin.com/search/${encodeURIComponent(query)}`
  throw new Error('小黑盒采集器仍在第二阶段，当前不会运行')
}

function compactNumber(value: string): number | null {
  const normalized = value.trim().toLowerCase().replace(/,/g, '')
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([万w]?)/)
  if (!match) return null
  const multiplier = match[2] === '万' || match[2] === 'w' ? 10_000 : 1
  return Math.round(Number.parseFloat(match[1]) * multiplier)
}

function parseMetrics(text: string): TrendMetrics {
  const metrics: TrendMetrics = {}
  const patterns: [keyof TrendMetrics, RegExp][] = [
    ['likes', /(?:点赞|获赞|赞)\s*([\d,.]+\s*[万w]?)/i],
    ['comments', /(?:评论)\s*([\d,.]+\s*[万w]?)/i],
    ['collects', /(?:收藏)\s*([\d,.]+\s*[万w]?)/i],
    ['shares', /(?:分享|转发)\s*([\d,.]+\s*[万w]?)/i],
  ]
  for (const [key, pattern] of patterns) {
    const raw = text.match(pattern)?.[1]
    const parsed = raw ? compactNumber(raw) : null
    if (parsed !== null) metrics[key] = parsed
  }
  return metrics
}

function extractTags(text: string): string[] {
  return [...text.matchAll(/#([\p{L}\p{N}_·-]{2,40})/gu)]
    .map(match => cleanTrendText(match[1], 40))
    .filter(Boolean)
    .slice(0, 20)
}

function externalIdFromUrl(platform: TrendPlatform, url: string): string {
  const parsed = new URL(url)
  const patterns: Partial<Record<TrendPlatform, RegExp>> = {
    xiaohongshu: /\/(?:explore|discovery\/item)\/([^/?#]+)/,
    douyin: /\/video\/([^/?#]+)/,
  }
  const match = parsed.pathname.match(patterns[platform]!)
  return match?.[1] || createHash('sha256').update(parsed.origin + parsed.pathname).digest('hex').slice(0, 32)
}

async function detectBlockedPage(page: Page) {
  const url = page.url()
  const bodyText = cleanTrendText(await page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''), 5_000)
  if (/验证|安全验证|访问过于频繁|操作频繁|扫码登录|登录后查看/.test(bodyText) || /login|captcha|verify/i.test(url)) {
    throw new CollectorBlockedError('平台要求重新登录或人工完成验证')
  }
}

async function cardText(link: ReturnType<Page['locator']>): Promise<string> {
  return link.evaluate(element => {
    let current: HTMLElement | null = element as HTMLElement
    let best = (current.innerText || current.textContent || '').trim()
    for (let depth = 0; depth < 4 && current.parentElement; depth += 1) {
      current = current.parentElement
      const candidate = (current.innerText || current.textContent || '').trim()
      if (candidate.length >= best.length && candidate.length <= 1000) best = candidate
    }
    return best
  }).catch(() => '')
}

async function collectQuery(page: Page, platform: TrendPlatform, query: string, maxResults: number): Promise<CollectedSignal[]> {
  const selector = RESULT_LINK_SELECTORS[platform]
  if (!selector) return []
  await page.goto(searchUrl(platform, query), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.waitForTimeout(5_000)
  await detectBlockedPage(page)

  const links = page.locator(selector)
  const count = Math.min(await links.count(), maxResults * 4)
  const collectedAt = new Date().toISOString()
  const results = new Map<string, CollectedSignal>()
  for (let index = 0; index < count && results.size < maxResults; index += 1) {
    const link = links.nth(index)
    const href = await link.getAttribute('href').catch(() => null)
    if (!href) continue
    const sourceUrl = normalizeTrendSourceUrl(platform, new URL(href, page.url()).toString())
    if (!sourceUrl) continue
    const text = cleanTrendText(await cardText(link), 1000)
    const linkText = cleanTrendText(await link.innerText().catch(() => ''), 500)
    const title = cleanTrendText(linkText.length >= 2 ? linkText : text.split(/\n/)[0], 500)
    if (title.length < 2) continue
    const tags = extractTags(text)
    const candidateTerms = extractCandidateTerms(title, tags)
    if (candidateTerms.length === 0) continue
    const externalId = externalIdFromUrl(platform, sourceUrl)
    results.set(externalId, {
      externalId,
      sourceUrl,
      title,
      excerpt: text !== title ? text.slice(0, 1000) : null,
      tags,
      candidateTerms,
      queryTerm: query,
      publishedAt: null,
      collectedAt,
      metrics: parseMetrics(text),
    })
  }
  return [...results.values()]
}

async function sendRun(config: CollectorConfig, platform: TrendPlatform, report: {
  id: string
  status: 'completed' | 'failed' | 'blocked'
  startedAt: string
  completedAt: string
  errorCode?: string
  errorMessage?: string
  signals: CollectedSignal[]
}) {
  const ingestUrl = process.env.TREND_INGEST_URL?.trim()
  const secret = process.env.TREND_INGEST_SECRET?.trim()
  if (!ingestUrl || !secret || secret.length < 24) {
    throw new Error('请先在 .env.trend.local 配置 TREND_INGEST_URL 和至少24位的 TREND_INGEST_SECRET')
  }
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      node: { id: config.node.id, name: config.node.name, version: config.node.version },
      run: {
        id: report.id,
        platform,
        status: report.status,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        errorCode: report.errorCode,
        errorMessage: report.errorMessage,
      },
      signals: report.signals,
    }),
  })
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(`接收接口返回 ${response.status}：${String(data.error || '未知错误')}`)
  return data
}

async function setupPlatform(platform: TrendPlatform) {
  const context = await launchPlatformBrowser(platform)
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(HOME_URLS[platform], { waitUntil: 'domcontentloaded' })
  const prompt = createInterface({ input, output })
  try {
    await prompt.question(`请在打开的 ${platform} 浏览器中完成登录，确认首页可正常使用后按 Enter 保存登录状态…`)
  } finally {
    prompt.close()
    await context.close()
  }
}

async function collectPlatform(config: CollectorConfig, platform: TrendPlatform) {
  const startedAt = new Date().toISOString()
  const runId = randomUUID()
  const signals = new Map<string, CollectedSignal>()
  let status: 'completed' | 'failed' | 'blocked' = 'completed'
  let errorCode: string | undefined
  let errorMessage: string | undefined
  let context: BrowserContext | null = null
  try {
    context = await launchPlatformBrowser(platform)
    const page = context.pages()[0] ?? await context.newPage()
    for (const query of config.platforms[platform].queries) {
      console.log(`[${PLATFORM_NAME[platform]}] 正在检查：${query}`)
      const rows = await collectQuery(page, platform, query, config.maxResultsPerQuery)
      for (const row of rows) {
        const existing = signals.get(row.externalId)
        if (!existing) signals.set(row.externalId, row)
        else {
          existing.tags = [...new Set([...existing.tags, ...row.tags])].slice(0, 20)
          existing.candidateTerms = [...new Set([...existing.candidateTerms, ...row.candidateTerms])].slice(0, 20)
        }
      }
      console.log(`[${PLATFORM_NAME[platform]}] ${query}：取得 ${rows.length} 条有效公开信号`)
      await page.waitForTimeout(config.delayBetweenQueriesMs)
    }
  } catch (error) {
    status = error instanceof CollectorBlockedError ? 'blocked' : 'failed'
    errorCode = error instanceof CollectorBlockedError ? 'LOGIN_OR_VERIFICATION_REQUIRED' : 'COLLECTION_FAILED'
    errorMessage = cleanTrendText(error instanceof Error ? error.message : String(error), 1000)
  } finally {
    await context?.close().catch(() => undefined)
  }

  const result = await sendRun(config, platform, {
    id: runId,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    errorCode,
    errorMessage,
    signals: [...signals.values()],
  })
  console.log(`[${PLATFORM_NAME[platform]}] 已上报：${status}，${signals.size} 条信号，${String(result.terms ?? 0)} 个候选词`)
}

const PLATFORM_NAME: Record<TrendPlatform, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  xiaoheihe: '小黑盒',
}

async function main() {
  loadLocalEnvironment()
  const config = loadConfig()
  const platforms = parsePlatformArgument(config)
  if (process.argv.includes('--setup')) {
    for (const platform of platforms) await setupPlatform(platform)
    console.log('登录状态已经保存在本机独立资料目录中。')
    return
  }
  for (const platform of platforms) await collectPlatform(config, platform)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
