import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { clearRetiredWorkspaceStorage } from '../lib/retired-workspace-storage'

const root = path.resolve(import.meta.dirname, '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : /\.(tsx?|css)$/.test(entry.name) ? [file] : []
  })
}

test('retired page studio has no live pages, API, imports or navigation', () => {
  for (const directory of ['app', 'components', 'lib']) {
    for (const file of sourceFiles(path.join(root, directory))) {
      // A one-way cleanup helper retains storage keys only, never editor code.
      if (file === path.join(root, 'lib/retired-workspace-storage.ts')) continue
      assert.doesNotMatch(readFileSync(file, 'utf8'), /page-studio|grapesjs|design-training-course/, file)
    }
  }
  assert.equal(existsSync(path.join(root, 'app/(dashboard)/design-course/page.tsx')), false)
  assert.equal(existsSync(path.join(root, 'app/(dashboard)/content/design-course/page.tsx')), false)
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  assert.equal(pkg.dependencies.grapesjs, undefined)
  assert.equal(lock.packages['node_modules/grapesjs'], undefined)
})

test('retirement preserves existing project storage migrations', () => {
  assert.equal(existsSync(path.join(root, 'supabase/migrations/20260930_page_studio_cloud_storage.sql')), true)
  assert.equal(existsSync(path.join(root, 'supabase/migrations/20261013_page_studio_summaries.sql')), true)
})

test('retired browser data is removed without touching auth or other workspaces', () => {
  const values = new Map([
    ['sb-example-auth-token', 'session'],
    ['qixin-page-studio-projects-v1', 'old projects'],
    ['radar-date-filter', '2026-10-26'],
    ['qixin-page-studio-favorite-modules-v1', 'old modules'],
    ['page-studio-project:project-123', 'old project'],
    ['page-studio-deleted-projects', 'old tombstones'],
    ['app-update-filters', 'active filters'],
  ])
  const storage = {
    get length() { return values.size },
    key(index: number) { return [...values.keys()][index] ?? null },
    removeItem(key: string) { values.delete(key) },
  }
  clearRetiredWorkspaceStorage(storage)
  assert.deepEqual([...values.entries()], [
    ['sb-example-auth-token', 'session'],
    ['radar-date-filter', '2026-10-26'],
    ['app-update-filters', 'active filters'],
  ])
  clearRetiredWorkspaceStorage(storage)
  assert.equal(values.size, 3)
})

test('inaccessible browser storage does not interrupt the active dashboard', () => {
  assert.doesNotThrow(() => clearRetiredWorkspaceStorage({
    get length(): number { throw new Error('Storage disabled') },
    key() { throw new Error('Storage disabled') },
    removeItem() { throw new Error('Storage disabled') },
  }))
})

test('cloud cleanup targets only retired workspace tables and prevents browser re-imports', () => {
  const sql = readFileSync(path.join(root, 'supabase/migrations/20261026_retire_page_studio_data.sql'), 'utf8')
  assert.deepEqual([...sql.matchAll(/delete from public\.(\w+);/g)].map(match => match[1]), [
    'page_studio_project_versions', 'page_studio_favorite_modules', 'page_studio_projects',
  ])
  assert.match(sql, /revoke insert, update, delete[\s\S]+from public, anon, authenticated;/)
  assert.match(sql, /lock table[\s\S]+in access exclusive mode;/)
  assert.match(sql, /begin;[\s\S]+raise exception[\s\S]+commit;/)
  assert.doesNotMatch(sql, /\b(?:drop table|truncate|cascade)\b/i)
})
