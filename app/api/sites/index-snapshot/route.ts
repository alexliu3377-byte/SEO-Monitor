import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

function optionalNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

export async function POST(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) {
    return NextResponse.json({ error: '没有补录权限' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const siteId = typeof body?.siteId === 'string' ? body.siteId : ''
  const snapshotDate = typeof body?.snapshotDate === 'string' ? body.snapshotDate : ''
  const baiduCollection = optionalNonNegativeInteger(body?.baiduCollection)
  const baiduIndex = optionalNonNegativeInteger(body?.baiduIndex)

  if (!siteId || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || baiduCollection === null || baiduCollection === undefined || baiduIndex === undefined) {
    return NextResponse.json({ error: '请填写正确的日期和非负整数' }, { status: 400 })
  }

  const { data: site } = await service.from('sites').select('id').eq('id', siteId).maybeSingle()
  if (!site) return NextResponse.json({ error: '站点不存在' }, { status: 404 })

  const payload: Record<string, string | number | null> = {
    site_id: siteId,
    snapshot_date: snapshotDate,
    index_count: baiduCollection,
    baidu_index_count: baiduIndex,
  }
  const optionalFields = {
    baidu_home_position: optionalNonNegativeInteger(body?.baiduHomePosition),
    baidu_new_1d: optionalNonNegativeInteger(body?.baidu1d),
    baidu_new_7d: optionalNonNegativeInteger(body?.baidu7d),
    baidu_new_30d: optionalNonNegativeInteger(body?.baidu30d),
  }
  if (Object.values(optionalFields).some(value => value === undefined)) {
    return NextResponse.json({ error: '收录明细必须是非负整数' }, { status: 400 })
  }
  Object.assign(payload, optionalFields)

  const { data, error } = await service.from('index_snapshots')
    .upsert(payload, { onConflict: 'site_id,snapshot_date' })
    .select('site_id,snapshot_date,index_count,baidu_index_count,baidu_home_position,baidu_new_1d,baidu_new_7d,baidu_new_30d')
    .single()

  if (error) return NextResponse.json({ error: '保存失败' }, { status: 500 })
  return NextResponse.json({ snapshot: data })
}
