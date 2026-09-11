import type { SupabaseClient } from '@supabase/supabase-js'
import {
  appStoreResultToUpdate,
  canonicalAppStoreUrl,
  type AppStoreLookupResult,
} from './app-store'

type ImportStats = {
  imported: number
  existing: number
  releasesCreated: number
  releasesExisting: number
}

function chunks<T>(rows: T[], size = 100): T[][] {
  const result: T[][] = []
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size))
  return result
}

export async function importAppStoreResults(
  service: SupabaseClient,
  results: AppStoreLookupResult[],
  country: string,
  actor: string | null
): Promise<ImportStats> {
  const uniqueResults = Array.from(new Map(results.map(result => [result.bundleId, result])).values())
  if (uniqueResults.length === 0) return { imported: 0, existing: 0, releasesCreated: 0, releasesExisting: 0 }

  const bundleIds = uniqueResults.map(result => result.bundleId)
  const appIdByBundle = new Map<string, string>()
  for (const batch of chunks(bundleIds)) {
    const { data: existingApps, error } = await service
      .from('app_update_apps')
      .select('id, package_identifier')
      .eq('platform', 'ios')
      .in('package_identifier', batch)
    if (error) throw new Error(`检查已有应用失败：${error.message}`)
    for (const app of existingApps ?? []) appIdByBundle.set(app.package_identifier as string, app.id as string)
  }
  const missingResults = uniqueResults.filter(result => !appIdByBundle.has(result.bundleId))
  for (const batch of chunks(missingResults)) {
    const { data: createdApps, error } = await service.from('app_update_apps').insert(batch.map(result => ({
      name: result.trackName.trim().slice(0, 120),
      platform: 'ios',
      package_identifier: result.bundleId.trim().slice(0, 255),
      created_by: actor,
    }))).select('id, package_identifier')
    if (error) throw new Error(`批量新增应用失败：${error.message}`)
    for (const app of createdApps ?? []) appIdByBundle.set(app.package_identifier as string, app.id as string)
  }

  const sourceName = `App Store (${country.toUpperCase()})`
  const appIds = uniqueResults.map(result => appIdByBundle.get(result.bundleId)).filter((id): id is string => !!id)
  const sourceIdByApp = new Map<string, string>()
  for (const batch of chunks(appIds)) {
    const { data: existingSources, error } = await service
      .from('app_update_sources')
      .select('id, app_id')
      .in('app_id', batch)
      .eq('source_type', 'app_store')
    if (error) throw new Error(`检查已有 App Store 来源失败：${error.message}`)
    for (const source of existingSources ?? []) {
      if (!sourceIdByApp.has(source.app_id as string)) sourceIdByApp.set(source.app_id as string, source.id as string)
    }
  }
  const missingSources = uniqueResults.filter(result => {
    const appId = appIdByBundle.get(result.bundleId)
    return appId && !sourceIdByApp.has(appId)
  })
  for (const batch of chunks(missingSources)) {
    const { data: createdSources, error } = await service.from('app_update_sources').insert(batch.map(result => ({
      app_id: appIdByBundle.get(result.bundleId),
      source_name: sourceName,
      source_type: 'app_store',
      source_url: canonicalAppStoreUrl(result),
      created_by: actor,
    }))).select('id, app_id')
    if (error) throw new Error(`批量新增 App Store 来源失败：${error.message}`)
    for (const source of createdSources ?? []) sourceIdByApp.set(source.app_id as string, source.id as string)
  }

  const releaseRows = uniqueResults.flatMap(result => {
    const appId = appIdByBundle.get(result.bundleId)
    const sourceId = appId ? sourceIdByApp.get(appId) : undefined
    const extracted = appStoreResultToUpdate(result)
    if (!appId || !sourceId || !extracted) return []
    return [{
      app_id: appId,
      source_id: sourceId,
      version: extracted.version,
      normalized_version: extracted.normalizedVersion,
      changelog: extracted.changelog,
      release_date: extracted.releaseDate,
      package_size: extracted.packageSize,
      download_url: extracted.downloadUrl,
      source_url: canonicalAppStoreUrl(result),
      extraction_confidence: extracted.confidence,
      last_collected_at: new Date().toISOString(),
    }]
  })

  const sourceIds = releaseRows.map(row => row.source_id)
  const existingReleaseKeys = new Set<string>()
  for (const batch of chunks(sourceIds)) {
    const { data: existingReleases, error } = await service
      .from('app_update_releases')
      .select('source_id, normalized_version')
      .in('source_id', batch)
    if (error) throw new Error(`检查已有版本失败：${error.message}`)
    for (const row of existingReleases ?? []) existingReleaseKeys.add(`${row.source_id}:${row.normalized_version}`)
  }

  for (const batch of chunks(releaseRows)) {
    const { error } = await service.from('app_update_releases').upsert(batch, {
      onConflict: 'source_id,normalized_version',
      ignoreDuplicates: false,
    })
    if (error) throw new Error(`保存 App Store 版本资料失败：${error.message}`)
  }

  const now = new Date().toISOString()
  for (const batch of chunks(sourceIds)) {
    const { error } = await service.from('app_update_sources').update({
      last_status: 'success',
      last_checked_at: now,
      last_success_at: now,
      last_error: null,
      consecutive_failures: 0,
    }).in('id', batch)
    if (error) throw new Error(`更新来源状态失败：${error.message}`)
  }

  const releasesExisting = releaseRows.filter(row => existingReleaseKeys.has(`${row.source_id}:${row.normalized_version}`)).length
  return {
    imported: missingResults.length,
    existing: uniqueResults.length - missingResults.length,
    releasesCreated: releaseRows.length - releasesExisting,
    releasesExisting,
  }
}
