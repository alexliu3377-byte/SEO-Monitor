import { NextResponse } from 'next/server'
import { getTrendCaller } from '@/lib/trend-discovery-server'
import { UUID_PATTERN } from '@/lib/content-transcript'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: '资料编号无效' }, { status: 400 })
  const { data, error } = await service.from('content_feed_transcripts')
    .select('status,transcript_text,text_source,language,model,duration_seconds,error_message,updated_at,completed_at')
    .eq('item_id', id).maybeSingle()
  if (error) return NextResponse.json({ error: '文字资料读取失败，转写服务可能尚未启用，请稍后重试' }, { status: 503 })
  if (!data) return NextResponse.json({ status: 'not_enabled', text: '', segments: [], message: '该条资料尚未加入自动转写队列' })
  return NextResponse.json({
    status: data.status, text: data.transcript_text, textSource: data.text_source,
    language: data.language, model: data.model, durationSeconds: data.duration_seconds,
    message: data.error_message, updatedAt: data.updated_at, completedAt: data.completed_at,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
