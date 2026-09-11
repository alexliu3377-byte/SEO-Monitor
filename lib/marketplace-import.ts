import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExtractedAppUpdate } from './app-update-extractor'

export type MarketplaceApp = {
  name: string
  platform: 'android'
  packageIdentifier: string
  sourceName: string
  sourceType: 'google_play' | 'taptap'
  sourceUrl: string
  releases: ExtractedAppUpdate[]
}

export async function importMarketplaceApps(
  service: SupabaseClient,
  items: MarketplaceApp[],
  actor: string | null = null,
) {
  let appsCreated = 0
  let releasesCreated = 0
  let skipped = 0
  for (const item of items) {
    const name = item.name.trim()
    if (Array.from(name).length < 2 || Array.from(name).length > 120 || item.releases.length === 0) {
      skipped += 1
      continue
    }
    let { data: app, error: appError } = await service.from('app_update_apps')
      .select('id').eq('platform', item.platform).eq('package_identifier', item.packageIdentifier).maybeSingle()
    if (appError) throw new Error(`检查已有应用失败：${appError.message}`)
    if (!app) {
      const created = await service.from('app_update_apps').insert({
        name, platform: item.platform,
        package_identifier: item.packageIdentifier.slice(0, 255), created_by: actor,
      }).select('id').single()
      if (created.error || !created.data) throw new Error(`新增应用失败：${created.error?.message ?? '未知错误'}`)
      app = created.data
      appsCreated += 1
    }

    let { data: source, error: sourceError } = await service.from('app_update_sources')
      .select('id').eq('app_id', app.id).eq('source_type', item.sourceType).limit(1).maybeSingle()
    if (sourceError) throw new Error(`检查应用来源失败：${sourceError.message}`)
    if (!source) {
      const created = await service.from('app_update_sources').insert({
        app_id: app.id, source_name: item.sourceName, source_type: item.sourceType,
        source_url: item.sourceUrl, created_by: actor,
      }).select('id').single()
      if (created.error || !created.data) throw new Error(`新增应用来源失败：${created.error?.message ?? '未知错误'}`)
      source = created.data
    }

    const versions = item.releases.map(release => release.normalizedVersion)
    const existing = await service.from('app_update_releases').select('normalized_version')
      .eq('source_id', source.id).in('normalized_version', versions)
    if (existing.error) throw new Error(`检查已有版本失败：${existing.error.message}`)
    const existingVersions = new Set((existing.data ?? []).map(row => row.normalized_version as string))
    const now = new Date().toISOString()
    const rows = item.releases.slice(0, 5).map(release => ({
      app_id: app.id, source_id: source.id, version: release.version,
      normalized_version: release.normalizedVersion, changelog: release.changelog,
      release_date: release.releaseDate, package_size: null, download_url: null,
      source_url: item.sourceUrl, extraction_confidence: release.confidence,
      last_collected_at: now,
    }))
    const saved = await service.from('app_update_releases').upsert(rows, { onConflict: 'source_id,normalized_version' })
    if (saved.error) throw new Error(`保存应用版本失败：${saved.error.message}`)
    releasesCreated += rows.filter(row => !existingVersions.has(row.normalized_version)).length
    const updated = await service.from('app_update_sources').update({
      last_status: 'success', last_checked_at: now, last_success_at: now,
      last_error: null, consecutive_failures: 0,
    }).eq('id', source.id)
    if (updated.error) throw new Error(`更新来源状态失败：${updated.error.message}`)
  }
  return { found: items.length, appsCreated, releasesCreated, skipped }
}
