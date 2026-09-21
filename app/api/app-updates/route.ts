import { NextResponse } from 'next/server'
import { assertSafeRemoteUrl } from '@/lib/safe-remote-url'
import { appUpdateDatabaseError, requireAppUpdateSuper } from '@/lib/app-update-server'
import { cleanAppUpdateText, isAppUpdatePlatform, isAppUpdateSourceType } from '@/lib/app-updates'

const TABS = ['updates', 'apps', 'runs'] as const
export const maxDuration = 60
type AppUpdateTab = typeof TABS[number]
type JoinedRow = Record<string, unknown> & {
  app_update_apps: unknown
  app_update_sources: unknown
}

function oneRelation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return (value[0] ?? {}) as Record<string, unknown>
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export async function GET(request: Request) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response
  const { service } = access
  const params = new URL(request.url).searchParams
  const requestedTab = params.get('tab')
  const tab: AppUpdateTab = TABS.includes(requestedTab as AppUpdateTab) ? requestedTab as AppUpdateTab : 'updates'
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(10, Number.parseInt(params.get('pageSize') ?? '25', 10) || 25))
  const search = cleanAppUpdateText(params.get('search'), 80)
  const reviewStatus = params.get('reviewStatus')
  const sourceType = params.get('sourceType')
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const [appsCount, pendingCount, approvedCount, failingCount] = await Promise.all([
    service.from('app_update_apps').select('id', { count: 'exact', head: true }).neq('status', 'archived'),
    service.from('app_update_releases').select('id', { count: 'exact', head: true }).eq('review_status', 'pending'),
    service.from('app_update_releases').select('id', { count: 'exact', head: true }).eq('review_status', 'approved'),
    service.from('app_update_sources').select('id', { count: 'exact', head: true }).eq('last_status', 'error'),
  ])
  const countFailure = [appsCount, pendingCount, approvedCount, failingCount].find(result => result.error)
  if (countFailure?.error) return appUpdateDatabaseError(countFailure.error, '应用更新统计读取失败')
  const summary = {
    apps: appsCount.count ?? 0,
    pending: pendingCount.count ?? 0,
    approved: approvedCount.count ?? 0,
    failingSources: failingCount.count ?? 0,
  }

  if (tab === 'updates') {
    const { data, error } = await service.rpc('get_app_update_releases_page', {
      p_search: search,
      p_review_status: reviewStatus && ['pending', 'approved', 'rejected'].includes(reviewStatus) ? reviewStatus : '',
      p_source_type: sourceType && ['official', 'app_store', 'google_play', 'taptap', 'download_site', 'other'].includes(sourceType) ? sourceType : '',
      p_offset: from,
      p_limit: pageSize,
    })
    if (error) return appUpdateDatabaseError(error, '更新记录读取失败')
    const result = (data ?? {}) as { items?: unknown[]; total?: number }
    return NextResponse.json({ tab, items: result.items ?? [], total: result.total ?? 0, page, pageSize, summary })
  }

  if (tab === 'apps') {
    let query = service.from('app_update_apps')
      .select('id, name, platform, package_identifier, status, latest_approved_version, latest_approved_at, created_at, updated_at', { count: 'exact' })
      .neq('status', 'archived').order('updated_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
    if (search) query = query.ilike('name', `%${search}%`)
    const result = await query
    if (result.error) return appUpdateDatabaseError(result.error, '应用目录读取失败')
    const appIds = (result.data ?? []).map((row: { id: string }) => row.id)
    const sourcesResult = appIds.length > 0
      ? await service.from('app_update_sources')
        .select('id, app_id, source_name, source_type, source_url, enabled, last_status, last_checked_at, last_success_at, last_error, consecutive_failures')
        .in('app_id', appIds).order('created_at', { ascending: true })
      : { data: [], error: null }
    if (sourcesResult.error) return appUpdateDatabaseError(sourcesResult.error, '应用来源读取失败')
    return NextResponse.json({
      tab, items: result.data ?? [], sources: sourcesResult.data ?? [],
      total: result.count ?? 0, page, pageSize, summary,
    })
  }

  let query = service.from('app_update_crawl_runs').select(`
    id, app_id, source_id, status, discovered_version, error_message, action_run_id,
    started_at, completed_at, app_update_apps!inner(name), app_update_sources!inner(source_name)
  `, { count: 'exact' })
    .order('started_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
  if (search) query = query.ilike('app_update_apps.name', `%${search}%`)
  const result = await query
  if (result.error) return appUpdateDatabaseError(result.error, '抓取记录读取失败')
  const items = (result.data ?? []).map((row: JoinedRow) => {
    const app = oneRelation(row.app_update_apps)
    const source = oneRelation(row.app_update_sources)
    const { app_update_apps: _app, app_update_sources: _source, ...run } = row
    void _app; void _source
    return { ...run, app_name: app.name ?? '未知应用', source_name: source.source_name ?? '未知来源' }
  })
  return NextResponse.json({ tab, items, total: result.count ?? 0, page, pageSize, summary })
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
    p_name: name, p_platform: platform, p_package_identifier: packageIdentifier,
    p_source_name: sourceName, p_source_type: sourceType, p_source_url: sourceUrl.toString(), p_actor: access.userId,
  })
  if (error) return appUpdateDatabaseError(error, '应用和抓取来源新增失败')
  return NextResponse.json({ id: data }, { status: 201 })
}
