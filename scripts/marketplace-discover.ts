import { createClient } from '@supabase/supabase-js'
import { canonicalGooglePlayUrl, fetchGooglePlayChart, googlePlayAppToUpdate } from '../lib/google-play'
import { importMarketplaceApps, type MarketplaceApp } from '../lib/marketplace-import'
import { fetchTapTapApp, fetchTapTapTopIds } from '../lib/taptap'

function argument(name: string, fallback = '') {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || fallback
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!supabaseUrl || !serviceKey) throw new Error('缺少 Supabase GitHub Actions secrets')
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const marketplace = argument('marketplace', 'both')
  const country = /^[a-z]{2}$/i.test(argument('country', 'us')) ? argument('country', 'us').toLowerCase() : 'us'
  const limit = Math.min(50, Math.max(1, Number.parseInt(argument('limit', '20'), 10) || 20))
  const items: MarketplaceApp[] = []

  if (marketplace === 'both' || marketplace === 'google_play') {
    for (const category of ['APPLICATION', 'GAME'] as const) {
      const results = await fetchGooglePlayChart(category, limit, country, 'en')
      for (const result of results) {
        const update = googlePlayAppToUpdate(result)
        if (!update) continue
        items.push({
          name: result.title, platform: 'android', packageIdentifier: result.appId,
          sourceName: `Google Play (${country.toUpperCase()})`, sourceType: 'google_play',
          sourceUrl: canonicalGooglePlayUrl(result.appId, country), releases: [update],
        })
      }
      console.log(`Google Play ${category}: ${results.length} 个`)
    }
  }

  if (marketplace === 'both' || marketplace === 'taptap') {
    const ids = await fetchTapTapTopIds(limit)
    for (const [index, id] of ids.entries()) {
      try {
        const result = await fetchTapTapApp(id)
        if (result.title && result.releases.length > 0) items.push({
          name: result.title, platform: 'android', packageIdentifier: `taptap:${id}`,
          sourceName: 'TapTap', sourceType: 'taptap', sourceUrl: result.sourceUrl,
          releases: result.releases.slice(0, 5),
        })
        console.log(`TapTap [${index + 1}/${ids.length}] ${result.title || id}: ${result.releases.length} 条`)
      } catch (error) {
        console.error(`TapTap ${id} 失败：${error instanceof Error ? error.message : String(error)}`)
      }
      if (index < ids.length - 1) await new Promise(resolve => setTimeout(resolve, 1_500))
    }
  }

  const unique = [...new Map(items.map(item => [`${item.sourceType}:${item.packageIdentifier}`, item])).values()]
  const stats = await importMarketplaceApps(service, unique)
  console.log(`批量发现完成：找到 ${stats.found}，新增应用 ${stats.appsCreated}，新增版本 ${stats.releasesCreated}，跳过 ${stats.skipped}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
