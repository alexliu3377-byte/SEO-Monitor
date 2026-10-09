import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { CONTENT_FEED_CATEGORIES, parseContentFeedSources } from '@/lib/content-feed'

export const maxDuration = 30

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}
function databaseError(error: { code?: string } | null) {
  const migrationMissing = error?.code === '42P01' || error?.code === 'PGRST205'
  return NextResponse.json({
    error: migrationMissing ? '内容动态数据库尚未初始化' : '内容动态读取失败，请稍后重试',
  }, { status: migrationMissing ? 503 : 500 })
}

export async function GET(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The proxy performs the same active-account check for normal browser calls.
  // Keep it here as well so direct route tests and server-to-server calls cannot
  // use a stale session belonging to a disabled account.
  const service = createServiceClient() as any
  const { data: profile, error: profileError } = await service
    .from('user_profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError || !profile || profile.is_active === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const page = positiveInteger(params.get('page'), 1, 100_000)
  const pageSize = positiveInteger(params.get('pageSize'), 20, 50)
  const sourceFilter = parseContentFeedSources(params.get('sources'))
  if (sourceFilter.invalid.length > 0) {
    return NextResponse.json({ error: `不支持的来源：${sourceFilter.invalid.join(', ')}` }, { status: 400 })
  }
  const category = (params.get('category') ?? '').trim().toLowerCase()
  if (category && !(CONTENT_FEED_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: '分类参数无效' }, { status: 400 })
  }

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let query = service
    .from('content_feed_items')
    .select('id, source, source_id, category, title, url, cover_url, author, summary, published_at, first_seen_at', { count: 'exact' })
    .in('source', sourceFilter.sources)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('first_seen_at', { ascending: false })
    .range(from, to)
  if (category) query = query.eq('category', category)

  const { data, error, count } = await query
  if (error) return databaseError(error)
  const total = count ?? 0
  const items = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    category: row.category,
    title: row.title,
    url: row.url,
    coverUrl: row.cover_url,
    author: row.author,
    summary: row.summary,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
  }))

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }, {
    headers: { 'Cache-Control': 'private, max-age=30' },
  })
}
