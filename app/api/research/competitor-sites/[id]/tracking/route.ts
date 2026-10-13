import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

const SORT_COLUMNS = new Set(['search_volume', 'rank_position', 'rank_volume', 'score', 'content_date', 'discovery_date'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(value: string) {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  try {
    const { data: profile, error: profileError } = await service.from('user_profiles').select('role, is_active').eq('id', user.id).single()
    if (profileError) throw profileError
    if (profile?.is_active === false || !['super', 'admin'].includes(profile?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: siteId } = await params
    const { searchParams } = new URL(req.url)
    const page = Math.min(100000, Math.max(0, Number.parseInt(searchParams.get('page') || '0', 10) || 0))
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '20', 10) || 20))
    const sort = searchParams.get('sort') || 'discovery_date'
    const dateStart = searchParams.get('dateStart') || ''
    const dateEnd = searchParams.get('dateEnd') || ''
    if ((dateStart && !isValidDate(dateStart))
      || (dateEnd && !isValidDate(dateEnd))
      || (dateStart && dateEnd && dateStart > dateEnd)) {
      return NextResponse.json({ error: '日期范围无效' }, { status: 400 })
    }

    // Deduplicate the latest valid record per keyword before applying the
    // content-type filter, preserving the original research semantics.
    const { data, error } = await service.rpc('get_competitor_tracking_page', {
      p_site_id: siteId,
      p_page: page,
      p_page_size: pageSize,
      p_keyword: (searchParams.get('keyword') || '').trim().slice(0, 200).toLowerCase(),
      p_content_type: searchParams.get('contentType') || '',
      p_date_start: dateStart || null,
      p_date_end: dateEnd || null,
      p_sort: SORT_COLUMNS.has(sort) ? sort : 'discovery_date',
      p_direction: searchParams.get('direction') === 'asc' ? 'asc' : 'desc',
    })
    if (error) throw error
    if (!data || !Array.isArray(data.rows) || typeof data.total !== 'number') {
      throw new Error('Invalid competitor tracking page response')
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Competitor tracking page failed:', error)
    return NextResponse.json({ error: '成效资料读取失败，请重试' }, { status: 500 })
  }
}
