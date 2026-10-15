import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadTaskGroupSiteOptions } from '../lib/task-group-site-options'

type Row = Record<string, unknown>

function mockService(sites: Row[], grants: Row[] = [], failingTable?: string) {
  const queries: { table: string; columns: string }[] = []
  return {
    queries,
    from(table: string) {
      let columns = ''
      const filters: ((row: Row) => boolean)[] = []
      let orderColumn = 'id'
      const query = {
        select(value: string) { columns = value; queries.push({ table, columns }); return query },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query },
        in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query },
        order(column: string) { orderColumn = column; return query },
        async range(from: number, to: number) {
          if (table === failingTable) return { data: null, error: { message: 'database unavailable' } }
          const rows = (table === 'sites' ? sites : grants)
            .filter(row => filters.every(filter => filter(row)))
            .sort((a, b) => String(a[orderColumn]).localeCompare(String(b[orderColumn])))
            .slice(from, to + 1)
            .map(row => Object.fromEntries(columns.split(',').map(column => [column.trim(), row[column.trim()]])))
          return { data: rows, error: null }
        },
      }
      return query
    },
  }
}

function site(id: string, focus: number, category = 'large') {
  return { id, domain: `${id}.example`, name: id, category, focus_level: focus, is_enabled: true, has_rank_data: true,
    list_url: 'private crawler configuration', selectors: { secret: true } }
}

const sites = [site('own', 1, 'small'), site('protected', 2), site('competitor', 3), site('public-grant', 3, 'medium')]
const grants = [{ user_id: 'leader', site_id: 'own' }, { user_id: 'leader', site_id: 'public-grant' },
  { user_id: 'other', site_id: 'protected' }]

test('leader sees public competitor sources plus granted sites, but can only assign granted owned sites', async () => {
  const result = await loadTaskGroupSiteOptions(mockService(sites, grants), { id: 'leader', role: 'admin' })
  assert.deepEqual(result.ownedSites.map(row => row.id), ['public-grant', 'own'])
  assert.deepEqual(result.filterSites.map(row => row.id), ['competitor', 'public-grant', 'own'])
  assert.equal(result.filterSites.some(row => row.id === 'protected'), false)
  assert.equal(result.ownedSites.some(row => row.id === 'competitor'), false)
  assert.equal(new Set(result.filterSites.map(row => row.id)).size, result.filterSites.length)
})

test('admin with no grants still gets public sources, never other protected sites', async () => {
  const result = await loadTaskGroupSiteOptions(mockService(sites, grants), { id: 'new-leader', role: 'admin' })
  assert.deepEqual(result.ownedSites, [])
  assert.deepEqual(result.filterSites.map(row => row.id), ['competitor', 'public-grant'])
})

test('super gets all sites but only minimal display fields, not crawl configuration', async () => {
  const service = mockService(sites, grants)
  const result = await loadTaskGroupSiteOptions(service, { id: 'owner', role: 'super' })
  assert.equal(result.ownedSites.length, sites.length)
  assert.deepEqual(result.filterSites, result.ownedSites)
  assert.deepEqual(Object.keys(result.filterSites[0]).sort(), ['category', 'domain', 'has_rank_data', 'id', 'is_enabled', 'name'])
  assert.ok(service.queries.every(query => !query.columns.includes('*')))
})

test('ordinary users cannot enumerate group editing site options', async () => {
  const service = mockService(sites, grants)
  await assert.rejects(loadTaskGroupSiteOptions(service, { id: 'member', role: 'normal' }), /Forbidden/)
  assert.deepEqual(service.queries, [])
})

test('site enumeration is stable and complete beyond a single database page', async () => {
  const rows = Array.from({ length: 3005 }, (_, i) => site(`site-${String(i).padStart(5, '0')}`, 3))
  const result = await loadTaskGroupSiteOptions(mockService(rows), { id: 'leader', role: 'admin' })
  assert.equal(result.filterSites.length, rows.length)
  assert.equal(new Set(result.filterSites.map(row => row.id)).size, rows.length)
})

test('grant/source lookup errors fail closed instead of returning an incomplete success', async () => {
  for (const table of ['user_site_access', 'sites']) {
    await assert.rejects(loadTaskGroupSiteOptions(mockService(sites, grants, table), { id: 'leader', role: 'admin' }), /database unavailable/)
  }
})

test('editing uses separate lists with retry feedback; owned-site save authorization stays intact', () => {
  const route = readFileSync(new URL('../app/api/task-groups/site-options/route.ts', import.meta.url), 'utf8')
  assert.match(route, /if \(!caller\)/)
  assert.match(route, /caller\.role !== 'admin' && caller\.role !== 'super'/)
  assert.match(route, /private, no-store/)
  const page = readFileSync(new URL('../app/(dashboard)/task-groups/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /fetch\('\/api\/task-groups\/site-options', \{ cache: 'no-store' \}\)/)
  assert.match(page, /setAllSites\(data\.ownedSites\)/)
  assert.match(page, /setFilterSites\(data\.filterSites\)/)
  assert.match(page, /const catSites = filterSites\.filter/)
  assert.match(page, /allSites\.filter\(s => s\.domain\.includes\(siteSearch\)/)
  assert.match(page, /onClick=\{onRetrySites\}/)
  assert.match(page, /disabled=\{busy \|\| sitesLoading \|\| !!sitesError/)
  for (const path of ['../app/api/task-groups/route.ts', '../app/api/task-groups/[id]/route.ts']) {
    assert.match(readFileSync(new URL(path, import.meta.url), 'utf8'), /canAdminUseGroupSites\(service, caller\.id, caller\.role, normalizedSiteDomains\)/)
  }
})
