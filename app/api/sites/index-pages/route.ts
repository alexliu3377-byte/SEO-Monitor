import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

const ALLOWED_PAGE_SIZES = [10, 20, 50]

// GET /api/sites/index-pages?siteId=X&page=0&pageSize=10&search=keyword&timeFilter=all|near7|near30&statusFilter=all|new|reindexed|disappeared|updated|active
export async function GET(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if ((profile?.role ?? 'normal') === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('siteId')
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10))
  const rawPageSize = parseInt(searchParams.get('pageSize') || '10', 10)
  const PAGE_SIZE = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : 10
  const search = searchParams.get('search') || ''
  const urlSearch = searchParams.get('urlSearch') || ''
  const sortDir = searchParams.get('sortDir') || ''  // 'asc' | 'desc' | '' (default)
  const timeFilter = searchParams.get('timeFilter') || 'all'   // all | near7 | near30
  const statusFilter = searchParams.get('statusFilter') || 'all' // all | new | reindexed | disappeared | updated | active

  if (!siteId) return NextResponse.json({ error: '缺少 siteId' }, { status: 400 })

  function getMY(offsetDays = 0) {
    return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
  }

  // Convert legacy relative date strings still in DB to YYYY-MM-DD
  function normalizeBaiduDate(text: string | null): string | null {
    if (!text) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
    const nowMYT = Date.now() + 8 * 3600000
    const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
    const daysAgo = text.match(/^(\d+)天前$/)
    if (daysAgo) return toDate(nowMYT - parseInt(daysAgo[1]) * 86400000)
    if (/^\d+(?:小时|分钟)前$/.test(text)) return toDate(nowMYT)
    if (text === '昨天') return toDate(nowMYT - 86400000)
    const m1 = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/)
    if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`
    return text
  }

  const today = getMY()

  let query = service
    .from('site_indexed_pages')
    .select('id, url, title, snippet, baidu_date_str, first_seen_date, last_seen_date, disappeared_date, baidu_date_changed_at, reindexed_at, verify_needed, missed_count', { count: 'exact' })
    .eq('site_id', siteId)

  if (search) query = query.ilike('title', `%${search}%`)
  if (urlSearch) query = query.ilike('url', `%${urlSearch}%`)

  // Apply time filter (based on baidu_date_str — stored as YYYY-MM-DD by crawler)
  if (timeFilter === 'near7') query = query.gte('baidu_date_str', getMY(-7))
  else if (timeFilter === 'near30') query = query.gte('baidu_date_str', getMY(-30))

  // Apply status filter
  if (statusFilter === 'new') {
    query = query.eq('first_seen_date', today).is('disappeared_date', null)
  } else if (statusFilter === 'reindexed') {
    query = query.eq('reindexed_at', today)
  } else if (statusFilter === 'disappeared') {
    query = query.not('disappeared_date', 'is', null)
  } else if (statusFilter === 'updated') {
    query = query.eq('baidu_date_changed_at', today).neq('first_seen_date', today).is('disappeared_date', null)
  } else if (statusFilter === 'pending') {
    query = query.eq('verify_needed', true).is('disappeared_date', null)
  } else if (statusFilter === 'active') {
    query = query.is('disappeared_date', null).eq('verify_needed', false)
  }
  // 'all': no status filter

  // Order: if sortDir set, sort by baidu_date_str; otherwise default to recency
  // Default ordering: active → pending-verify → disappeared (sunk to bottom)
  const sinkSpecial = statusFilter === 'all' && timeFilter === 'all'
  if (sortDir === 'asc' || sortDir === 'desc') {
    const ascending = sortDir === 'asc'
    if (sinkSpecial) {
      query = query
        .order('disappeared_date', { ascending: true, nullsFirst: true })
        .order('verify_needed', { ascending: true })
    }
    query = query.order('baidu_date_str', { ascending, nullsFirst: false })
  } else {
    if (sinkSpecial) {
      query = query
        .order('disappeared_date', { ascending: true, nullsFirst: true })
        .order('verify_needed', { ascending: true })
        .order('first_seen_date', { ascending: false })
        .order('baidu_date_str', { ascending: false, nullsFirst: false })
    } else {
      query = query
        .order('first_seen_date', { ascending: false })
        .order('baidu_date_str', { ascending: false, nullsFirst: false })
    }
  }

  query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  const rows = (data || []).map((r: {
    id: string; url: string; title: string; snippet: string
    baidu_date_str: string | null; first_seen_date: string
    last_seen_date: string; disappeared_date: string | null
    baidu_date_changed_at: string | null; reindexed_at: string | null
    verify_needed: boolean; missed_count: number
  }) => ({
    ...r,
    baidu_date_str: normalizeBaiduDate(r.baidu_date_str),
    is_new: r.first_seen_date === today && !r.disappeared_date,
    is_reindexed: r.reindexed_at === today,
    is_disappeared: !!r.disappeared_date,
    is_updated: r.baidu_date_changed_at === today && r.first_seen_date !== today && !r.disappeared_date,
    is_pending_verify: r.verify_needed && !r.disappeared_date,
  }))

  return NextResponse.json({ rows, total: count ?? 0, page, pageSize: PAGE_SIZE })
}

// PATCH /api/sites/index-pages — toggle has_index_pages for a site
export async function PATCH(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'normal'
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { siteId, enabled } = await req.json().catch(() => ({}))
  if (!siteId || typeof enabled !== 'boolean') return NextResponse.json({ error: '缺少参数' }, { status: 400 })

  const { error } = await service.from('sites').update({ has_index_pages: enabled }).eq('id', siteId)
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
