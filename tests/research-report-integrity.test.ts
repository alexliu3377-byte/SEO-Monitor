import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { mapWithConcurrency } from '../lib/diagnostic-work'
import { fetchSiteTrendStats } from '../lib/site-research-summary'

for (const fail of ['', 'weight_history', 'index_snapshots', 'both']) test(`trend query distinguishes empty data and errors: ${fail}`, async () => {
  const service = { from(table: string) { return {
    select() { return this }, eq() { return this }, gte() { return this }, lte() { return this }, order() { return this },
    then(resolve: (v: unknown) => void) { resolve({ data: [], error: fail === table || fail === 'both' ? { message: 'timeout' } : null }) },
  } } }
  if (fail) await assert.rejects(fetchSiteTrendStats(service, 's', '2026-01-01', '2026-10-28'), /趋势资料读取失败/)
  else assert.deepEqual(await fetchSiteTrendStats(service, 's', '2026-01-01', '2026-10-28'), { weightTrend: [], indexTrend: [] })
})

for (const mode of ['old', 'new', 'no-weight', 'weight-error', 'analysis-error']) test(`report weight fallback: ${mode}`, async () => {
  let reads = 0, active = 0, peak = 0
  const analyses = Array.from({ length: 9 }, (_, i) => ({ site_id: `s${i}`, pc_weight: mode === 'new' ? 4 : null, mobile_weight: mode === 'new' ? 3 : null }))
  analyses.push(analyses[0])
  const service = { from(table: string) {
    let siteId = '', limit = 0
    const orders: string[] = []
    return { select() { return this }, eq(key: string, value: string) { if (key === 'site_id') siteId = value; return this }, single() { return this }, maybeSingle() { return this },
      order(key: string, opts: { ascending: boolean }) { assert.equal(opts.ascending, false); orders.push(key); return this }, limit(value: number) { limit = value; return this },
      async then(resolve: (v: unknown) => void) {
        if (table === 'weight_history') {
          reads++; assert.ok(siteId); assert.equal(limit, 1); assert.deepEqual(orders, ['record_date', 'id'])
          active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 1)); active--
        }
        resolve({ data: table === 'user_profiles' ? { role: 'super' } : table === 'research_reports' ? { id: 'report', site_analyses: analyses } : table === 'research_report_sites' ? [] : mode === 'no-weight' ? null : { pc_weight: 9, mobile_weight: 8 }, error: (mode === 'weight-error' && table === 'weight_history') || (mode === 'analysis-error' && table === 'research_report_sites') ? { message: 'timeout' } : null })
      },
    }
  } }
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json } }, '@/lib/diagnostic-work': { mapWithConcurrency },
    '@/lib/supabase-server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) } }), createServiceClient: () => service },
  }
  const exports: any = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/api/research/reports/[id]/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (name: string) => deps[name] })
  const response = await exports.GET(new Request('https://fixture.test'), { params: Promise.resolve({ id: 'report' }) })
  assert.equal(response.status, mode.endsWith('error') ? 503 : 200)
  assert.ok(peak <= 4)
  if (mode === 'new' || mode === 'analysis-error') assert.equal(reads, 0)
  if (mode === 'old') { assert.equal(reads, 9); assert.equal((await response.json()).siteWeights.s0.pc, 9) }
  if (mode === 'no-weight') assert.deepEqual((await response.json()).siteWeights, {})
})
