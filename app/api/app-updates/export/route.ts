import { requireAppUpdateSuper } from '@/lib/app-update-server'
import { csvCell } from '@/lib/app-updates'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id)))].slice(0, 200)
    : []
  if (ids.length === 0) return Response.json({ error: '请先选择需要导出的更新记录' }, { status: 400 })

  const { data: releases, error } = await access.service
    .from('app_update_releases')
    .select('id, app_id, source_id, version, release_date, changelog, package_size, download_url, source_url, review_status, discovered_at')
    .in('id', ids)
  if (error) return Response.json({ error: '导出资料读取失败' }, { status: 500 })

  const appIds = [...new Set((releases ?? []).map((release: { app_id: string }) => release.app_id))]
  const sourceIds = [...new Set((releases ?? []).map((release: { source_id: string }) => release.source_id))]
  const [{ data: apps }, { data: sources }] = await Promise.all([
    access.service.from('app_update_apps').select('id, name, platform, package_identifier').in('id', appIds),
    access.service.from('app_update_sources').select('id, source_name').in('id', sourceIds),
  ])
  const appMap = new Map((apps ?? []).map((app: { id: string }) => [app.id, app]))
  const sourceMap = new Map((sources ?? []).map((source: { id: string }) => [source.id, source]))
  const header = ['应用名称', '平台', '包名/标识', '版本号', '发布日期', '更新日志', '包大小', '下载链接', '来源名称', '来源页面', '审核状态', '发现时间']
  const rows = (releases ?? []).map((release: any) => {
    const app = appMap.get(release.app_id) as any
    const source = sourceMap.get(release.source_id) as any
    return [
      app?.name, app?.platform, app?.package_identifier, release.version, release.release_date,
      release.changelog, release.package_size, release.download_url, source?.source_name,
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
