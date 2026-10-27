import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { assertSafeRemoteUrl, fetchPublicUrl } from '../lib/safe-remote-url'

test('public IPv4, native IPv6 and mapped IPv6 remain valid without network access', async () => {
  for (const url of ['https://8.8.8.8/', 'https://[2606:4700:4700::1111]/', 'https://[::ffff:8.8.8.8]/']) {
    assert.equal((await assertSafeRemoteUrl(url)).href, new URL(url).href)
  }
})

test('redirects to mapped private addresses are blocked before the second fetch', async t => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    calls.push(String(input))
    return new Response(null, { status: 302, headers: { location: 'http://[::ffff:169.254.169.254]/' } })
  })
  await assert.rejects(fetchPublicUrl('https://8.8.8.8/'), /内部网络地址/)
  assert.deepEqual(calls, ['https://8.8.8.8/'])
})

// Execute the real route with in-memory auth/database/cache dependencies.
// Never import production clients, environment files, or perform network I/O.
function refreshFixture(role: string | null) {
  const writes: string[] = []
  const scopeChecks: string[] = []
  const groups = [{ id: 'assigned', name: 'Assigned' }, { id: 'unassigned', name: 'Unassigned' }]
  const service = {
    from(table: string) {
      let filter: string | undefined
      const query = {
        select() { return query },
        eq(_key: string, value: string) { filter = value; return query },
        single: async () => ({ data: { role }, error: null }),
        then(resolve: (value: unknown) => unknown) {
          assert.equal(table, 'task_groups')
          return Promise.resolve({ data: filter ? groups.filter(g => g.id === filter) : groups, error: null }).then(resolve)
        },
      }
      return query
    },
  }
  const exported: { GET?: (request: Request) => Promise<Response> } = {}
  const source = readFileSync(new URL('../app/api/tracking-cache/refresh/route.ts', import.meta.url), 'utf8')
  const context = {
    exports: exported, URL, console, process: { env: { CRON_SECRET: 'fixture-secret' } },
    require(name: string) {
      if (name === 'next/server') return { NextResponse: { json: Response.json } }
      if (name === '@/lib/supabase-server') return {
        createClient: async () => ({ auth: { getUser: async () => ({ data: { user: role ? { id: 'fixture-user' } : null } }) } }),
        createServiceClient: () => service,
      }
      if (name === '@/lib/group-tracking-cache') return {
        computeGroupTrackingPayload: async (_service: unknown, group: string) => { writes.push(`compute:${group}`); return [] },
        saveGroupTrackingPayload: async (_service: unknown, group: string) => { writes.push(`save:${group}`) },
      }
      if (name === '@/lib/task-group-access') return {
        canAccessTaskGroup: async (_service: unknown, _user: string, callerRole: string, group: string) => {
          scopeChecks.push(group)
          return callerRole === 'super' || group === 'assigned'
        },
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return {
    writes, scopeChecks,
    get: (query = '', bearer = '') => exported.GET!(new Request(`https://fixture.invalid/api/tracking-cache/refresh${query}`, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    })),
  }
}

test('admin cannot refresh every group by omitting or emptying groupId', async () => {
  for (const query of ['', '?groupId=']) {
    const fixture = refreshFixture('admin')
    assert.equal((await fixture.get(query)).status, 403)
    assert.deepEqual(fixture.writes, [])
  }
})

test('admin refresh checks scope and only computes the requested authorized group', async () => {
  const denied = refreshFixture('admin')
  assert.equal((await denied.get('?groupId=unassigned')).status, 403)
  assert.deepEqual(denied.writes, [])
  assert.deepEqual(denied.scopeChecks, ['unassigned'])
  const allowed = refreshFixture('admin')
  assert.equal((await allowed.get('?groupId=assigned')).status, 200)
  assert.deepEqual(allowed.scopeChecks, ['assigned'])
  assert.deepEqual(allowed.writes, ['compute:assigned', 'save:assigned'])
})

test('super and authenticated service retain all-group refresh', async () => {
  for (const [role, bearer] of [['super', ''], [null, 'fixture-secret']] as const) {
    const fixture = refreshFixture(role)
    assert.equal((await fixture.get('', bearer)).status, 200)
    assert.deepEqual(fixture.writes, ['compute:assigned', 'save:assigned', 'compute:unassigned', 'save:unassigned'])
  }
})

test('normal users and invalid service credentials never compute or write caches', async () => {
  for (const role of ['normal', null]) {
    const fixture = refreshFixture(role)
    assert.ok([401, 403].includes((await fixture.get('?groupId=assigned', 'wrong-secret')).status))
    assert.deepEqual(fixture.writes, [])
  }
})
