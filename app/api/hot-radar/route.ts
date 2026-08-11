import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeHotRadarPayload } from '@/lib/hot-radar'

export const revalidate = 300  // cache 5 min; hot-radar data only updates once a day (see refresh route)
export const maxDuration = 60

// 2026-08-11 起改成读 hot_radar_cache（由 .github/workflows/hot-radar-cache.yml
// 每天 08:00 MYT 调 /api/hot-radar/refresh 算好写入），不再每次现场跑
// get_hot_new_words/get_hot_rank_words/get_hot_streak_words 三个RPC——这三个
// RPC 要扫 rank_changes/site_rank_keywords 近30天全量数据（永久保留、每天
// 持续写入），单次2-8秒，用户反馈"热词雷达/分组任务每天打开都很慢"。
// 缓存没命中（比如刚上线还没跑过定时任务）时现场算一次并顺手写回缓存，
// 不会一直空着——但正常情况下每天只应该现场算这一次，其余请求都是缓存命中。
export async function GET() {
  const authCheck = createClient()
  const { data: { user } } = await authCheck.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any

  const { data: cached } = await supabase.from('hot_radar_cache').select('payload').eq('id', 'latest').maybeSingle()
  if (cached?.payload) return NextResponse.json(cached.payload)

  const payload = await computeHotRadarPayload(supabase)
  await supabase.from('hot_radar_cache').upsert({ id: 'latest', payload, computed_at: new Date().toISOString() })
  return NextResponse.json(payload)
}
