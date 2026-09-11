import { NextResponse } from 'next/server'
import { appUpdateDatabaseError, requireAppUpdateSuper } from '@/lib/app-update-server'
import { canonicalAppStoreUrl, lookupAppStoreApps, parseAppStoreIds } from '@/lib/app-store'

export const maxDuration = 30

export async function POST(request: Request) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const ids = parseAppStoreIds(body?.entries)
  const country = typeof body?.country === 'string' && /^[a-z]{2}$/i.test(body.country)
    ? body.country.toLowerCase()
    : 'cn'
  if (ids.length === 0) {
    return NextResponse.json({ error: '请填写有效的 App Store 链接或数字应用 ID' }, { status: 400 })
  }

  let results
  try {
    results = await lookupAppStoreApps(ids, country)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'App Store 查询失败' }, { status: 502 })
  }

  const foundIds = new Set(results.map(result => String(result.trackId)))
  let imported = 0
  let existing = 0

  for (const result of results) {
    const { data: existingApps, error: existingError } = await access.service
      .from('app_update_apps')
      .select('id')
      .eq('platform', 'ios')
      .eq('package_identifier', result.bundleId)
      .limit(1)
    if (existingError) return appUpdateDatabaseError(existingError, '检查已有应用失败')

    let appId = existingApps?.[0]?.id as string | undefined
    if (!appId) {
      const { data: created, error: createError } = await access.service
        .from('app_update_apps')
        .insert({
          name: result.trackName.trim().slice(0, 120),
          platform: 'ios',
          package_identifier: result.bundleId.trim().slice(0, 255),
          created_by: access.userId,
        })
        .select('id')
        .single()
      if (createError || !created) return appUpdateDatabaseError(createError, '批量新增应用失败')
      appId = created.id
      imported += 1
    } else {
      existing += 1
    }

    const sourceUrl = canonicalAppStoreUrl(result)
    const { data: source, error: sourceLookupError } = await access.service
      .from('app_update_sources')
      .select('id')
      .eq('app_id', appId)
      .eq('source_url', sourceUrl)
      .maybeSingle()
    if (sourceLookupError) return appUpdateDatabaseError(sourceLookupError, '检查已有 App Store 来源失败')
    if (!source) {
      const { error: sourceError } = await access.service.from('app_update_sources').insert({
        app_id: appId,
        source_name: `App Store (${country.toUpperCase()})`,
        source_type: 'app_store',
        source_url: sourceUrl,
        created_by: access.userId,
      })
      if (sourceError?.code !== '23505') {
        if (sourceError) return appUpdateDatabaseError(sourceError, '新增 App Store 来源失败')
      }
    }
  }

  return NextResponse.json({
    requested: ids.length,
    found: results.length,
    imported,
    existing,
    missingIds: ids.filter(id => !foundIds.has(id)),
  })
}
