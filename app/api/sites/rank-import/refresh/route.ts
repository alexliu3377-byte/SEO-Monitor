import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 600

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function malaysiaToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const siteId = typeof body?.siteId === 'string' ? body.siteId : ''
    const statDate = typeof body?.statDate === 'string' ? body.statDate : ''
    if (!UUID_RE.test(siteId) || !DATE_RE.test(statDate)) {
      return NextResponse.json({ error: '站点或日期无效' }, { status: 400 })
    }
    const { data: site, error: siteError } = await service.from('sites').select('domain').eq('id', siteId).single()
    if (siteError || !site) return NextResponse.json({ error: '站点不存在' }, { status: 404 })

    const secret = process.env.CRON_SECRET
    if (!secret) return NextResponse.json({ error: '服务未配置 CRON_SECRET' }, { status: 500 })
    const origin = new URL(request.url).origin
    let tracking: { refreshed: boolean; skippedReason?: string; result?: unknown } = { refreshed: false }

    // The current tracking pipeline creates one daily snapshot. Historical
    // workbook imports remain available to reports, but must not be rewritten
    // as if they were observed today.
    if (statDate === malaysiaToday()) {
      const trackingResponse = await fetch(
        `${origin}/api/cron?step=tracking&site=${encodeURIComponent(site.domain)}`,
        { headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store' },
      )
      const trackingResult = await trackingResponse.json().catch(() => null)
      if (!trackingResponse.ok) throw new Error(trackingResult?.error || '成效追踪刷新失败')
      tracking = { refreshed: true, result: trackingResult }
    } else {
      tracking = { refreshed: false, skippedReason: '历史日期不重写为今天的竞品成效快照' }
    }

    const cacheResponse = await fetch(`${origin}/api/tracking-cache/refresh`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
    const cacheResult = await cacheResponse.json().catch(() => null)
    if (!cacheResponse.ok || cacheResult?.success !== true) {
      throw new Error(cacheResult?.error || '成效报告缓存刷新失败')
    }

    return NextResponse.json({ success: true, tracking, cache: cacheResult })
  } catch (error) {
    console.error('Imported rank effectiveness refresh failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '刷新失败' }, { status: 500 })
  }
}
