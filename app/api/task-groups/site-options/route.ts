import { NextResponse } from 'next/server'
import { getContentCaller } from '@/lib/content-access-server'
import { loadTaskGroupSiteOptions } from '@/lib/task-group-site-options'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  try {
    const { caller, service } = await getContentCaller()
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    if (caller.role !== 'admin' && caller.role !== 'super') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers })
    }
    return NextResponse.json(await loadTaskGroupSiteOptions(service, caller), { headers })
  } catch {
    return NextResponse.json({ error: '站点列表加载失败，请重试' }, { status: 500, headers })
  }
}
