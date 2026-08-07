import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeOutcomeScore } from '@/lib/outcome-score'
import { fetchAllRows } from '@/lib/supabase-paginate'

interface TrackingRow {
  keyword: string
  content_date: string | null
  discovery_date: string
  content_type: string | null
  operation_type: string | null
  search_volume: number
  rank_position: number | null
  rank_volume: number
  effectiveness: string
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: siteId } = await params
  const { searchParams } = new URL(req.url)
  const keyword = (searchParams.get('keyword') || '').toLowerCase()
  const contentType = searchParams.get('contentType') || ''
  const effectiveness = searchParams.get('effectiveness') || ''
  const dateStart = searchParams.get('dateStart') || ''
  const dateEnd = searchParams.get('dateEnd') || ''

  const rows = await fetchAllRows<TrackingRow>((from, to) => {
    let q = service.from('competitor_tracking_records')
      .select('keyword, content_date, discovery_date, content_type, operation_type, search_volume, rank_position, rank_volume, effectiveness')
      .eq('site_id', siteId)
      .order('discovery_date', { ascending: false }).order('id', { ascending: true })
      .range(from, to)
    if (contentType) q = q.eq('content_type', contentType)
    if (effectiveness) q = q.eq('effectiveness', effectiveness)
    if (dateStart) q = q.gte('discovery_date', dateStart)
    if (dateEnd) q = q.lte('discovery_date', dateEnd)
    return q
  })

  const filtered = keyword ? rows.filter(r => r.keyword.toLowerCase().includes(keyword)) : rows

  const result = filtered.map(r => ({
    operation_type: r.operation_type,
    keyword: r.keyword,
    search_volume: r.search_volume,
    content_type: r.content_type,
    rank_position: r.rank_position,
    rank_volume: r.rank_volume,
    effectiveness: r.effectiveness,
    score: r.rank_position != null ? computeOutcomeScore(r.rank_position, true, null, r.rank_volume) : null,
    content_date: r.content_date,
    discovery_date: r.discovery_date,
  }))

  return NextResponse.json({ rows: result })
}
