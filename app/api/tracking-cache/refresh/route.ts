import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { computeGroupTrackingPayload, saveGroupTrackingPayload } from '@/lib/group-tracking-cache'

export const maxDuration = 300

// Service-only compatibility endpoint. Interactive pages read stored snapshots;
// scheduled workers compute directly through scripts/refresh-derived-cache.ts.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '后台服务专用；页面请读取最新快照' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const requestedGroupId = new URL(req.url).searchParams.get('groupId')
  let groupsQuery = service.from('task_groups').select('id, name')
  if (requestedGroupId) groupsQuery = groupsQuery.eq('id', requestedGroupId)
  const { data: groups, error: groupsError } = await groupsQuery
  if (groupsError) return NextResponse.json({ error: 'Unable to load groups' }, { status: 500 })
  if (requestedGroupId && (groups ?? []).length === 0) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }

  const results: { groupId: string; name: string; ok: boolean; rows?: number; error?: string }[] = []
  for (const g of (groups ?? []) as { id: string; name: string }[]) {
    try {
      const payload = await computeGroupTrackingPayload(service, g.id)
      await saveGroupTrackingPayload(service, g.id, payload)
      results.push({ groupId: g.id, name: g.name, ok: true, rows: payload.length })
    } catch (e) {
      // 某个分组算失败时跳过它、保留它昨天的缓存，不要用错误/空结果覆盖掉
      // ——照抄 hot-radar/refresh 那次"报错被静默吞掉、缓存写成空"事故后
      // 加的保护逻辑（2026-08-13）。
      console.error('Tracking cache refresh failed', { groupId: g.id, error: e })
      results.push({ groupId: g.id, name: g.name, ok: false, error: 'Refresh failed' })
    }
  }

  const allOk = results.every(r => r.ok)
  return NextResponse.json({ success: allOk, results })
}
