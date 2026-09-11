import { createClient } from '@supabase/supabase-js'
import {
  fetchAppStoreChartIds,
  isAppStoreGame,
  lookupAppStoreApps,
  searchAppStoreApps,
  type AppStoreLookupResult,
} from '../lib/app-store'
import {
  APP_STORE_DISCOVERY_COUNTRIES,
  APP_STORE_GAME_DISCOVERY_TERMS,
  APP_STORE_DISCOVERY_MODES,
  appStoreDailyDiscoveryPlan,
  type AppStoreDiscoveryMode,
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
  const queryCount = Number.parseInt(argument('query-count') || process.env.QUERY_COUNT || '12', 10)
  const requestedMode = (argument('mode') || process.env.DISCOVERY_MODE || 'mixed').toLowerCase()
  const mode: AppStoreDiscoveryMode = APP_STORE_DISCOVERY_MODES.includes(requestedMode as AppStoreDiscoveryMode)
    ? requestedMode as AppStoreDiscoveryMode
    : 'mixed'
  const includeCharts = (argument('include-charts') || process.env.INCLUDE_CHARTS || 'true') !== 'false'
  const plan = appStoreDailyDiscoveryPlan(new Date(), queryCount, mode)
  const country = APP_STORE_DISCOVERY_COUNTRIES.includes(requestedCountry as typeof APP_STORE_DISCOVERY_COUNTRIES[number])
    ? requestedCountry
    : plan.country
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const discovered = new Map<string, AppStoreLookupResult>()
  let failedRequests = 0

  console.log(`App Store 目录扩展：地区=${country.toUpperCase()}，模式=${plan.mode}，搜索词=${plan.terms.join('、')}，榜单=${includeCharts ? '是' : '否'}`)

  if (includeCharts) {
    for (const chart of plan.charts) {
      try {
        const ids = await fetchAppStoreChartIds(chart, country, 100)
        const lookupRows = await lookupAppStoreApps(ids, country)
        const rows = mode === 'games'
          ? lookupRows.filter(isAppStoreGame)
          : mode === 'apps'
            ? lookupRows.filter(row => !isAppStoreGame(row))
            : lookupRows
        for (const row of rows) discovered.set(row.bundleId, row)
        console.log(`${chart}: 取得 ${lookupRows.length}，按模式保留 ${rows.length}`)
      } catch (error) {
        failedRequests += 1
        console.error(`${chart}: ${error instanceof Error ? error.message : error}`)
      }
      await wait(4_000)
    }
  }

  for (const [index, term] of plan.terms.entries()) {
    try {
      const searchRows = await searchAppStoreApps(term, country, 200)
      const expectsGames = mode === 'games' || APP_STORE_GAME_DISCOVERY_TERMS.includes(term)
      const rows = expectsGames
        ? searchRows.filter(isAppStoreGame)
        : searchRows.filter(row => !isAppStoreGame(row))
      for (const row of rows) discovered.set(row.bundleId, row)
      console.log(`[${index + 1}/${plan.terms.length}] ${term}: 取得 ${searchRows.length}，分类校验后 ${rows.length}，本轮去重后 ${discovered.size}`)
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
