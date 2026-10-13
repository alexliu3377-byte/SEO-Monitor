// Public-page browser audit: no account creation, sign-in or mutation.
import { chromium } from 'playwright'
const base = process.env.TREND_INGEST_URL ? new URL(process.env.TREND_INGEST_URL).origin : 'https://seo-monitor-iota.vercel.app'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const events = []
const safeUrl = raw => { try { const url = new URL(raw); return `${url.origin}${url.pathname.slice(0, 90)}` } catch { return String(raw).slice(0, 120) } }
page.on('pageerror', error => events.push({ kind: 'pageerror', text: error.message.slice(0, 400) }))
page.on('console', message => {
  if (['error', 'warning'].includes(message.type())) events.push({ kind: `console.${message.type()}`, text: message.text().slice(0, 400), source: safeUrl(message.location().url) })
})
page.on('requestfailed', request => events.push({ kind: 'requestfailed', url: safeUrl(request.url()), text: request.failure()?.errorText }))
page.on('response', response => {
  if (response.status() >= 400) events.push({ kind: 'http_error', status: response.status(), url: safeUrl(response.url()) })
})
await page.addInitScript(() => {
  window.__auditLcp = null
  new PerformanceObserver(list => {
    const last = list.getEntries().at(-1)
    if (last) window.__auditLcp = { ms: Math.round(last.startTime), tag: last.element?.tagName }
  }).observe({ type: 'largest-contentful-paint', buffered: true })
})
try {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(8000)
  const summary = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource')
    const scripts = resources.filter(item => item.initiatorType === 'script')
    return {
      title: document.title,
      finalPath: location.pathname,
      ttfbMs: Math.round(navigation.responseStart),
      domReadyMs: Math.round(navigation.domContentLoadedEventEnd),
      loadMs: Math.round(navigation.loadEventEnd),
      lcp: window.__auditLcp,
      scriptCount: scripts.length,
      scriptTransferBytes: scripts.reduce((sum, item) => sum + item.transferSize, 0),
      scripts: scripts.map(item => ({ path: new URL(item.name).pathname, transferBytes: item.transferSize, decodedBytes: item.decodedBodySize, durationMs: Math.round(item.duration) })),
    }
  })
  console.log(JSON.stringify({ scope: 'public login page only', summary, events }))
} finally {
  await browser.close()
}
