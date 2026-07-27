// Playwright-based crawl path for aizhan's rank pages (baidurank.aizhan.com).
//
// Since ~2026-07, aizhan gates these pages behind a browser-fingerprint challenge
// (see lib/crawl-rules.ts "rank"/"rank-title" sections for the full writeup): a
// plain HTTP client — even one that replays every cookie correctly — gets stuck in
// a redirect loop or an "安全检测中" holding page. A real headless Chromium passes
// automatically after ~2 minutes and receives a long-lived `__ws_ch_ck` cookie.
// That cookie is scoped to the browser context (not to a single page or domain),
// so the challenge only needs to be solved once per crawl run — every page opened
// afterwards in the same context can navigate straight to real data.
//
// This module is only imported by scripts/crawl.ts and scripts/crawl-rank.ts
// (both run via `tsx` in GitHub Actions), never by app/api/* routes — keeping
// `playwright` out of the Next.js/Vercel bundle.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { parseSimpleRankRows, parseTitledRankRows } from './crawler'

// Only realistic desktop Chrome UAs — mixing in a Firefox/Safari UA (as the
// fetch-based UA pool in lib/crawler.ts does) would mismatch the real Chromium
// TLS/JS fingerprint the challenge is checking and could hurt more than help.
const BROWSER_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
]

function randomBrowserUA() {
  return BROWSER_UAS[Math.floor(Math.random() * BROWSER_UAS.length)]
}

type RankType = 'rankup' | 'rankdown'
type Platform = 'mobile' | 'pc'

function isTodayMY(date: string): boolean {
  const todayMY = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  return date === todayMY
}

function buildRankUrl(domain: string, type: RankType, rankPos: number, date: string, page: number, platform: Platform, isToday: boolean): string {
  const prefix = platform === 'pc' ? 'baidu' : 'mobile'
  const pageSuffix = page === 1 ? '' : `${page}/`
  return isToday
    ? `https://baidurank.aizhan.com/${prefix}/${domain}/${type}/${rankPos}/${pageSuffix}`
    : `https://baidurank.aizhan.com/${prefix}/${domain}/${type}/${rankPos}/${date}/${pageSuffix}`
}

// Launches a headless browser, opens one throwaway page at a bootstrap URL, and
// polls (every 5s, up to maxWaitMs) for the `__ws_ch_ck` challenge cookie to show
// up in the context. UA is picked once here and stays fixed for the session's
// lifetime — switching UA mid-session would no longer match the fingerprint the
// already-issued cookie was bound to and risks re-triggering the challenge. The
// next call to this function (next job / next day) picks a fresh random UA, so
// rotation still happens — just at session granularity instead of per-request.
export async function createAizhanBrowserSession(
  bootstrapDomain = 'baidu.com',
  maxWaitMs = 150_000
): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: randomBrowserUA() })
  const page = await context.newPage()

  const url = buildRankUrl(bootstrapDomain, 'rankup', 1, '', 1, 'mobile', true)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})

  const deadline = Date.now() + maxWaitMs
  let passed = false
  while (Date.now() < deadline) {
    const cookies = await context.cookies()
    if (cookies.some((c) => c.name === '__ws_ch_ck')) { passed = true; break }
    // Some requests skip the hard challenge outright — treat real content as passing too.
    if ((await page.content().catch(() => '')).includes('<tbody')) { passed = true; break }
    await page.waitForTimeout(5000)
  }
  await page.close()

  if (!passed) {
    await browser.close()
    throw new Error('AIZHAN_CHALLENGE_TIMEOUT')
  }
  return { browser, context }
}

// Even inside an already-challenge-passed context, individual requests can still
// get bounced back to a challenge/blocked page (observed in production 2026-07-27:
// sites showing 0 results on the first attempt, sometimes correcting on the
// site-level retry in scripts/crawl.ts, sometimes not — e.g. greenxf.com dropped
// from 705/595 five days prior to 0/100). Without this check, that page parses to
// zero <tbody> rows indistinguishable from a genuinely-empty result.
function isChallengePage(html: string, title: string): boolean {
  return title.includes('Embed Iframe') || title.includes('安全检测中') || html.includes('_jsc_sbu')
}

