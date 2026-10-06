import { NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/get-user-profile'
import { createServiceClient } from '@/lib/supabase-server'

export async function GET() {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  let query = service.from('site_aizhan_history_summaries').select('*')
  if (profile.accessibleSiteIds) {
    if (profile.accessibleSiteIds.length === 0) return NextResponse.json({ summaries: [] })
    query = query.in('site_id', profile.accessibleSiteIds)
  }
  const { data, error } = await query
  if (error) return NextResponse.json({ error: '读取爱站历史摘要失败' }, { status: 500 })
  return NextResponse.json({ summaries: data ?? [] })
}
