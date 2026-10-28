import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { fetchAllRows } from '../lib/supabase-paginate'
import { createDiagnosticCache } from '../lib/diagnostic-work'

for (const failure of ['timeout', 'missing', 'named-error', 'volume', 'sites', 'seeds', 'own', 'none']) test(`coverage handles ${failure}`, async () => {
  let rawReads = 0, rpcReads = 0
  const rank = { id: 'r', site_id: 's', keyword: 'word', platform: 'mobile', rank_position: 1 }
  const service = {
    rpc() { rpcReads++; return { range: async () => ({ data: failure === 'timeout' || failure === 'missing' || failure === 'named-error' ? null : [rank], error: failure === 'missing' ? { code: 'PGRST202', message: 'missing' } : failure === 'timeout' || failure === 'named-error' ? { code: '57014', message: failure === 'named-error' ? 'timeout in get_latest_commercial_keyword_coverage' : 'timeout' } : null }) } },
    from(table: string) {
      if (table === 'site_keyword_ranks') rawReads++
      const failed = (failure === 'volume' && table === 'keyword_volume') || (failure === 'sites' && table === 'sites') || (failure === 'seeds' && table === 'commercial_keywords')
      const data = table === 'user_profiles' ? { role: 'super' } : table === 'commercial_keywords' ? [{ keyword: 'word', group_name: 'word' }] : table === 'sites' ? [{ id: 's', domain: 'own.test', name: 'own' }] : table === 'keyword_volume' ? [{ keyword: 'word', volume: 0 }] : [rank]
      return { select() { return this }, eq() { return this }, order() { return this }, in() { return this }, gte() { return this }, range() { return this }, single() { return this }, then(resolve: (v: unknown) => void) { resolve({ data: failed ? null : data, error: failed ? { message: 'fixture failure' } : null }) } }
    }
  }
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase-server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) } }), createServiceClient: () => service },
    '@/lib/crawler': {}, '@/lib/supabase-paginate': { fetchAllRows },
    '@/lib/tracking-summary': { fetchOwnSiteDomains: async () => { if (failure === 'own') throw Error('fixture'); return new Set(['own.test']) } },
  }
  const exports: any = {}
  const source = readFileSync(new URL('../app/api/research/commercial-keywords/coverage/route.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, setTimeout: (fn: () => void) => fn(), console: { error() {} }, require: (name: string) => deps[name] })
  const response = await exports.POST(new Request('https://fixture.test', { method: 'POST', body: '{}' }))
  const body = await response.json()
  assert.equal(rawReads, failure === 'missing' ? 1 : 0)
  assert.equal(response.status, ['none', 'missing'].includes(failure) ? 200 : ['timeout', 'named-error'].includes(failure) ? 500 : 503)
  if (failure === 'missing') assert.equal(rpcReads, 1)
  if (failure === 'none') { assert.equal(body.coverage[0].searchVolume, 0); assert.equal(body.coverage[0].isOwnSite, true) }
  else if (failure !== 'missing') assert.equal(body.coverage, undefined)
})

test('shared cache preserves maps and sets, merges concurrent reads, expires and isolates keys', async () => {
  let time = 0, calls = 0
  const cache = createDiagnosticCache<{ ownDomains: Set<string>; siteTiers: Map<string, string> }>(() => time)
  const load = async () => { calls++; return { ownDomains: new Set(['own.test']), siteTiers: new Map([['s', 'small']]) } }
  const results = await Promise.all([cache('u:date', load), cache('u:date', load)])
  assert.equal(calls, 1)
  assert.equal(results[0], results[1])
  assert.ok(results[0].ownDomains.has('own.test'))
  await cache('u:date', load); assert.equal(calls, 1)
  await cache('other:date', load); assert.equal(calls, 2)
  time = 60001; await cache('u:date', load); assert.equal(calls, 3)
  await assert.rejects(cache('failed', async () => { throw Error('failure') }))
  await cache('failed', load); assert.equal(calls, 4)
})

test('map and set entries count toward cache memory limit', async () => {
  const cache = createDiagnosticCache(); let calls = 0
  const load = async () => { calls++; return new Set(['x'.repeat(513 * 1024)]) }
  await cache('large', load); await cache('large', load)
  assert.equal(calls, 2)
})
