import { NextResponse } from 'next/server'
import { authorizeTrendCollector } from '@/lib/trend-discovery-server'
import { createServiceClient } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const collectorAuth = authorizeTrendCollector(request)
  if (!collectorAuth.ok) {
    return NextResponse.json(
      { error: collectorAuth.missingConfiguration ? '趋势采集密钥尚未配置' : '趋势采集认证失败' },
      { status: collectorAuth.missingConfiguration ? 503 : 401 }
    )
  }

  const service = createServiceClient() as any
  const { data, error } = await service
    .from('trend_collection_queries')
    .select('platform, query, sort_order')
    .eq('enabled', true)
    .order('platform')
    .order('sort_order')
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205'
    return NextResponse.json(
      { error: missing ? '采集词设置数据库迁移尚未运行' : '采集词设置读取失败' },
      { status: missing ? 503 : 500 }
    )
  }

  const platforms: Record<'xiaohongshu' | 'douyin', string[]> = {
    xiaohongshu: [],
    douyin: [],
  }
  for (const row of data ?? []) {
    const rowPlatform = row.platform as unknown
    if ((rowPlatform === 'xiaohongshu' || rowPlatform === 'douyin') && typeof row.query === 'string') {
      platforms[rowPlatform].push(row.query)
    }
  }
  return NextResponse.json({ platforms })
}
