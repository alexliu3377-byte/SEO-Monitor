import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { fetchSiteResearchSummary } from '../lib/site-research-summary'
import { fetchAllRows } from '../lib/supabase-paginate'
import * as work from '../lib/diagnostic-work'

test('missing or failed counts reject before partial pages can be read', async () => {
  for (const result of [{ count: null, error: { message: 'timeout' } }, { count: null, error: null }]) {
    const service = { from() { return { select() { return this }, eq() { return this }, gte() { return this }, lte() { return this },
      then(resolve: (value: unknown) => void) { resolve(result) }, range() { assert.fail('partial page must not be read') },
    } } }
    await assert.rejects(fetchSiteResearchSummary(service, 's', '2026-01-01', '2026-04-01'), /计数失败/)
  }
})

test('all nested pagination shares four slots and keeps complete results', async () => {
  const schedule = work.createQueryLimiter(4)
  let active = 0, peak = 0
  const rows = await Promise.all(Array.from({ length: 6 }, () => fetchAllRows(async (from, to) => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active--
    return { data: Array.from({ length: Math.max(0, Math.min(to + 1, 6001) - from) }, (_, n) => from + n), error: null }
  }, { countHint: 6001, schedule })))
  assert.equal(peak, 4)
  for (const page of rows) assert.deepEqual(page, Array.from({ length: 6001 }, (_, n) => n))
  await assert.rejects(schedule(async () => { throw new Error('failed') }))
  assert.equal(await schedule(async () => 42), 42)
})

for (const allFail of [true, false]) test(`diagnostic failure reporting (allFail=${allFail})`, async () => {
  let modelCalls = 0
  const saved: any[] = []
  const sites = [{ id: 'good', domain: 'good.test' }, { id: 'bad', domain: 'bad.test' }]
  const service = { from(table: string) {
    if (table === 'user_profiles') return { select() { return this }, eq() { return this }, single: async () => ({ data: { role: 'super' } }) }
    assert.equal(table, 'site_diagnostics')
    return { insert(value: unknown) { saved.push(value); return this }, select() { return this }, single: async () => ({ data: { id: 'saved' }, error: null }) }
  } }
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase-server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) } }), createServiceClient: () => service },
    '@/lib/site-research-summary': { fetchSiteResearchSummary: async (_: unknown, id: string) => { if (allFail || id === 'bad') throw new Error('fixture error'); return {} } },
    '@/lib/environment-stats': { computeEnvironmentStats: async () => null },
    '@/lib/tracking-summary': { fetchOwnSiteDomains: async () => new Set() },
    '@/lib/opportunity-gap': { computeOpportunityGaps: async () => ({ gaps: [] }) },
    '@/lib/domain-lookup': { extractDomainTokens: () => [], resolveDomains: async () => ({ matched: sites, unmatched: [] }) },
    '@/lib/site-diagnostic-prompt': { buildDiagnosticPrompt: () => 'prompt' },
    '@/lib/gemini': { QUALITY_MODELS: [], callGeminiJSON: async () => { modelCalls++; return { result: { diagnosis: 'analysis' } } } },
    '@/lib/diagnostic-work': work,
  }
  const exports: any = {}
  const source = readFileSync(new URL('../app/api/research/site-diagnostics/route.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, console: { error() {} }, require: (name: string) => { assert.ok(name in deps, name); return deps[name] } })
  const response = await exports.POST(new Request('https://fixture.test', { method: 'POST', body: JSON.stringify({ question: 'check sites' }) }))
  const body = await response.json()
  assert.equal(response.status, allFail ? 503 : 200)
  assert.equal(modelCalls, allFail ? 0 : 1)
  if (allFail) assert.equal(saved.length, 0)
  else {
    assert.deepEqual(body.failed_sites, ['bad.test'])
    assert.equal(body.matched_sites.length, 1)
    assert.match(saved[0].result, /bad.test.*读取失败/)
    assert.equal(saved[0].site_ids.join(','), 'good')
  }
})
