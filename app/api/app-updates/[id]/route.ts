import { NextResponse } from 'next/server'
import { requireAppUpdateAccess } from '@/lib/app-update-server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAppUpdateAccess({ managerOnly: true })
  if (!access.ok) return access.response

  const { id } = await params
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: '应用编号无效' }, { status: 400 })

  const { data: app, error: findError } = await access.service
    .from('app_update_apps').select('id, name').eq('id', id).maybeSingle()
  if (findError) return NextResponse.json({ error: '读取应用资料失败' }, { status: 500 })
  if (!app) return NextResponse.json({ error: '应用不存在或已经删除' }, { status: 404 })

  const archived = await access.service.from('app_update_apps').update({ status: 'archived' }).eq('id', id)
  if (archived.error) return NextResponse.json({ error: '删除应用失败' }, { status: 500 })
  const removedSources = await access.service.from('app_update_sources').delete().eq('app_id', id)
  if (removedSources.error) return NextResponse.json({ error: '应用已隐藏，但清理关联资料失败' }, { status: 500 })
  return NextResponse.json({ ok: true, name: app.name })
}
