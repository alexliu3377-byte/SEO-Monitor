import { NextResponse } from 'next/server'
import { assertSafeRemoteUrl } from '@/lib/safe-remote-url'
import { appUpdateDatabaseError, requireAppUpdateSuper } from '@/lib/app-update-server'
import {
  cleanAppUpdateText,
  isAppUpdatePlatform,
  isAppUpdateSourceType,
} from '@/lib/app-updates'

export async function GET() {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response
  const { service } = access

  const [appsResult, sourcesResult, releasesResult, runsResult] = await Promise.all([
    service.from('app_update_apps')
      .select('id, name, platform, package_identifier, status, latest_approved_version, latest_approved_at, created_at, updated_at')
      .neq('status', 'archived').order('updated_at', { ascending: false }),
    service.from('app_update_sources')
      .select('id, app_id, source_name, source_type, source_url, enabled, last_status, last_checked_at, last_success_at, last_error, consecutive_failures')
      .order('created_at', { ascending: true }),
    service.from('app_update_releases')
      .select('id, app_id, source_id, version, changelog, release_date, package_size, download_url, source_url, review_status, extraction_confidence, discovered_at, last_collected_at')
      .order('discovered_at', { ascending: false }).limit(500),
    service.from('app_update_crawl_runs')
      .select('id, app_id, source_id, status, discovered_version, error_message, action_run_id, started_at, completed_at')
      .order('started_at', { ascending: false }).limit(50),
  ])
  const failed = [appsResult, sourcesResult, releasesResult, runsResult].find(result => result.error)
  if (failed?.error) return appUpdateDatabaseError(failed.error, '应用更新中心资料读取失败')

  const apps = appsResult.data ?? []
  const sources = sourcesResult.data ?? []
  const releases = releasesResult.data ?? []
  return NextResponse.json({
    apps,
    sources,
    releases,
    runs: runsResult.data ?? [],
    summary: {
      apps: apps.length,
      pending: releases.filter((release: { review_status: string }) => release.review_status === 'pending').length,
      failingSources: sources.filter((source: { last_status: string }) => source.last_status === 'error').length,
      approved: releases.filter((release: { review_status: string }) => release.review_status === 'approved').length,
    },
  })
}

export async function POST(request: Request) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: '请求内容格式错误' }, { status: 400 })
  const name = cleanAppUpdateText(body.name, 120)
  const platform = body.platform
  const packageIdentifier = cleanAppUpdateText(body.packageIdentifier, 255)
  const sourceName = cleanAppUpdateText(body.sourceName, 120)
  const sourceType = body.sourceType
  const sourceUrlText = cleanAppUpdateText(body.sourceUrl, 1200)
  if (name.length < 2 || !isAppUpdatePlatform(platform) || !sourceName || !isAppUpdateSourceType(sourceType) || !sourceUrlText) {
    return NextResponse.json({ error: '请完整填写应用名称、平台、来源名称、来源类型和更新页面' }, { status: 400 })
  }

  let sourceUrl: URL
  try {
    sourceUrl = await assertSafeRemoteUrl(sourceUrlText)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '更新页面地址无效' }, { status: 400 })
  }

  const { data, error } = await access.service.rpc('create_app_update_target', {
    p_name: name,
    p_platform: platform,
    p_package_identifier: packageIdentifier,
    p_source_name: sourceName,
    p_source_type: sourceType,
    p_source_url: sourceUrl.toString(),
    p_actor: access.userId,
  })
  if (error) return appUpdateDatabaseError(error, '应用和抓取来源新增失败')
  return NextResponse.json({ id: data }, { status: 201 })
}
