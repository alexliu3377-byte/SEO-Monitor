import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export async function GET(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin', 'normal'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const periodType = searchParams.get('type') || 'week'
  // 2026-08-26 起研究中心对普通组员开放周报/月报——季报/年报继续只给 super/admin，
  // 光在前端藏tab不够，这里也要挡，不然改一下URL的type参数就能绕过去
  if (profile?.role === 'normal' && !['week', 'month'].includes(periodType)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: reports, error } = await service
    .from('research_reports')
    .select('id, period_type, period_start, period_end, status, sites_considered, sites_analyzed, sites_skipped, gemini_call_count, gemini_fail_count, error, created_at, completed_at')
    .eq('period_type', periodType)
    .order('period_start', { ascending: false })
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({ reports: reports ?? [] })
}
