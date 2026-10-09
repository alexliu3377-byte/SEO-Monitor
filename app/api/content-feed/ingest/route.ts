import { NextResponse } from 'next/server'
import { authorizeTrendCollector } from '@/lib/trend-discovery-server'
import {
  isBrowserContentFeedSource,
  parseBrowserContentFeedItem,
} from '@/lib/content-feed-browser'
import { contentFeedDatabaseRows } from '@/lib/content-feed'
import { createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 60

export async function POST(request: Request) {
  const authorization = authorizeTrendCollector(request)
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.missingConfiguration ? '内容采集密钥尚未配置' : '内容采集认证失败' }, {
      status: authorization.missingConfiguration ? 503 : 401,
    })
  }
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10)
  if (Number.isFinite(contentLength) && contentLength > 500_000) {
    return NextResponse.json({ error: '单次内容资料不能超过 500KB' }, { status: 413 })
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const source = body?.source
  const rawItems = Array.isArray(body?.items) ? body.items : []
  if (!isBrowserContentFeedSource(source) || rawItems.length > 100) {
    return NextResponse.json({ error: '内容来源或资料数量无效' }, { status: 400 })
  }
  const items = rawItems.map(item => parseBrowserContentFeedItem(source, item))
  if (items.some(item => !item)) {
    return NextResponse.json({ error: '资料包含无效内容或非官方来源链接' }, { status: 400 })
  }
  if (items.length === 0) return NextResponse.json({ accepted: 0 })

  const unique = [...new Map(items.map(item => [`${item!.source}:${item!.sourceId}`, item!])).values()]
  const service = createServiceClient() as any
  const { error } = await service
    .from('content_feed_items')
    .upsert(contentFeedDatabaseRows(unique, new Date().toISOString()), { onConflict: 'source,source_id' })
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205'
    return NextResponse.json({ error: missing ? '内容动态数据库尚未初始化' : '内容资料写入失败' }, { status: missing ? 503 : 500 })
  }
  return NextResponse.json({ accepted: unique.length })
}
