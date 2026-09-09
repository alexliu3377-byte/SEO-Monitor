import { NextResponse } from 'next/server'
import {
  normalizeTrendQueries,
  TREND_QUERY_LIMITS,
  type TrendQueryPlatform,
} from '@/lib/trend-discovery'
import { getTrendCaller } from '@/lib/trend-discovery-server'

function migrationError(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST202' || error?.code === 'PGRST205'
}

async function readSettings(service: any) {
  const { data, error } = await service
    .from('trend_collection_queries')
    .select('platform, query, sort_order')
    .eq('enabled', true)
    .order('platform')
    .order('sort_order')
  if (error) return { settings: null, error }

  const platforms: Record<TrendQueryPlatform, string[]> = {
    xiaohongshu: [],
    douyin: [],
  }
  for (const row of data ?? []) {
    const rowPlatform = row.platform as unknown
    if ((rowPlatform === 'xiaohongshu' || rowPlatform === 'douyin') && typeof row.query === 'string') {
      platforms[rowPlatform].push(row.query)
    }
  }
  return { settings: platforms, error: null }
}

export async function GET() {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.isOwner) return NextResponse.json({ error: '只有项目负责人可以设置采集词' }, { status: 403 })

  const result = await readSettings(service)
  if (result.error) {
    const missing = migrationError(result.error)
    return NextResponse.json(
      { error: missing ? '采集词设置数据库迁移尚未运行' : '采集词设置读取失败' },
      { status: missing ? 503 : 500 }
    )
  }
  return NextResponse.json({ platforms: result.settings, limits: TREND_QUERY_LIMITS })
}

export async function PUT(request: Request) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.isOwner) return NextResponse.json({ error: '只有项目负责人可以设置采集词' }, { status: 403 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const platforms = body?.platforms && typeof body.platforms === 'object' && !Array.isArray(body.platforms)
    ? body.platforms as Record<string, unknown>
    : null
  const xiaohongshu = normalizeTrendQueries('xiaohongshu', platforms?.xiaohongshu)
  const douyin = normalizeTrendQueries('douyin', platforms?.douyin)
  if (!xiaohongshu || !douyin) {
    return NextResponse.json({ error: '每个采集词需为 2–40 个字符；小红书最多 8 个，抖音最多 4 个' }, { status: 400 })
  }

  const { error } = await service.rpc('replace_trend_collection_queries', {
    p_xiaohongshu: xiaohongshu,
    p_douyin: douyin,
    p_actor: caller.id,
  })
  if (error) {
    const missing = migrationError(error)
    return NextResponse.json(
      { error: missing ? '采集词设置数据库迁移尚未运行' : '采集词设置保存失败' },
      { status: missing ? 503 : 500 }
    )
  }
  return NextResponse.json({ platforms: { xiaohongshu, douyin }, limits: TREND_QUERY_LIMITS })
}
