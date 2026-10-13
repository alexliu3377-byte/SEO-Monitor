// Read-only production health audit. Never prints credentials or raw user data.
// Run with node --env-file=.env.local --env-file=.env.trend.local.
import { performance } from 'node:perf_hooks'

const dbOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const configuredOrigin = process.env.TREND_INGEST_URL
const siteOrigin = configuredOrigin ? new URL(configuredOrigin).origin : 'https://seo-monitor-iota.vercel.app'
if (!dbOrigin || !key) throw new Error('Missing database audit configuration')

const report = { auditedAt: new Date().toISOString(), siteOrigin, checks: [] }
const safeError = value => String(value ?? '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300)

async function dbRead(label, resource, parameters = {}, options = {}) {
  const started = performance.now()
  const url = new URL(`/rest/v1/${resource}`, dbOrigin)
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value)
  try {
    const response = await fetch(url, {
      method: options.head ? 'HEAD' : 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...(options.count ? { Prefer: `count=${options.count}` } : {}) },
      signal: AbortSignal.timeout(15000),
    })
    const text = options.head ? '' : await response.text()
    let data
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    const entry = { label, status: response.status, ms: Math.round(performance.now() - started), bytes: Buffer.byteLength(text), contentRange: response.headers.get('content-range') }
    if (!response.ok) entry.error = { code: data?.code, message: safeError(data?.message || response.statusText) }
    if (options.project && response.ok) entry.summary = options.project(data)
    report.checks.push(entry)
    console.log(JSON.stringify(entry))
    return response.ok ? data : null
  } catch (error) {
    const entry = { label, ms: Math.round(performance.now() - started), error: safeError(error.message) }
    report.checks.push(entry)
    console.log(JSON.stringify(entry))
    return null
  }
}

// Bounded metadata and cache reads. No cache-refresh endpoint or mutating RPC.
const global = await dbRead('global hot radar cache', 'hot_radar_cache', { select: 'id,computed_at,payload', id: 'eq.latest' }, {
  project: rows => rows.map(row => ({ computedAt: row.computed_at, sections: Object.fromEntries(Object.entries(row.payload ?? {}).map(([section, values]) => [section, { rows: Array.isArray(values) ? values.length : null, bytes: Buffer.byteLength(JSON.stringify(values)) }])) })),
})
const groups = await dbRead('task group count and filters', 'task_groups', { select: 'id,rank_domains,new_domains', limit: '100' }, { project: rows => ({ groups: rows.length, filteredGroups: rows.filter(row => row.rank_domains?.length || row.new_domains?.length).length }) })
await dbRead('group hot radar cache availability', 'group_hot_radar_cache', { select: 'group_id,filter_hash,computed_at,source_computed_at', limit: '100' }, { project: rows => ({ rows: rows.length, newest: rows.map(row => row.computed_at).sort().at(-1), oldest: rows.map(row => row.computed_at).sort().at(0), groupsWithoutCache: groups ? groups.filter(group => !rows.some(row => row.group_id === group.id)).length : null }) })
await dbRead('group tracking cache state', 'group_tracking_cache_state', { select: '*', limit: '100' }, { project: rows => ({ rows: rows.length, states: rows.map(row => ({ computedAt: row.computed_at, rowCount: row.row_count, summaryBytes: Buffer.byteLength(JSON.stringify(row)) })) }) })
await dbRead('monthly trend cache state', 'monthly_trend_cache', { select: '*', order: 'computed_at.desc', limit: '2' }, { project: rows => rows.map(row => ({ computedAt: row.computed_at, keys: Object.keys(row), payloadBytes: Buffer.byteLength(JSON.stringify(row.payload)) })) })
await dbRead('word library cache availability', 'wordlib_cache', { select: 'id,computed_at', limit: '10' }, { project: rows => ({ caches: rows }) })

const sources = ['52pojie', '4399', 'ccplay', 'xiaohongshu', 'xiaoheihe_guide', 'xiaoheihe_ns', 'bilibili']
for (const source of sources) {
  await dbRead(`content source ${source}`, 'content_feed_items', { select: 'source,last_seen_at,first_seen_at,published_at', source: `eq.${source}`, order: 'last_seen_at.desc', limit: '1' }, { count: 'exact', project: rows => rows })
}
for (const table of ['raw_keywords', 'rank_changes', 'site_keyword_ranks', 'keyword_volume', 'keyword_signal_rollup', 'member_claimed_keywords', 'site_tracking_records']) {
  // Planned counts use planner estimates; do not force scans of every row.
  await dbRead(`estimated rows ${table}`, table, { select: '*', limit: '1' }, { head: true, count: 'planned' })
}
await dbRead('recent crawl activity state', 'activity_log', { select: 'type,step,logged_at,status,ok_count,empty_count,fail_count,rows_written,duration_ms', order: 'logged_at.desc', limit: '30' }, { project: rows => rows })

const rpcNames = ['get_hot_new_words', 'get_hot_rank_words', 'get_hot_streak_words', 'get_wordlib_words', 'get_group_tracking_outcomes_page']
// OpenAPI describes RPC presence/parameters without invoking expensive queries.
await dbRead('database RPC metadata', '', {}, { project: schema => ({
  tables: Object.keys(schema.definitions ?? {}).length,
  rpcs: rpcNames.map(name => ({ name, exists: !!schema.paths?.[`/rpc/${name}`], parameters: schema.paths?.[`/rpc/${name}`]?.post?.parameters?.map(item => item.schema?.$ref || item.name) ?? [] })),
}) })

for (const route of ['/login', '/content/task-groups', '/api/hot-radar']) {
  const started = performance.now()
  try {
    const response = await fetch(new URL(route, siteOrigin), { redirect: 'manual', signal: AbortSignal.timeout(20000) })
    const text = await response.text()
    const entry = { label: `unauthenticated site ${route}`, status: response.status, ms: Math.round(performance.now() - started), bytes: Buffer.byteLength(text), location: response.headers.get('location'), vercelId: response.headers.get('x-vercel-id'), cache: response.headers.get('x-vercel-cache'), contentSecurityPolicy: response.headers.get('content-security-policy') }
    report.checks.push(entry)
    console.log(JSON.stringify(entry))
  } catch (error) { console.log(JSON.stringify({ label: `unauthenticated site ${route}`, error: safeError(error.message) })) }
}

console.log(JSON.stringify({ auditComplete: true, totalChecks: report.checks.length, globalCacheReadable: !!global?.length, auditedAt: report.auditedAt }))
