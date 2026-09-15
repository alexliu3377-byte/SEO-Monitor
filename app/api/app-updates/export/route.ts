import { requireAppUpdateSuper } from '@/lib/app-update-server'
import { cleanAppUpdateText, csvCell } from '@/lib/app-updates'
import { fetchAllRows } from '@/lib/supabase-paginate'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REVIEW_STATUSES = ['pending', 'approved', 'rejected']
const SOURCE_TYPES = ['official', 'app_store', 'google_play', 'taptap', 'download_site', 'other']

type ExportRelease = {
  id: string
  app_id: string
  version: string
  release_date: string | null
  changelog: string
  package_size: string | null
  download_url: string | null
  source_url: string
  review_status: string
  discovered_at: string
  app_update_apps: unknown
  app_update_sources: unknown
}

function oneRelation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return (value[0] ?? {}) as Record<string, unknown>
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export async function POST(request: Request) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const allMatching = body?.allMatching === true
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id)))].slice(0, 200)
    : []
  const appIds = Array.isArray(body?.appIds)
    ? [...new Set(body.appIds.filter((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id)))].slice(0, 200)
    : []
  if (!allMatching && ids.length === 0 && appIds.length === 0) {
    return Response.json({ error: '请先选择需要导出的应用' }, { status: 400 })
  }

  const search = cleanAppUpdateText(body?.search, 80)
  const reviewStatus = typeof body?.reviewStatus === 'string' && REVIEW_STATUSES.includes(body.reviewStatus) ? body.reviewStatus : ''
  const sourceType = typeof body?.sourceType === 'string' && SOURCE_TYPES.includes(body.sourceType) ? body.sourceType : ''

  let releases: ExportRelease[]
  try {
    releases = await fetchAllRows<ExportRelease>((from, to) => {
      let query = access.service.from('app_update_releases').select(`
        id, app_id, version, release_date, changelog, package_size, download_url, source_url,
        review_status, discovered_at, app_update_apps!inner(name, platform, package_identifier),
        app_update_sources!inner(source_name, source_type)
      `).order('discovered_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
      if (!allMatching && appIds.length > 0) query = query.in('app_id', appIds)
      else if (!allMatching) query = query.in('id', ids)
      if (allMatching && reviewStatus) query = query.eq('review_status', reviewStatus)
      if (allMatching && sourceType) query = query.eq('app_update_sources.source_type', sourceType)
      if (allMatching && search) query = query.ilike('app_update_apps.name', `%${search}%`)
      return query
    }, { pageSize: 500 })
  } catch {
    return Response.json({ error: '导出资料读取失败' }, { status: 500 })
  }
  if (releases.length === 0) return Response.json({ error: '没有符合条件的更新记录' }, { status: 400 })
  if (releases.length > 10000) return Response.json({ error: '单次最多导出 10000 条，请先缩小筛选范围' }, { status: 400 })

  const header = ['应用名称', '平台', '包名/标识', '版本号', '发布日期', '更新日志', '包大小', '下载链接', '来源名称', '来源页面', '审核状态', '发现时间']
  const rows = releases.map(release => {
    const app = oneRelation(release.app_update_apps)
    const source = oneRelation(release.app_update_sources)
    return [
      app.name, app.platform, app.package_identifier, release.version, release.release_date,
      release.changelog, release.package_size, release.download_url, source.source_name,
      release.source_url, release.review_status, release.discovered_at,
    ].map(csvCell).join(',')
  })
  const csv = `\uFEFF${header.map(csvCell).join(',')}\r\n${rows.join('\r\n')}`
  const filename = `app-updates-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
