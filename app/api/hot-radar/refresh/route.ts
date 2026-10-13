import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { refreshHotRadarCaches } from '@/lib/hot-radar-refresh'

export const maxDuration = 90

// Scheduled calculations run on the runner. Retain an authenticated manual
// recovery endpoint, sharing the same safe cache publication logic.
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
    const { data: profile, error } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
    if (error) return NextResponse.json({ error: 'Unable to verify cache access' }, { status: 503 })
    if (['super', 'admin'].includes(profile?.role)) authed = true
  }
  if (!authed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    return NextResponse.json(await refreshHotRadarCaches(createServiceClient()))
  } catch (error) {
    console.error('Hot radar refresh failed', error instanceof Error ? error.message : 'Database unavailable')
    return NextResponse.json({ success: false,complete: false,error: '热词缓存刷新失败，已保留上次正常资料' }, { status: 503 })
  }
}
