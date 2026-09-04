import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeGroupTrackingPayload, saveGroupTrackingPayload } from '@/lib/group-tracking-cache'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import type { UserRole } from '@/lib/user-context'

export const maxDuration = 300

// The final retry workflow calls this after tracking, environment snapshot and
// hot-radar refresh. It atomically writes paged rows, compact monthly summaries
// and the legacy compatibility cache. Admin/super sessions may also refresh one
// group with ?groupId=...; CRON_SECRET refreshes every group.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  let authed = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)
  let caller: { id: string; role: UserRole } | null = null

  if (!authed) {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = createServiceClient() as any
    const { data: profile } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
    if (['super', 'admin'].includes(profile?.role)) {
      caller = { id: user.id, role: profile.role as UserRole }
      authed = true
    }
  }
  if (!authed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const requestedGroupId = new URL(req.url).searchParams.get('groupId')
  if (requestedGroupId && caller && !await canAccessTaskGroup(service, caller.id, caller.role, requestedGroupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
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
