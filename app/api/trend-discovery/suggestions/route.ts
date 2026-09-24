import { NextResponse } from 'next/server'
import { cleanTrendText, isTrendQueryPlatform, type TrendQueryPlatform } from '@/lib/trend-discovery'
import { getTrendCaller } from '@/lib/trend-discovery-server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUSES = ['pending', 'added', 'ignored'] as const

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback
}

function isMissingMigration(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST202' || error?.code === 'PGRST205'
}

export async function GET(request: Request) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const search = cleanTrendText(params.get('q'), 50).replace(/[%_,]/g, '')
  const platform = params.get('platform') ?? ''
  const status = params.get('status') ?? 'pending'
  const page = positiveInteger(params.get('page'), 1, 100_000)
  const pageSize = positiveInteger(params.get('pageSize'), 20, 50)
  if (platform && !isTrendQueryPlatform(platform)) {
    return NextResponse.json({ error: '来源平台筛选无效' }, { status: 400 })
  }
  if (!(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: '处理状态筛选无效' }, { status: 400 })
  }

  const observationSelection = platform
    ? 'trend_search_observations!inner(platform, source_kind, seed_query, position, observed_on, first_seen_at, last_seen_at)'
    : 'trend_search_observations(platform, source_kind, seed_query, position, observed_on, first_seen_at, last_seen_at)'
  let query = service
    .from('trend_search_terms')
    .select(`id, display_term, review_status, added_platforms, first_seen_at, last_seen_at, ${observationSelection}`, { count: 'exact' })
    .eq('review_status', status)
  if (search) query = query.ilike('display_term', `%${search}%`)
  if (platform) query = query.eq('trend_search_observations.platform', platform)
  const from = (page - 1) * pageSize
  const { data, count, error } = await query
    .order('last_seen_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) {
    const missing = isMissingMigration(error)
    return NextResponse.json(
      { error: missing ? '新词发现数据库迁移尚未运行' : '新词线索读取失败' },
      { status: missing ? 503 : 500 },
    )
  }

  const suggestions = (data ?? []).flatMap((row: any) => {
    const observations = (row.trend_search_observations ?? []).filter((item: any) => !platform || item.platform === platform)
    if (platform && observations.length === 0) return []
    return [{
      id: row.id,
      displayTerm: row.display_term,
      reviewStatus: row.review_status,
      addedPlatforms: row.added_platforms ?? [],
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      platforms: [...new Set(observations.map((item: any) => item.platform))],
      sourceKinds: [...new Set(observations.map((item: any) => item.source_kind))],
      seedQueries: [...new Set(observations.map((item: any) => item.seed_query))].slice(0, 8),
      observationCount: observations.length,
    }]
  })

  const counts = await Promise.all(STATUSES.map(value => service
    .from('trend_search_terms')
    .select('id', { count: 'exact', head: true })
    .eq('review_status', value)))
  return NextResponse.json({
    suggestions,
    total: count ?? 0,
    page,
    pageSize,
    counts: { pending: counts[0].count ?? 0, added: counts[1].count ?? 0, ignored: counts[2].count ?? 0 },
    canManage: caller.isOwner,
  })
}

export async function PATCH(request: Request) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.isOwner) return NextResponse.json({ error: '只有项目负责人可以处理新词线索' }, { status: 403 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const singleId = cleanTrendText(body?.id, 40)
  const ids = [...new Set(Array.isArray(body?.ids)
    ? body.ids.filter((value): value is string => typeof value === 'string')
    : singleId ? [singleId] : [])]
  const action = body?.action
  if (ids.length < 1 || ids.length > 100 || ids.some(id => !UUID_PATTERN.test(id)) || !['add', 'ignore', 'restore'].includes(String(action))) {
    return NextResponse.json({ error: '新词处理请求无效' }, { status: 400 })
  }

  const { data: terms, error: termError } = await service
    .from('trend_search_terms')
    .select('id, display_term, review_status, added_platforms, trend_search_observations(platform)')
    .in('id', ids)
  if (termError || !terms || terms.length !== ids.length) return NextResponse.json({ error: '找不到部分新词线索' }, { status: 404 })

  if (action === 'ignore' || action === 'restore') {
    const { error } = await service.from('trend_search_terms').update({
      review_status: action === 'ignore' ? 'ignored' : 'pending',
      reviewed_by: caller.id,
      reviewed_at: new Date().toISOString(),
    }).in('id', ids)
    if (error) return NextResponse.json({ error: '新词状态保存失败' }, { status: 500 })
    return NextResponse.json({ ok: true, updated: ids.length })
  }

  const requested = Array.isArray(body?.platforms) ? body.platforms : []
  for (const term of terms) {
    const observed = (term.trend_search_observations ?? []).map((row: any) => row.platform)
    const platforms = [...new Set((requested.length > 0 ? requested : observed)
      .filter((value: unknown): value is TrendQueryPlatform => isTrendQueryPlatform(value)))]
    if (platforms.length === 0) return NextResponse.json({ error: `“${term.display_term}”没有可加入的采集平台` }, { status: 400 })

    for (const targetPlatform of platforms) {
      const { error } = await service.rpc('add_trend_collection_query', {
        p_platform: targetPlatform,
        p_query: term.display_term,
        p_actor: caller.id,
      })
      if (error) {
        const missing = isMissingMigration(error)
        return NextResponse.json(
          { error: missing ? '新词发现数据库迁移尚未运行' : `“${term.display_term}”加入${targetPlatform === 'xiaohongshu' ? '小红书' : '抖音'}失败` },
          { status: missing ? 503 : 500 },
        )
      }
    }

    const addedPlatforms = [...new Set([...(term.added_platforms ?? []), ...platforms])]
    const { error: updateError } = await service.from('trend_search_terms').update({
      review_status: 'added',
      added_platforms: addedPlatforms,
      reviewed_by: caller.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', term.id)
    if (updateError) return NextResponse.json({ error: `“${term.display_term}”状态保存失败` }, { status: 500 })
  }
  return NextResponse.json({ ok: true, updated: terms.length })
}
