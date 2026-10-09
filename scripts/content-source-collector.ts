import { createHash, randomInt } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'

type Source = 'xiaohongshu' | 'xiaoheihe_guide' | 'xiaoheihe_ns' | 'bilibili'
type Target = {
  source: Source
  url: string
  linkSelector: string
  pathPattern: RegExp
  author?: string
}

const TARGETS: Target[] = [
  {
    source: 'xiaohongshu',
    url: 'https://www.xiaohongshu.com/search_result?keyword=%E6%B8%B8%E6%88%8F%E8%B5%84%E6%BA%90%E5%88%86%E4%BA%AB&source=web_search_result_notes&type=51',
    linkSelector: 'a[href*="/explore/"], a[href*="/discovery/item/"]',
    pathPattern: /\/(?:explore|discovery\/item)\//,
  },
  {
    source: 'xiaoheihe_guide',
    url: 'https://xiaoheihe.cn/app/user/profile/90687989',
    linkSelector: 'a[href]',
    pathPattern: /\/(?:app\/bbs\/link|article|news|bbs)\//,
    author: '小黑盒攻略',
  },
  {
    source: 'xiaoheihe_ns',
    url: 'https://xiaoheihe.cn/app/user/profile/85847280',
    linkSelector: 'a[href]',
    pathPattern: /\/(?:app\/bbs\/link|article|news|bbs)\//,
    author: '小黑盒 NS',
  },
  ...['413703', '314849660', '313573880', '3493141279672411'].map(mid => ({
    source: 'bilibili' as const,
    url: `https://space.bilibili.com/${mid}/upload/video`,
    linkSelector: 'a[href*="/video/"]',
    pathPattern: /\/video\/BV[0-9A-Za-z]+/,
    author: `B站 UP ${mid}`,
  })),
]

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

function clean(value: string | null | undefined, maximum: number) {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function profileDirectory(source: Source) {
  const root = resolve(process.env.TREND_PROFILE_DIR || '.trend-browser')
  const platform = source.startsWith('xiaoheihe') ? 'xiaoheihe' : source
  return resolve(root, platform)
}

async function launch(source: Source): Promise<BrowserContext> {
  const platform = source.startsWith('xiaoheihe') ? 'xiaoheihe' : source
  const channel = process.env[`TREND_${platform.toUpperCase()}_BROWSER_CHANNEL`]?.trim()
    || process.env.TREND_BROWSER_CHANNEL
    || 'chrome'
  return chromium.launchPersistentContext(profileDirectory(source), {
    channel,
    headless: process.env.TREND_HEADLESS === 'true',
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Kuala_Lumpur',
  })
}

async function cardText(page: Page, index: number, selector: string) {
  return page.locator(selector).nth(index).evaluate(element => {
    let current: HTMLElement | null = element as HTMLElement
    let best = (current.innerText || current.textContent || '').trim()
    for (let depth = 0; depth < 4 && current.parentElement; depth += 1) {
      current = current.parentElement
      const candidate = (current.innerText || current.textContent || '').trim()
      if (candidate.length >= best.length && candidate.length <= 800) best = candidate
    }
    return best
  }).catch(() => '')
}

async function collectTarget(page: Page, target: Target) {
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.waitForTimeout(12_000)
  const body = clean(await page.locator('body').innerText().catch(() => ''), 5_000)
  if (/安全验证|访问过于频繁|扫码登录|登录后查看|验证码/.test(body)) {
    throw new Error('平台要求登录或人工验证')
  }
  const links = page.locator(target.linkSelector)
  await links.first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => undefined)
  const count = Math.min(await links.count(), 100)
  const items = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < count && items.size < 30; index += 1) {
    const link = links.nth(index)
    const href = await link.getAttribute('href').catch(() => null)
    if (!href) continue
    const url = new URL(href, page.url())
    url.protocol = 'https:'
    if (!target.pathPattern.test(url.pathname)) continue
    const text = clean(await cardText(page, index, target.linkSelector), 800)
    const linkText = clean(await link.innerText().catch(() => ''), 240)
    const title = clean(linkText || text.split(/\n/)[0], 240)
    if (title.length < 2) continue
    const image = link.locator('img').first()
    const coverUrl = await image.getAttribute('src').catch(() => null)
    const sourceId = url.pathname.match(/(?:BV[0-9A-Za-z]+|[0-9a-f]{12,}|\d{6,})/i)?.[0]
      || createHash('sha256').update(url.origin + url.pathname).digest('hex').slice(0, 32)
    items.set(sourceId, {
      sourceId,
      title,
      url: url.toString(),
      coverUrl: coverUrl ? new URL(coverUrl, page.url()).toString() : null,
      author: target.author || null,
      summary: text && text !== title ? text : null,
      publishedAt: null,
    })
  }
  return [...items.values()]
}

async function send(source: Source, items: Record<string, unknown>[]) {
  const base = process.env.TREND_INGEST_URL?.trim()
  const secret = process.env.TREND_INGEST_SECRET?.trim()
  if (!base || !secret) throw new Error('TREND_INGEST_URL / TREND_INGEST_SECRET 未配置')
  const endpoint = new URL('/api/content-feed/ingest', new URL(base).origin)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, items }),
    signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json().catch(() => null) as { accepted?: number; error?: string } | null
  if (!response.ok) throw new Error(`入库失败 HTTP ${response.status}：${result?.error || '未知错误'}`)
  return result?.accepted ?? 0
}

async function main() {
  loadLocalEnvironment()
  const selected = process.argv.includes('--source')
    ? process.argv[process.argv.indexOf('--source') + 1]
    : 'all'
  const targets = selected === 'all' ? TARGETS : TARGETS.filter(target => target.source === selected)
  if (targets.length === 0) throw new Error(`内容来源无效：${selected}`)

  for (const source of [...new Set(targets.map(target => target.source))]) {
    const context = await launch(source)
    try {
      const page = context.pages()[0] ?? await context.newPage()
      for (const target of targets.filter(item => item.source === source)) {
        const items = await collectTarget(page, target)
        const accepted = await send(source, items)
        console.log(`[${source}] ${target.url}：取得 ${items.length} 条，入库 ${accepted} 条`)
        await page.waitForTimeout(randomInt(5_000, 10_001))
      }
    } finally {
      await context.close().catch(() => undefined)
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
