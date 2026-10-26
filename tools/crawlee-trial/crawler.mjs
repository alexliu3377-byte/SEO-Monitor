import { CheerioCrawler, Configuration, NonRetryableError, Log, LogLevel } from '@crawlee/cheerio'
import { comparePage, SOURCES } from './rules.mjs'

export async function runComparison(sources = SOURCES, { allowLocalForTests = false, quiet = false } = {}) {
  // Production never accepts CLI URLs, enqueues links, uses login cookies, or writes to Supabase.
  for (const source of sources) {
    const url = new URL(source.url)
    if (allowLocalForTests && url.hostname === '127.0.0.1' && url.protocol === 'http:') continue
    if (!SOURCES.some(allowed => allowed.url === url.href && allowed.domain === source.domain)) throw new Error('Source not allowlisted')
  }
  const outcomes = new Map()
  const started = new Map()
  const crawler = new CheerioCrawler({
    log: new Log({ level: quiet ? LogLevel.OFF : LogLevel.ERROR }),
    maxConcurrency: 1, maxRequestRetries: 1, maxRequestsPerCrawl: sources.length,
    useSessionPool: false, retryOnBlocked: false, navigationTimeoutSecs: 25, requestHandlerTimeoutSecs: 35,
    preNavigationHooks: [({ request }, options) => {
      started.set(request.uniqueKey, started.get(request.uniqueKey) ?? performance.now())
      // A redirect is reported, not followed to an unapproved host or private network.
      options.followRedirect = false
      options.maxRedirects = 0
      options.retry = { limit: 0 }
      options.headers = { ...options.headers, 'user-agent': 'Qixin-Readonly-Collection-Trial/1.0', accept: 'text/html' }
    }],
    postNavigationHooks: [({ request, response }) => {
      request.userData.httpStatus = response.statusCode
      if ((response.statusCode >= 300 && response.statusCode < 500) || response.statusCode >= 600) {
        response.destroy()
        throw new NonRetryableError(`HTTP ${response.statusCode}; no redirect, login or CAPTCHA bypass attempted`)
      }
      const maxBytes = 2 * 1024 * 1024
      if (Number(response.headers['content-length']) > maxBytes) {
        response.destroy()
        throw new NonRetryableError('Response exceeds 2 MiB trial limit')
      }
      let received = 0
      response.on('data', chunk => {
        received += Buffer.byteLength(chunk)
        if (received > maxBytes) {
          request.noRetry = true
          response.destroy(new NonRetryableError('Response exceeds 2 MiB trial limit'))
        }
      })
    }],
    requestHandler({ request, $, response }) {
      const source = request.userData.source
      const capturedAt = Date.now()
      const comparison = comparePage($, source, capturedAt)
      outcomes.set(source.domain, {
        domain: source.domain, captured_at: new Date(capturedAt).toISOString(), http_status: response.statusCode,
        attempts: request.retryCount + 1, duration_ms: Math.round(performance.now() - started.get(request.uniqueKey)),
        status: comparison.issues.length ? 'needs_review' : 'passed', ...comparison,
      })
    },
    failedRequestHandler({ request }, error) {
      outcomes.set(request.userData.source.domain, {
        domain: request.userData.source.domain, status: 'failed', http_status: request.userData.httpStatus ?? null,
        attempts: request.retryCount + 1, duration_ms: Math.round(performance.now() - started.get(request.uniqueKey)),
        issues: [error.message.slice(0, 300)],
      })
    },
  }, new Configuration({ persistStorage: false, purgeOnStart: true }))
  // Duplicate enqueue intentionally exercises request-key deduplication without extra HTTP traffic.
  await crawler.run(sources.flatMap(source => [1, 2].map(() => ({ url: source.url, uniqueKey: source.url, userData: { source } }))))
  return sources.map(source => outcomes.get(source.domain) ?? { domain: source.domain, status: 'failed', issues: ['No result recorded'] })
}
