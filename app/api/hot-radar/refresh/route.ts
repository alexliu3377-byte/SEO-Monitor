import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeHotRadarPayload } from '@/lib/hot-radar'

export const maxDuration = 90

// GitHub Actions（.github/workflows/hot-radar-cache.yml，每天08:00 MYT）调用，
// 算好热词雷达数据写进 hot_radar_cache，供 /api/hot-radar 直接读。鉴权方式
// 跟 /api/environment/daily-snapshot 一致：Bearer CRON_SECRET 或 admin/super session。
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  let authed = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)

  if (!authed) {
    const authClient = await createClient()
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
  const { payload, failedSections } = await computeHotRadarPayload(supabase)

  // 2026-08-13：某几块查询这次报错时，不能直接把空数组写进缓存覆盖掉上次
  // 的正常数据——读一次旧缓存，报错的那几块继续用旧值，只有真正算成功的
  // 块才覆盖。宁可某块数据暂时不是今天算的，也不要让它突然变成空白。
  let finalPayload = payload
  if (failedSections.length > 0) {
    const { data: oldCache } = await supabase.from('hot_radar_cache').select('payload').eq('id', 'latest').maybeSingle()
    if (oldCache?.payload) {
      finalPayload = { ...payload }
      for (const key of failedSections) {
        if (oldCache.payload[key]) finalPayload[key] = oldCache.payload[key]
      }
    }
  }

  const computedAt = new Date().toISOString()
  const { error } = await supabase.from('hot_radar_cache').upsert({ id: 'latest', payload: finalPayload, computed_at: computedAt })
  if (error) return NextResponse.json({ success: false, error: 'Unable to refresh hot radar' }, { status: 500 })

  return NextResponse.json({
    success: true,
    computed_at: computedAt,
    failedSections,
    counts: {
      newWords: finalPayload.newWords.length,
      rankWords: finalPayload.rankWords.length,
      streakWords: finalPayload.streakWords.length,
      volumeRisingWords: finalPayload.volumeRisingWords.length,
    },
  })
}
