import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as overwrite from '../lib/submission-overwrite'
import * as tracking from '../lib/tracking-summary'

function route(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: any[]) => Promise<Response>> = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Buffer, console, require(name: string) {
    if (name === 'next/server') return { NextResponse: { json: Response.json } }
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  } })
  return exports
}
const id = '12345678-1234-4234-8234-123456789abc'

test('overwrite commits only the atomic submission RPC and returns pending-cache success', async () => {
  const calls: string[] = []
  const service = { rpc: async (name: string) => {
    calls.push(name)
    return { data: { keyword: 'updated' }, error: null }
  }, from: () => assert.fail('Must not read or rebuild cache') }
  const api = route('../app/api/task-groups/[id]/submission-overwrite/route.ts', {
    '@/lib/content-access-server': { getContentCaller: async () => ({ caller: { id, role: 'super' }, service }) },
    '@/lib/task-group-access': { canAccessTaskGroup: async () => true },
    '@/lib/user-display-name': {}, '@/lib/submission-overwrite': overwrite,
  })
  const response = await api.POST(new Request('https://fixture.test', { method: 'POST', body: JSON.stringify({ claimId: id, version: 'a'.repeat(32), keyword: 'updated' }) }), { params: Promise.resolve({ id }) })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.success, true)
  assert.equal(body.cacheReady, false)
  assert.match(body.message, /无需重复提交/)
  assert.deepEqual(calls, ['overwrite_group_submission'])
})

for (const ready of [false, true]) test(`detail reads only cached page (ready=${ready})`, async () => {
  const service = { from(table: string) {
    assert.ok(['user_profiles', 'task_group_members'].includes(table), `Unexpected source read ${table}`)
    return { select() { return this }, eq() { return this },
      single: async () => ({ data: { role: 'normal' } }),
      then(resolve: (value: unknown) => void) { resolve({ data: [{ user_id: id, username: 'member' }] }) },
    }
  } }
  const api = route('../app/api/task-groups/[id]/tracking-summary/detail/route.ts', {
    '@/lib/supabase-server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id } } }) } }), createServiceClient: () => service },
    '@/lib/user-display-name': { resolveUserDisplayNames: async () => new Map([[id, 'member']]) },
    '@/lib/task-group-access': { canAccessTaskGroup: async () => true },
    '@/lib/tracking-summary': tracking,
    '@/lib/group-tracking-cache': { loadFastTrackingDetail: async (_: unknown, params: Record<string, unknown>) => {
      assert.equal(params.p_scope_user_id, id)
      return ready ? { rows: [{ keyword: 'cached', user_id: id }], total: 1 } : null
    } },
  })
  const response = await api.GET(new Request('https://fixture.test?month=2026-10&scope=total'), { params: Promise.resolve({ id }) })
  assert.equal(response.status, ready ? 200 : 503)
  const body = await response.json()
  if (ready) { assert.equal(body.total, 1); assert.equal(body.rows[0].user_id, undefined) }
  else assert.equal(body.code, 'CACHE_NOT_READY')
})
