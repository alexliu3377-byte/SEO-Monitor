import { NextResponse } from 'next/server'
import { authorizeTrendCollector } from '@/lib/trend-discovery-server'
import { createServiceClient } from '@/lib/supabase-server'
import { parseTranscriptResult } from '@/lib/content-transcript'

export async function POST(request: Request) {
  const authorization = authorizeTrendCollector(request)
  if (!authorization.ok) return NextResponse.json({ error: '转写任务认证失败或密钥未配置' }, { status: authorization.missingConfiguration ? 503 : 401 })
  if (Number(request.headers.get('content-length')) > 1_500_000) return NextResponse.json({ error: '转写资料过大', code: 'RESULT_BODY_SIZE' }, { status: 413 })
  const raw = await request.text()
  if (Buffer.byteLength(raw) > 1_500_000) return NextResponse.json({ error: '转写资料过大', code: 'RESULT_BODY_SIZE' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: '转写资料格式无效', code: 'RESULT_JSON' }, { status: 400 }) }
  let code = 'RESULT_INVALID'
  const result = parseTranscriptResult(body, reason => { code = reason })
  if (!result) return NextResponse.json({ error: '转写结果或时间段无效', code }, { status: 400 })
  const service = createServiceClient() as any
  const { data, error } = await service.rpc('finish_content_transcript', {
    p_item_id: result.itemId, p_lease_token: result.leaseToken, p_status: result.status,
    p_text: result.text, p_segments: result.segments, p_message: result.message,
    p_language: result.language, p_model: result.model, p_duration: result.durationSeconds,
    p_original_text: result.originalText, p_text_source: result.textSource,
    p_article_text: result.articleText, p_original_article_text: result.originalArticleText, p_video_expected: result.videoExpected,
  })
  if (error) return NextResponse.json({ error: '转写结果保存失败' }, { status: 500 })
  if (data !== true) return NextResponse.json({ error: '任务已过期或已被其它任务处理，未覆盖现有文字' }, { status: 409 })
  return NextResponse.json({ saved: true })
}
