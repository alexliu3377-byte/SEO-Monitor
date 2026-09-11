import { NextResponse } from 'next/server'
import { appUpdateDatabaseError, requireAppUpdateSuper } from '@/lib/app-update-server'
import {
  fetchAppStoreChartIds,
  isAppStoreChart,
  lookupAppStoreApps,
  parseAppStoreIds,
} from '@/lib/app-store'
import { importAppStoreResults } from '@/lib/app-store-import'

export const maxDuration = 60

export async function POST(request: Request) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const country = typeof body?.country === 'string' && /^[a-z]{2}$/i.test(body.country)
    ? body.country.toLowerCase()
    : 'cn'
  const chart = isAppStoreChart(body?.chart) ? body.chart : null
  const limit = Math.min(100, Math.max(10, Number(body?.limit) || 100))
  let ids = parseAppStoreIds(body?.entries)

  let results
  try {
    if (ids.length === 0 && chart) ids = await fetchAppStoreChartIds(chart, country, limit)
    if (ids.length === 0) {
      return NextResponse.json({ error: '请填写 App Store 链接/ID，或选择一个热门榜单' }, { status: 400 })
    }
    results = await lookupAppStoreApps(ids, country)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'App Store 查询失败' }, { status: 502 })
  }

  const foundIds = new Set(results.map(result => String(result.trackId)))
  let stats
  try {
    stats = await importAppStoreResults(access.service, results, country, access.userId)
  } catch (error) {
    return appUpdateDatabaseError(null, error instanceof Error ? error.message : '保存 App Store 应用资料失败')
  }

  return NextResponse.json({
    requested: ids.length,
    found: results.length,
    ...stats,
    chart,
    missingIds: ids.filter(id => !foundIds.has(id)),
  })
}
