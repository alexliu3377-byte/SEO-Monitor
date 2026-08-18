import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeGroupTrackingPayload } from '@/lib/group-tracking-cache'

export const maxDuration = 180

// GitHub Actions（.github/workflows/group-tracking-cache.yml，每天08:05 MYT，
// 在 tracking 抓取步骤06:45和环境快照07:15都跑完之后）调用，逐个分组算好
// "成效追踪"/"追踪汇总"背后的增强行数据，写进 group_tracking_cache，供两个
// 路由直接读。鉴权方式照抄 /api/hot-radar/refresh：Bearer CRON_SECRET 或
// admin/super session。
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  let authed = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)

  if (!authed) {
    const authClient = createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = createServiceClient() as any
    const { data: profile } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
    if (['super', 'admin'].includes(profile?.role)) authed = true
  }
  if (!authed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: groups } = await service.from('task_groups').select('id, name')

  const results: { groupId: string; name: string; ok: boolean; rows?: number; error?: string }[] = []
  for (const g of (groups ?? []) as { id: string; name: string }[]) {
    try {
      const payload = await computeGroupTrackingPayload(service, g.id)
      const { error } = await service
        .from('group_tracking_cache')
        .upsert({ group_id: g.id, payload, computed_at: new Date().toISOString() })
      if (error) throw new Error(error.message)
      results.push({ groupId: g.id, name: g.name, ok: true, rows: payload.length })
    } catch (e) {
      // 某个分组算失败时跳过它、保留它昨天的缓存，不要用错误/空结果覆盖掉
      // ——照抄 hot-radar/refresh 那次"报错被静默吞掉、缓存写成空"事故后
      // 加的保护逻辑（2026-08-13）。
      results.push({ groupId: g.id, name: g.name, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const allOk = results.every(r => r.ok)
  return NextResponse.json({ success: allOk, results })
}
