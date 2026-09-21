import { NextResponse } from 'next/server'
import { appUpdateDatabaseError, requireAppUpdateSuper } from '@/lib/app-update-server'

type JoinedRow = Record<string, unknown> & {
  id: string
  release_date: string | null
  discovered_at: string
  app_update_apps: unknown
  app_update_sources: unknown
}
type FlatRelease = Record<string, unknown> & {
  id: string
  release_date: string | null
  discovered_at: string
}

function oneRelation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return (value[0] ?? {}) as Record<string, unknown>
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response

  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: '应用 ID 无效' }, { status: 400 })
  }

  // 每个应用目前最多保留 5 个版本；这里只读被打开的那个应用。
  const result = await access.service.from('app_update_releases').select(`
    id, app_id, source_id, version, changelog, release_date, package_size,
    download_url, source_url, review_status, extraction_confidence, discovered_at,
    app_update_apps!inner(name, platform), app_update_sources!inner(source_name, source_type)
  `, { count: 'exact' }).eq('app_id', id).order('discovered_at', { ascending: false }).limit(10)
  if (result.error) return appUpdateDatabaseError(result.error, '应用历史版本读取失败')

  const releases: FlatRelease[] = ((result.data ?? []) as JoinedRow[]).map(row => {
    const app = oneRelation(row.app_update_apps)
    const source = oneRelation(row.app_update_sources)
    const { app_update_apps: _app, app_update_sources: _source, ...release } = row
    void _app; void _source
    return {
      ...release,
      app_name: app.name ?? '未知应用', app_platform: app.platform ?? 'other',
      source_name: source.source_name ?? '未知来源', source_type: source.source_type ?? 'other',
    } as FlatRelease
  }).sort((a, b) => {
    const aDate = Date.parse(String(a.release_date ?? a.discovered_at)) || Date.parse(String(a.discovered_at)) || 0
    const bDate = Date.parse(String(b.release_date ?? b.discovered_at)) || Date.parse(String(b.discovered_at)) || 0
    return bDate - aDate || String(b.discovered_at).localeCompare(String(a.discovered_at)) || String(b.id).localeCompare(String(a.id))
  })

  return NextResponse.json({ releases, release_count: result.count ?? releases.length })
}
