export const TRANSCRIPT_SOURCES = ['bilibili', 'xiaohongshu', 'xiaoheihe_guide', 'xiaoheihe_ns'] as const
export const TRANSCRIPT_RESULT_STATES = ['completed', 'blocked', 'failed', 'not_video', 'no_speech'] as const
export const TRANSCRIPT_TEXT_SOURCES = ['platform_manual', 'platform_auto', 'local_asr', 'article_body'] as const
export type TranscriptStatus = 'queued' | 'processing' | typeof TRANSCRIPT_RESULT_STATES[number]
export type TranscriptSegment = { start: number; end: number; text: string }
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function transcriptSourceLabel(source: string | null | undefined) {
  return source === 'article_body' ? '文章正文' : source === 'platform_manual' ? '平台字幕'
    : source === 'platform_auto' ? '平台自动字幕' : '本地语音识别'
}

export function isTranscriptSource(source: string) {
  return (TRANSCRIPT_SOURCES as readonly string[]).includes(source)
}

export function transcriptStatusLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    queued: '等待文字处理', processing: '正在处理文字', completed: '文字已保存',
    blocked: '转写暂受限', failed: '转写失败', not_video: '不是视频', no_speech: '未识别到语音',
  }
  return labels[status ?? ''] ?? '转写尚未启用'
}

// Validate without silently truncating a transcript or manufacturing text.
export function parseTranscriptResult(value: unknown, onInvalid?: (code: string) => void) {
  // Only fixed field codes may leave this validator; never echo text, cookies or URLs.
  const invalid = (code: string) => { onInvalid?.(code); return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('RESULT_OBJECT')
  const row = value as Record<string, unknown>
  if (typeof row.itemId !== 'string' || !UUID_PATTERN.test(row.itemId)
    || typeof row.leaseToken !== 'string' || !UUID_PATTERN.test(row.leaseToken)
    || !(TRANSCRIPT_RESULT_STATES as readonly unknown[]).includes(row.status)) return invalid('RESULT_IDENTITY')
  const text = typeof row.text === 'string' ? row.text.trim() : ''
  const message = typeof row.message === 'string' ? row.message.trim() : ''
  const originalText = typeof row.originalText === 'string' ? row.originalText.trim() : text
  const textSource = row.textSource ?? 'local_asr'
  const articleText = typeof row.articleText === 'string' ? row.articleText.trim() : ''
  const originalArticleText = typeof row.originalArticleText === 'string' ? row.originalArticleText.trim() : articleText
  const videoExpected = row.videoExpected === true
  if (articleText.length > 120_000 || originalArticleText.length > 120_000 || Boolean(articleText) !== Boolean(originalArticleText)) return invalid('RESULT_ARTICLE')
  if (row.videoExpected !== undefined && typeof row.videoExpected !== 'boolean') return invalid('RESULT_VIDEO_EXPECTED')
  if (!(TRANSCRIPT_TEXT_SOURCES as readonly unknown[]).includes(textSource)) return invalid('RESULT_TEXT_SOURCE')
  if (originalText.length > 120_000) return invalid('RESULT_ORIGINAL_SIZE')
  const segments = row.segments ?? []
  if (text.length > 120_000 || message.length > 500) return invalid('RESULT_TEXT_SIZE')
  if (!Array.isArray(segments) || segments.length > 5000) return invalid('RESULT_SEGMENTS_SIZE')
  let previousStart = -1
  for (const part of segments) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return invalid('RESULT_SEGMENT_OBJECT')
    const segment = part as Record<string, unknown>
    if (typeof segment.start !== 'number' || !Number.isFinite(segment.start) || segment.start < previousStart
      || segment.start < 0 || typeof segment.end !== 'number' || !Number.isFinite(segment.end)
      || segment.end < segment.start || segment.end > 86_400) return invalid('RESULT_TIMESTAMP')
    if (typeof segment.text !== 'string' || !segment.text.trim() || segment.text.length > 4000) return invalid('RESULT_SEGMENT_TEXT')
    previousStart = segment.start
  }
  const articleOnly = textSource === 'article_body'
  if (row.status === 'completed') {
    if (articleOnly ? !articleText || videoExpected || text || segments.length || originalText
      : !text || !segments.length || !originalText) return invalid('RESULT_COMPLETED_EMPTY')
    if (!articleOnly && text !== segments.map(part => part.text.trim()).join('\n')) return invalid('RESULT_TEXT_MISMATCH')
  } else if (text.length > 0 || segments.length > 0 || !message || originalText) return invalid('RESULT_FAILURE_SHAPE')
  const language = typeof row.language === 'string' ? row.language.trim() : null
  const model = typeof row.model === 'string' ? row.model.trim() : null
  if ((language?.length ?? 0) > 32 || (model?.length ?? 0) > 120) return invalid('RESULT_METADATA')
  const duration = row.durationSeconds ?? null
  if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 86_400)) return invalid('RESULT_DURATION')
  return {
    itemId: row.itemId, leaseToken: row.leaseToken, status: row.status as typeof TRANSCRIPT_RESULT_STATES[number],
    text, segments: segments as TranscriptSegment[], message, language, model, durationSeconds: duration,
    originalText, textSource: textSource as typeof TRANSCRIPT_TEXT_SOURCES[number], articleText, originalArticleText, videoExpected,
  }
}