async function fetchHtml(page: Page, url: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const [html, title] = await Promise.all([page.content(), page.title()])
      if (!isChallengePage(html, title)) return html
      console.log(`    ⚠ 挑战页拦截（第${attempt}次），3秒后重试: ${url}`)
    } catch {
      // fall through to retry
    }
    if (attempt < 3) await page.waitForTimeout(3000)
  }
  return ''
}

// Fetch all rank changes (涨入 or 跌出) for a domain on a given date, via an
// already-challenge-passed browser context. Mirrors fetchRankChanges in
// lib/crawler.ts: 5 rank positions in parallel (one page per position), pages
// within a position fetched sequentially with a 300ms delay, stop at first
// empty page, dedup by keyword keeping the highest volume.
export async function fetchRankChangesViaBrowser(
  context: BrowserContext,
  domain: string,
  date: string,
  type: RankType
): Promise<{ keyword: string; volume: number }[]> {
  const isToday = isTodayMY(date)
  const pages = await Promise.all([1, 2, 3, 4, 5].map(() => context.newPage()))
  try {
    const allResults = await Promise.all(
      pages.map(async (page, i) => {
        const rankPos = i + 1
        const entries: { keyword: string; volume: number }[] = []
        for (let p = 1; p <= 15; p++) {
          const url = buildRankUrl(domain, type, rankPos, date, p, 'mobile', isToday)
          const html = await fetchHtml(page, url)
          const pageEntries = parseSimpleRankRows(html)
          if (pageEntries.length === 0) break
          entries.push(...pageEntries.filter((e) => e.volume > 0))
          if (p < 15) await page.waitForTimeout(300)
        }
        return entries
      })
    )

    const seen = new Map<string, number>()
    for (const e of allResults.flat()) {
      if (!seen.has(e.keyword) || e.volume > (seen.get(e.keyword) ?? 0)) {
        seen.set(e.keyword, e.volume)
      }
    }
    return Array.from(seen.entries()).map(([keyword, volume]) => ({ keyword, volume }))
  } finally {
    await Promise.all(pages.map((p) => p.close()))
  }
}

async function fetchWithTitleViaBrowser(
  context: BrowserContext,
  domain: string,
  date: string,
  type: RankType,
  platform: Platform
): Promise<{ keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[]> {
  const isToday = isTodayMY(date)
  const pages = await Promise.all([1, 2, 3, 4, 5].map(() => context.newPage()))
  try {
    const allResults = await Promise.all(
      pages.map(async (page, i) => {
        const rankPos = i + 1
        const entries: { keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[] = []
        for (let p = 1; p <= 15; p++) {
          const url = buildRankUrl(domain, type, rankPos, date, p, platform, isToday)
          const html = await fetchHtml(page, url)
          const pageEntries = parseTitledRankRows(html)
          if (pageEntries.length === 0) break
          entries.push(...pageEntries)
          if (p < 15) await page.waitForTimeout(300)
        }
        return entries
      })
    )

    const seen = new Map<string, { volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }>()
    for (const e of allResults.flat()) {
      const cur = seen.get(e.keyword)
      if (!cur || e.volume > cur.volume) seen.set(e.keyword, { volume: e.volume, title: e.title, url: e.url, rank_position: e.rank_position, prev_rank: e.prev_rank })
    }
    return Array.from(seen.entries())
      .map(([keyword, v]) => ({ keyword, ...v }))
      .sort((a, b) => b.volume - a.volume)
  } finally {
    await Promise.all(pages.map((p) => p.close()))
  }
}

// Fetch all rankup (涨入) keywords for a domain, including title/url. Mirrors
// fetchRankupWithTitle in lib/crawler.ts (scripts/crawl-rank.ts uses this).
export async function fetchRankupWithTitleViaBrowser(
  context: BrowserContext,
  domain: string,
  date: string,
  platform: Platform = 'mobile'
) {
  return fetchWithTitleViaBrowser(context, domain, date, 'rankup', platform)
}

// Fetch all rankdown (跌出) keywords for a domain, including title/url. Mirrors
// fetchRankdownWithTitle in lib/crawler.ts (scripts/crawl-rank.ts uses this).
export async function fetchRankdownWithTitleViaBrowser(
  context: BrowserContext,
  domain: string,
  date: string,
  platform: Platform = 'mobile'
) {
  return fetchWithTitleViaBrowser(context, domain, date, 'rankdown', platform)
}
