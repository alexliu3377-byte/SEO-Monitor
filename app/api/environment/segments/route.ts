import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

// 给 environment_segments_daily 提供只读查询——月度趋势/规则中心那批页面的
// admin/super 门槛同一个套路，这里也是内部信号，不对普通组员开放。
export async function GET(req: Request) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const days = Math.min(90, Math.max(1, parseInt(searchParams.get('days') || '30', 10) || 30))
  const since = new Date(Date.now() + 8 * 3600000 - days * 86400000).toISOString().slice(0, 10)

  const { data, error } = await service
    .from('environment_segments_daily')
    .select('date, dimension, segment, site_count, avg_index_change_pct, fleet_avg_index_change_pct, deviation_pct, total_rankup, total_rankdown, is_anomaly')
    .gte('date', since)
    .order('date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rows: data ?? [] })
}
