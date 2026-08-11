import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeHotRadarPayload } from '@/lib/hot-radar'

export const maxDuration = 60

// GitHub Actions（.github/workflows/hot-radar-cache.yml，每天08:00 MYT）调用，
// 算好热词雷达数据写进 hot_radar_cache，供 /api/hot-radar 直接读。鉴权方式
// 跟 /api/environment/daily-snapshot 一致：Bearer CRON_SECRET 或 admin/super session。
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
  const supabase = createServiceClient() as any
  const payload = await computeHotRadarPayload(supabase)
  const computedAt = new Date().toISOString()
  const { error } = await supabase.from('hot_radar_cache').upsert({ id: 'latest', payload, computed_at: computedAt })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    computed_at: computedAt,
    counts: {
      newWords: payload.newWords.length,
      rankWords: payload.rankWords.length,
      streakWords: payload.streakWords.length,
      volumeRisingWords: payload.volumeRisingWords.length,
    },
  })
}
