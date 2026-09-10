import { NextResponse } from 'next/server'
import { assertSafeRemoteUrl } from '@/lib/safe-remote-url'
import { appUpdateDatabaseError, requireAppUpdateSuper } from '@/lib/app-update-server'
import { cleanAppUpdateText, isAppUpdateSourceType } from '@/lib/app-updates'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAppUpdateSuper()
  if (!access.ok) return access.response
  const { id } = await context.params
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: '应用编号无效' }, { status: 400 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const sourceName = cleanAppUpdateText(body?.sourceName, 120)
  const sourceType = body?.sourceType
  const sourceUrlText = cleanAppUpdateText(body?.sourceUrl, 1200)
  if (!sourceName || !isAppUpdateSourceType(sourceType) || !sourceUrlText) {
    return NextResponse.json({ error: '请完整填写来源名称、来源类型和更新页面' }, { status: 400 })
  }

  let sourceUrl: URL
  try {
    sourceUrl = await assertSafeRemoteUrl(sourceUrlText)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '更新页面地址无效' }, { status: 400 })
  }

  const { error } = await access.service.from('app_update_sources').insert({
    app_id: id,
    source_name: sourceName,
    source_type: sourceType,
    source_url: sourceUrl.toString(),
    created_by: access.userId,
  })
  if (error?.code === '23505') return NextResponse.json({ error: '这个来源已经存在' }, { status: 409 })
  if (error) return appUpdateDatabaseError(error, '抓取来源新增失败')
  return NextResponse.json({ ok: true }, { status: 201 })
}
