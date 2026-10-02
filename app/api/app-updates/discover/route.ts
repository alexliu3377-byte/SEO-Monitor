export const maxDuration = 300

import { NextResponse } from 'next/server'
import { requireAppUpdateSuper } from '@/lib/app-update-server'
import { fetchAppStoreChartIds, lookupAppStoreApps, parseAppStoreIds } from '@/lib/app-store'
import { importAppStoreResults } from '@/lib/app-store-import'
import {
  canonicalGooglePlayUrl,
  fetchGooglePlayApp,
  fetchGooglePlayChart,
  googlePlayAppToUpdate,
  googlePlayPackageFromUrl,
} from '@/lib/google-play'
import { importMarketplaceApps, type MarketplaceApp } from '@/lib/marketplace-import'
import { fetchTapTapApp, fetchTapTapTopIds, tapTapAppIdFromUrl } from '@/lib/taptap'

const DISCOVERY_TARGETS = ['app_store', 'google_play', 'taptap'] as const
type DiscoveryTarget = (typeof DISCOVERY_TARGETS)[number]

function isDiscoveryTarget(value: unknown): value is DiscoveryTarget {
  return typeof value === 'string' && DISCOVERY_TARGETS.includes(value as DiscoveryTarget)
}

function inputLines(value: unknown, maxItems = 30) {
  if (typeof value !== 'string') return []
  return [...new Set(value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))].slice(0, maxItems)
}

export async function POST(request: Request) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const target = body?.target
  if (!isDiscoveryTarget(target)) {
    return NextResponse.json({ error: '请选择有效的应用商店' }, { status: 400 })
  }
  const country = typeof body?.country === 'string' && /^[a-z]{2}$/i.test(body.country)
    ? body.country.toLowerCase()
    : target === 'app_store' ? 'cn' : 'us'
  const entries = inputLines(body?.entries)

  try {
    if (target === 'app_store') {
      let ids = parseAppStoreIds(entries.join('\n'))
      if (entries.length > 0 && ids.length === 0) {
        return NextResponse.json({ error: '没有识别到有效的 App Store 链接或 Apple ID' }, { status: 400 })
      }
      const mode = ids.length > 0 ? 'specified' : 'catalog'
      if (ids.length === 0) {
        const [freeIds, paidIds] = await Promise.all([
          fetchAppStoreChartIds('top-free', country, 100),
          fetchAppStoreChartIds('top-paid', country, 100),
        ])
        ids = [...new Set([...freeIds, ...paidIds])]
      }
      const results = await lookupAppStoreApps(ids, country)
      if (results.length === 0) return NextResponse.json({ error: '没有找到可导入的 App Store 应用' }, { status: 404 })
      const stats = await importAppStoreResults(access.service, results, country, access.userId)
      return NextResponse.json({ ok: true, target, mode, found: results.length, appsCreated: stats.imported, releasesCreated: stats.releasesCreated })
    }

    const items: MarketplaceApp[] = []
    if (target === 'google_play') {
      const packages = entries.map(googlePlayPackageFromUrl).filter((value): value is string => Boolean(value))
      if (entries.length > 0 && packages.length === 0) {
        return NextResponse.json({ error: '没有识别到有效的 Google Play 链接或应用包名' }, { status: 400 })
      }
      const results = packages.length > 0
        ? await Promise.all(packages.map(packageId => fetchGooglePlayApp(packageId, country, 'en')))
        : (await Promise.all([
            fetchGooglePlayChart('APPLICATION', 20, country, 'en'),
            fetchGooglePlayChart('GAME', 20, country, 'en'),
          ])).flat()
      for (const result of results) {
        const update = googlePlayAppToUpdate(result)
        if (!update) continue
        items.push({
          name: result.title, platform: 'android', packageIdentifier: result.appId,
          sourceName: `Google Play (${country.toUpperCase()})`, sourceType: 'google_play',
          sourceUrl: canonicalGooglePlayUrl(result.appId, country), releases: [update],
        })
      }
    } else {
      const specifiedIds = entries.map(tapTapAppIdFromUrl).filter((value): value is string => Boolean(value))
      if (entries.length > 0 && specifiedIds.length === 0) {
        return NextResponse.json({ error: '没有识别到有效的 TapTap 链接或应用 ID' }, { status: 400 })
      }
      const ids = specifiedIds.length > 0 ? specifiedIds : await fetchTapTapTopIds(20)
      for (const id of ids) {
        try {
          const result = await fetchTapTapApp(id)
          if (!result.title || result.releases.length === 0) continue
          items.push({
            name: result.title, platform: 'android', packageIdentifier: `taptap:${id}`,
            sourceName: 'TapTap', sourceType: 'taptap', sourceUrl: result.sourceUrl,
            releases: result.releases.slice(0, 5),
          })
        } catch (error) {
          console.warn(`TapTap app ${id} skipped:`, error)
        }
      }
    }

    if (items.length === 0) return NextResponse.json({ error: '没有找到包含有效版本资料的应用' }, { status: 404 })
    const unique = [...new Map(items.map(item => [`${item.sourceType}:${item.packageIdentifier}`, item])).values()]
    const stats = await importMarketplaceApps(access.service, unique, access.userId)
    return NextResponse.json({ ok: true, target, mode: entries.length > 0 ? 'specified' : 'catalog', ...stats })
  } catch (error) {
    console.error(`App discovery failed (${target}):`, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '应用发现失败' }, { status: 502 })
  }
}
