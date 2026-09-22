import { NextResponse } from 'next/server'
import { cleanTrendText, isTrendQueryPlatform } from '@/lib/trend-discovery'
import { authorizeTrendCollector } from '@/lib/trend-discovery-server'
import { createServiceClient } from '@/lib/supabase-server'

const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/

export async function POST(request: Request) {
  const collectorAuth = authorizeTrendCollector(request)
  if (!collectorAuth.ok) {
    return NextResponse.json(
      { error: collectorAuth.missingConfiguration ? '趋势采集密钥尚未配置' : '趋势采集认证失败' },
      { status: collectorAuth.missingConfiguration ? 503 : 401 },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const nodeId = cleanTrendText(body?.nodeId, 64).toLowerCase()
  if (!NODE_ID_PATTERN.test(nodeId)) {
    return NextResponse.json({ error: '采集节点编号无效' }, { status: 400 })
  }

  const service = createServiceClient() as any
  const { data, error } = await service.rpc('claim_trend_collection_query', {
    p_node_id: nodeId,
  })
  if (error) {
    const missing = error.code === '42883' || error.code === 'PGRST202'
    return NextResponse.json(
      { error: missing ? '趋势任务队列数据库迁移尚未运行' : '趋势任务领取失败' },
      { status: missing ? 503 : 500 },
    )
  }

  const row = Array.isArray(data) ? data[0] : null
  if (!row) return NextResponse.json({ task: null })
  if (!isTrendQueryPlatform(row.platform) || typeof row.query !== 'string') {
    return NextResponse.json({ error: '趋势任务资料无效' }, { status: 500 })
  }
  return NextResponse.json({
    task: { id: row.id, platform: row.platform, query: row.query },
  })
}
