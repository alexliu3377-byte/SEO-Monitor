// Lightweight (no-Playwright) client for aizhan's rank pages.
//
// As of 2026-08 the browser-fingerprint challenge that lib/crawler-browser.ts
// was built to pass (~2min wait, `_jsc_sbu` JS challenge, `__ws_ch_ck` cookie)
// is gone — verified 2026-08-02 via plain curl: a client that follows one
// redirect and resends the `Set-Cookie` it receives gets real data in well
// under a second, no JS execution needed, no headless-browser fingerprint to
// get flagged on. This module replaces the Playwright session for the "rank"
// and "rank-title" crawl steps. See lib/crawl-rules.ts "rank"/"rank-title"
// sections for the full history (this is the third distinct challenge aizhan
// has served since 2026-06 — each time the mechanism changed shape).
//
// IMPORTANT: keep lib/crawler-browser.ts around, don't delete it. If aizhan
// re-hardens the challenge, that Playwright path is the known-working
// fallback — swap the import in scripts/crawl.ts / scripts/crawl-rank.ts back
// to createAizhanBrowserSession / fetchRankChangesViaBrowser /
// fetchRankupWithTitleViaBrowser / fetchRankdownWithTitleViaBrowser. Every
// export here mirrors that module's signature 1:1 (session object instead of
// browser context) so the swap is a one-line import change.
import { randomUA, parseSimpleRankRows, parseTitledRankRows } from './crawler'

type RankType = 'rankup' | 'rankdown'
type Platform = 'mobile' | 'pc'

export interface AizhanHttpSession {
  cookie: string
  ua: string
}

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

// Same markers as lib/crawler-browser.ts's isChallengePage — kept in sync in
// case aizhan reintroduces the harder challenge behind the same wrapper.
function isChallengePage(html: string, title: string): boolean {
  return title.includes('Embed Iframe') || title.includes('安全检测中') || html.includes('_jsc_sbu')
}

function mergeCookie(existing: string, setCookies: string[]): string {
  if (setCookies.length === 0) return existing
  const map = new Map<string, string>()
  for (const pair of existing.split(';').map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=')
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  for (const sc of setCookies) {
    const pair = sc.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

// Single request with manual redirect + JS-cookie-challenge handling. As of
// 2026-08, aizhan alternates between two shapes for the same challenge
// (observed on the same URL, cookie-less, back to back — likely a per-edge-
// node or A/B difference, not something we can predict up front):
//   (a) 302 + a real `Set-Cookie` header — fetch()'s automatic redirect
//       following can't pass this on its own (it never resends Set-Cookie as
//       Cookie on the next hop), so we do the hop ourselves.
//   (b) 200 with a body of `document.cookie="C3VK=...; path=/; max-age=300;"`
//       followed by a same-page `window.open(...)` — no real navigation
//       happens, so we extract the cookie value with a regex (same pattern
//       lib/crawler.ts's older prefetchRankCookie used for a similar-looking
//       but distinct 2026-06 challenge) and re-request the same URL with it.
// Both resolve in a single extra round-trip, no JS execution needed.
async function aizhanRequest(
  url: string,
  session: AizhanHttpSession,
  referer?: string,
  hopsLeft = 3
): Promise<{ html: string; title: string; status: number }> {
  const headers: Record<string, string> = {
    'User-Agent': session.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
  }
  if (session.cookie) headers['Cookie'] = session.cookie
  if (referer) headers['Referer'] = referer

  const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10000), next: { revalidate: 0 } })
  const setCookies = res.headers.getSetCookie?.() ?? []
  if (setCookies.length) session.cookie = mergeCookie(session.cookie, setCookies)

  if (res.status >= 300 && res.status < 400 && hopsLeft > 0) {
    const location = res.headers.get('location')
    if (location) {
      const nextUrl = new URL(location, url).toString()
      return aizhanRequest(nextUrl, session, referer, hopsLeft - 1)
    }
  }

  const html = await res.text().catch(() => '')

  const cookieMatch = html.match(/\.cookie\s*=\s*"([^"]+)"/)
  if (cookieMatch && hopsLeft > 0) {
    const challengeCookie = cookieMatch[1].split(';')[0]
    const beforeMerge = session.cookie
    session.cookie = mergeCookie(session.cookie, [cookieMatch[1]])
    if (session.cookie !== beforeMerge || !beforeMerge.includes(challengeCookie)) {
      return aizhanRequest(url, session, referer, hopsLeft - 1)
    }
    // Same cookie came back again — stuck, fall through and return the challenge page as-is
  }

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
  return { html, title, status: res.status }
}

