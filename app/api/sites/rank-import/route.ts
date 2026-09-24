import { NextResponse } from 'next/server'
import { parseAizhanRankWorkbook } from '@/lib/aizhan-rank-import'
import { upsertKeywordVolumeWithChange } from '@/lib/keyword-volume'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_FILE_SIZE = 15 * 1024 * 1024

function chunk<T>(rows: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size))
  return result
}

async function requireManager() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role === 'normal') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { service }
}

export async function POST(request: Request) {
  const access = await requireManager()
  if ('error' in access) return access.error
  const service = access.service

  try {
    const form = await request.formData()
    const action = String(form.get('action') ?? 'preview')
    const siteId = String(form.get('siteId') ?? '')
    const platform = String(form.get('platform') ?? '')
    const statDate = String(form.get('statDate') ?? '')
    const syncKeywordVolume = form.get('syncKeywordVolume') === 'true'
    const file = form.get('file')

    if (!['preview', 'import'].includes(action)) return NextResponse.json({ error: '无效操作' }, { status: 400 })
    if (!UUID_RE.test(siteId)) return NextResponse.json({ error: '请选择站点' }, { status: 400 })
    if (!['mobile', 'pc'].includes(platform)) return NextResponse.json({ error: '请选择 M 端或 PC 端' }, { status: 400 })
    if (!DATE_RE.test(statDate) || Number.isNaN(Date.parse(`${statDate}T00:00:00Z`))) {
      return NextResponse.json({ error: '数据日期无效' }, { status: 400 })
    }
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: '请选择 Excel 文件' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Excel 不能超过 15 MB' }, { status: 400 })
    if (!file.name.toLowerCase().endsWith('.xlsx')) return NextResponse.json({ error: '只支持 .xlsx 文件' }, { status: 400 })
    if (syncKeywordVolume && platform !== 'mobile') {
      return NextResponse.json({ error: '搜索量词库只接收 M 端数据' }, { status: 400 })
    }

    const { data: site, error: siteError } = await service.from('sites').select('id, domain').eq('id', siteId).single()
    if (siteError || !site) return NextResponse.json({ error: '站点不存在' }, { status: 404 })

    const parsed = await parseAizhanRankWorkbook(await file.arrayBuffer(), site.domain)
    if (action === 'preview') {
      return NextResponse.json({
        site: { id: site.id, domain: site.domain },
        platform,
        statDate,
        syncKeywordVolume,
        summary: parsed.summary,
      })
    }

    const rankRows = parsed.rankRows.map(row => ({
      site_id: site.id,
      keyword: row.keyword,
      stat_date: statDate,
      type: row.type,
      platform,
      rank_position: row.rank_position,
      prev_rank: row.prev_rank,
      volume: row.volume,
      title: row.title,
      url: row.url,
    }))
    for (const rows of chunk(rankRows, 500)) {
      const { error } = await service.from('site_keyword_ranks').upsert(rows, {
        onConflict: 'site_id,keyword,stat_date,platform,type',
      })
      if (error) throw error
    }

    let keywordVolumeRows = 0
    if (syncKeywordVolume) {
      const volumes = parsed.keywordVolumeRows.map(row => ({
        keyword: row.keyword,
        volume: row.volume,
        latest_trend: row.latest_trend,
        stat_date: statDate,
      }))
      await upsertKeywordVolumeWithChange(service, volumes)
      keywordVolumeRows = volumes.length
    }

    return NextResponse.json({
      success: true,
      site: { id: site.id, domain: site.domain },
      platform,
      statDate,
      importedRankRows: rankRows.length,
      importedKeywordVolumeRows: keywordVolumeRows,
      summary: parsed.summary,
    })
  } catch (error) {
    console.error('Aizhan rank workbook import failed', error)
    const message = error instanceof Error ? error.message : '导入失败'
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 400 })
  }
}
