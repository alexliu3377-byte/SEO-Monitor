import { NextResponse } from 'next/server'
import { authorizeTrendCollector } from '@/lib/trend-discovery-server'
import { createServiceClient } from '@/lib/supabase-server'
import { TRANSCRIPT_SOURCES } from '@/lib/content-transcript'

export async function POST(request: Request) {
  const authorization = authorizeTrendCollector(request)
  if (!authorization.ok) return NextResponse.json({ error: '转写任务认证失败或密钥未配置' }, { status: authorization.missingConfiguration ? 503 : 401 })
  if (Number(request.headers.get('content-length')) > 2000) return NextResponse.json({ error: '请求过大' }, { status: 413 })
  const raw = await request.text()
  if (Buffer.byteLength(raw) > 2000) return NextResponse.json({ error: '请求过大' }, { status: 413 })
  let body
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: '请求格式无效' }, { status: 400 }) }
  const sources = body?.sources
  if (!Array.isArray(sources) || !sources.length || sources.length > 2 || sources.some(source => !TRANSCRIPT_SOURCES.includes(source))) {
    return NextResponse.json({ error: '转写来源无效' }, { status: 400 })
  }
  const service = createServiceClient() as any
  const { data, error } = await service.rpc('claim_content_transcript', { p_sources: [...new Set(sources)] })
  if (error) return NextResponse.json({ error: '转写队列尚未准备好或领取失败' }, { status: 503 })
  return NextResponse.json({ job: data }, { headers: { 'Cache-Control': 'no-store' } })
}