// Warm up a session: one request to a low-traffic bootstrap page, just to
// collect the initial cookie. Mirrors createAizhanBrowserSession's role but
// takes well under a second instead of ~2 minutes.
export async function createAizhanHttpSession(bootstrapDomain = 'baidu.com'): Promise<AizhanHttpSession> {
  const session: AizhanHttpSession = { cookie: '', ua: randomUA() }
  const url = buildRankUrl(bootstrapDomain, 'rankup', 1, '', 1, 'mobile', true)
  await aizhanRequest(url, session).catch(() => {})
  return session
}

async function fetchHtmlWithRetry(session: AizhanHttpSession, url: string, referer?: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { html, title, status } = await aizhanRequest(url, session, referer)
      if (isChallengePage(html, title)) {
        if (attempt < 3) {
          console.log(`    ⚠ [挑战页] 第${attempt}次 status=${status} title="${title}" ${url}`)
          await new Promise((r) => setTimeout(r, 3000))
          continue
        }
        console.log(`    ✗ [挑战页-放弃] 重试3次仍拦截 status=${status} title="${title}" ${url}`)
        return ''
      }
      if (!html.includes('<tbody')) {
        console.log(`    ? [未知空页] status=${status} title="${title}" htmlLen=${html.length} ${url}`)
      }
      return html
    } catch (e) {
      console.log(`    ✗ [请求异常] 第${attempt}次 ${e instanceof Error ? e.message : e} ${url}`)
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000))
    }
  }
  return ''
}

// Mirrors fetchRankChangesViaBrowser in lib/crawler-browser.ts.
export async function fetchRankChangesViaHttp(
  session: AizhanHttpSession,
  domain: string,
  date: string,
  type: RankType
): Promise<{ keyword: string; volume: number }[]> {
  const isToday = isTodayMY(date)
  const allResults = await Promise.all(
    [1, 2, 3, 4, 5].map(async (rankPos) => {
      const entries: { keyword: string; volume: number }[] = []
      let referer = 'https://baidurank.aizhan.com/'
      for (let p = 1; p <= 15; p++) {
        const url = buildRankUrl(domain, type, rankPos, date, p, 'mobile', isToday)
        const html = await fetchHtmlWithRetry(session, url, referer)
        referer = url
        const pageEntries = parseSimpleRankRows(html)
        if (pageEntries.length === 0) {
          console.log(`    [${domain} ${type} 段${rankPos}] 第${p}页0条，停止翻页（此前已累积${entries.length}条）`)
          break
        }
        entries.push(...pageEntries.filter((e) => e.volume > 0))
        if (p < 15) await new Promise((r) => setTimeout(r, 300))
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
}

async function fetchWithTitleViaHttp(
  session: AizhanHttpSession,
  domain: string,
  date: string,
  type: RankType,
  platform: Platform
): Promise<{ keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[]> {
  const isToday = isTodayMY(date)
  const allResults = await Promise.all(
    [1, 2, 3, 4, 5].map(async (rankPos) => {
      const entries: { keyword: string; volume: number; title: string; url: string; rank_position: number | null; prev_rank: number | null }[] = []
      let referer = 'https://baidurank.aizhan.com/'
      for (let p = 1; p <= 15; p++) {
        const url = buildRankUrl(domain, type, rankPos, date, p, platform, isToday)
        const html = await fetchHtmlWithRetry(session, url, referer)
        referer = url
        const pageEntries = parseTitledRankRows(html)
        if (pageEntries.length === 0) {
          console.log(`    [${domain} ${platform}/${type} 段${rankPos}] 第${p}页0条，停止翻页（此前已累积${entries.length}条）`)
          break
        }
        entries.push(...pageEntries)
        if (p < 15) await new Promise((r) => setTimeout(r, 300))
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
}

// Mirrors fetchRankupWithTitleViaBrowser / fetchRankdownWithTitleViaBrowser.
export async function fetchRankupWithTitleViaHttp(
  session: AizhanHttpSession,
  domain: string,
  date: string,
  platform: Platform = 'mobile'
) {
  return fetchWithTitleViaHttp(session, domain, date, 'rankup', platform)
}

export async function fetchRankdownWithTitleViaHttp(
  session: AizhanHttpSession,
  domain: string,
  date: string,
  platform: Platform = 'mobile'
) {
  return fetchWithTitleViaHttp(session, domain, date, 'rankdown', platform)
}
