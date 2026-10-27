import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { localDevPlan } from '../scripts/start-local-dev.mjs'

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'qixin-local-env-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL=https://test.example\nNEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon\nSUPABASE_SERVICE_ROLE_KEY=fake-service\n')
  return root
}

test('local dev isolates inherited collector credentials and preserves parent environment', t => {
  const parentEnv = { Path: 'windows-path', TREND_INGEST_SECRET: 'fake-live-secret',
    TREND_PROFILE_DIR: 'live-browser', GITHUB_PAT: 'fake-pat', SUPABASE_SERVICE_ROLE_KEY: 'fake-live-service',
    NEXT_PUBLIC_SUPABASE_URL: 'https://live.example', NODE_OPTIONS: '--require unwanted.js' }
  const before = { ...parentEnv }
  const plan = localDevPlan({ root: fixture(t), parentEnv, testProjectUrl: 'https://test.example/' })
  assert.equal(plan.env.TREND_INGEST_SECRET, '')
  assert.equal(plan.env.TREND_PROFILE_DIR, undefined)
  assert.equal(plan.env.GITHUB_PAT, '')
  assert.equal(plan.env.NODE_OPTIONS, undefined)
  assert.equal(plan.env.SUPABASE_SERVICE_ROLE_KEY, 'fake-service')
  assert.equal(plan.env.Path, 'windows-path')
  assert.deepEqual(parentEnv, before)
  assert.deepEqual(plan.args.slice(-4), ['--hostname', '127.0.0.1', '--port', '3001'])
})

test('local dev refuses missing confirmation, target mismatch and invalid ports', t => {
  const options = { root: fixture(t), parentEnv: {}, testProjectUrl: undefined }
  assert.throws(() => localDevPlan(options), /test-project-url/)
  assert.throws(() => localDevPlan({ ...options, testProjectUrl: 'https://other.example' }), /不匹配/)
  assert.throws(() => localDevPlan({ ...options, testProjectUrl: 'https://test.example', port: '0' }), /端口/)
})

test('local dev refuses dotenv fallback files and integration variables in local config', t => {
  const root = fixture(t)
  const options = { root, parentEnv: {}, testProjectUrl: 'https://test.example' }
  writeFileSync(path.join(root, '.env.development.local'), 'TREND_INGEST_SECRET=fake-secret')
  assert.throws(() => localDevPlan(options), /额外的/)
  rmSync(path.join(root, '.env.development.local'))
  writeFileSync(path.join(root, '.env.local'), 'TREND_INGEST_SECRET=fake-secret')
  assert.throws(() => localDevPlan(options), /白名单/)
})
