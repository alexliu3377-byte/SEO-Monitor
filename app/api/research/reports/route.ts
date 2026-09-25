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
  if (!['week', 'month', 'quarter', 'year'].includes(periodType)) {
    return NextResponse.json({ error: '报告周期无效' }, { status: 400 })
  }

  const { data: reports, error } = await service
    .from('research_reports')
    .select('id, period_type, period_start, period_end, status, sites_considered, sites_analyzed, sites_skipped, gemini_call_count, gemini_fail_count, error, created_at, completed_at')
    .eq('period_type', periodType)
    .order('period_start', { ascending: false })
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({ reports: reports ?? [] })
}
