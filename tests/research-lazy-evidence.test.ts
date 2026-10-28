import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { mapWithConcurrency } from '../lib/diagnostic-work'

function route(path: string, service: unknown) {
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase-server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) } }), createServiceClient: () => service },
    '@/lib/tracking-summary': { fetchOwnSiteDomains: async () => new Set() },
    '@/lib/diagnostic-work': { mapWithConcurrency }, '@/lib/supabase-paginate': {},
  }
  const exports: any = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, URL, console, require: (name: string) => deps[name] })
  return exports
}

for (const fail of [false, true]) test(`latest weight uses one scoped row; failure=${fail}`, async () => {
  let active = 0, peak = 0
  const sites = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, domain: `s${i}.test` }))
  const service = { from(table: string) {
    let siteId = '', limit = 0
    const order: string[] = []
    return { select() { return this }, eq(key: string, value: string) { if (key === 'site_id') siteId = value; return this },
      order(key: string, options?: { ascending: boolean }) { if (table === 'weight_history') { assert.equal(options?.ascending, false); order.push(key) }; return this },
      limit(n: number) { limit = n; return this }, single() { return this }, maybeSingle() { return this },
      async then(resolve: (v: unknown) => void) {
        if (table === 'weight_history') {
          assert.ok(siteId); assert.equal(limit, 1); assert.deepEqual(order, ['record_date', 'id'])
          active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 1)); active--
        }
        resolve({ data: table === 'user_profiles' ? { role: 'super' } : table === 'sites' ? sites : { pc_weight: 9, mobile_weight: 8 }, error: fail && table === 'weight_history' ? { message: 'failure' } : null })
      },
    }
  } }
  const response = await route('../app/api/research/competitor-sites/route.ts', service).GET(new Request('https://fixture.test'))
  assert.equal(response.status, fail ? 503 : 200)
  assert.ok(peak <= 4)
  if (!fail) assert.ok((await response.json()).sites.every((s: { pcWeight: number }) => s.pcWeight === 9))
})

for (const mode of ['list', 'evidence', 'empty', 'failed', 'site-failed', 'missing']) test(`discovery evidence ${mode}`, async () => {
  let rankReads = 0
  const service = { from(table: string) {
    if (table === 'site_keyword_ranks') rankReads++
    let limit = 0
    const orders: string[] = []
    return { select() { return this }, eq() { return this }, gte() { return this }, in() { return this },
      ilike(key: string, value: string) { assert.equal(key, 'title'); assert.equal(value, '%a\\%\\_b%'); return this },
      order(key: string) { orders.push(key); return this }, range() { return this }, limit(n: number) { limit = n; return this }, single() { return this }, maybeSingle() { return this },
      then(resolve: (v: unknown) => void) {
        if (table === 'site_keyword_ranks') { assert.equal(limit, 300); assert.deepEqual(orders, ['stat_date', 'rank_position', 'id']) }
        const row = { site_id: 's', title: 'a%_b', url: 'https://fixture.test', platform: 'mobile' }
        const data = table === 'user_profiles' ? { role: 'super' } : table === 'commercial_keyword_discoveries' ? mode === 'missing' ? null : mode === 'list' ? [{ id: 'd' }] : { source_keyword: 'word', matched_alias: 'a%_b' } : table === 'sites' ? [{ id: 's', domain: 'fixture.test', name: 'fixture' }] : mode === 'empty' ? [] : Array.from({ length: 300 }, () => row)
        resolve({ data, count: 1, error: (mode === 'failed' && table === 'site_keyword_ranks') || (mode === 'site-failed' && table === 'sites') ? { message: 'failure' } : null })
      },
    }
  } }
  const response = await route('../app/api/research/commercial-keywords/discoveries/route.ts', service).GET(new Request('https://fixture.test/' + (mode === 'list' ? '' : '?evidenceId=d')))
  assert.equal(response.status, mode === 'missing' ? 404 : mode.endsWith('failed') ? 503 : 200)
  assert.equal(rankReads, mode === 'list' || mode === 'missing' ? 0 : 1)
  const body = await response.json()
  if (mode === 'evidence') { assert.equal(body.evidence.length, 1); assert.equal(body.limited, true) }
  if (mode === 'empty') { assert.equal(body.evidence.length, 0); assert.equal(body.limited, false) }
})
