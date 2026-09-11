import { createClient } from '@supabase/supabase-js'
import {
  fetchAppStoreChartIds,
  lookupAppStoreApps,
  searchAppStoreApps,
  type AppStoreLookupResult,
} from '../lib/app-store'
import {
  APP_STORE_DISCOVERY_COUNTRIES,
  appStoreDailyDiscoveryPlan,
} from '../lib/app-store-discovery'
import { importAppStoreResults } from '../lib/app-store-import'

function argument(name: string): string {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() ?? ''
}

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!supabaseUrl || !serviceKey) throw new Error('缺少 Supabase GitHub Actions secrets')

  const requestedCountry = (argument('country') || process.env.DISCOVERY_COUNTRY || '').toLowerCase()
  const queryCount = Number.parseInt(argument('query-count') || process.env.QUERY_COUNT || '8', 10)
  const includeCharts = (argument('include-charts') || process.env.INCLUDE_CHARTS || 'true') !== 'false'
  const plan = appStoreDailyDiscoveryPlan(new Date(), queryCount)
  const country = APP_STORE_DISCOVERY_COUNTRIES.includes(requestedCountry as typeof APP_STORE_DISCOVERY_COUNTRIES[number])
    ? requestedCountry
    : plan.country
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const discovered = new Map<string, AppStoreLookupResult>()
  let failedRequests = 0

  console.log(`App Store 目录扩展：地区=${country.toUpperCase()}，搜索词=${plan.terms.join('、')}，榜单=${includeCharts ? '是' : '否'}`)

  if (includeCharts) {
    for (const chart of plan.charts) {
      try {
        const ids = await fetchAppStoreChartIds(chart, country, 100)
        const rows = await lookupAppStoreApps(ids, country)
        for (const row of rows) discovered.set(row.bundleId, row)
        console.log(`${chart}: 取得 ${rows.length} 个应用`)
      } catch (error) {
        failedRequests += 1
        console.error(`${chart}: ${error instanceof Error ? error.message : error}`)
      }
      await wait(4_000)
    }
  }

  for (const [index, term] of plan.terms.entries()) {
    try {
      const rows = await searchAppStoreApps(term, country, 200)
      for (const row of rows) discovered.set(row.bundleId, row)
      console.log(`[${index + 1}/${plan.terms.length}] ${term}: 取得 ${rows.length}，本轮去重后 ${discovered.size}`)
    } catch (error) {
      failedRequests += 1
      console.error(`${term}: ${error instanceof Error ? error.message : error}`)
    }
    if (index < plan.terms.length - 1) await wait(4_000)
  }

  if (discovered.size === 0) throw new Error('本轮没有发现任何应用')
  const stats = await importAppStoreResults(service, [...discovered.values()], country, null)
  console.log(JSON.stringify({ country, discovered: discovered.size, failedRequests, ...stats }, null, 2))
  if (failedRequests >= Math.max(3, Math.ceil((plan.terms.length + 2) / 2))) {
    throw new Error(`本轮有 ${failedRequests} 个 Apple 请求失败，已保留成功取得的资料`)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
