import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTranscriptResult, transcriptStatusLabel, transcriptSourceLabel, isTranscriptSource } from '../lib/content-transcript'
import { allowsServiceAuthPath } from '../lib/service-api-access'

const result = { itemId: '11111111-1111-4111-8111-111111111111', leaseToken: '22222222-2222-4222-8222-222222222222',
  status: 'completed', text: '测试语音', segments: [{ start: 0, end: 2, text: '测试语音' }], model: 'small', language: 'zh', durationSeconds: 3 }
test('valid transcription retains literal text and timestamps', () => {
  assert.equal(parseTranscriptResult(result)?.text, '测试语音')
  assert.equal(parseTranscriptResult(result)?.segments[0].end, 2)
})
test('empty, unbounded and invalid timestamps cannot be marked successful', () => {
  for (const invalid of [ { ...result, text: '' }, { ...result, text: '长'.repeat(120001) },
    { ...result, leaseToken: 'wrong' }, { ...result, segments: [{ start: 4, end: 1, text: '测试' }] },
    { ...result, segments: [{ start: 0, end: NaN, text: '测试' }] }, { ...result, durationSeconds: Infinity } ]) {
    assert.equal(parseTranscriptResult(invalid), null)
  }
})
test('image-only, blocked and no speech are different from successful empty text', () => {
  for (const status of ['not_video', 'blocked', 'no_speech', 'failed']) {
    assert.ok(parseTranscriptResult({ ...result, status, text: '', segments: [], message: '处理原因' }))
  }
  assert.equal(parseTranscriptResult({ ...result, status: 'failed' }), null)
  assert.notEqual(transcriptStatusLabel('not_video'), transcriptStatusLabel('failed'))
  assert.equal(isTranscriptSource('52pojie'), false)
})
test('only authenticated collector operations bypass browser login, not text viewing', () => {
  assert.equal(allowsServiceAuthPath('/api/content-feed/transcripts/claim'), true)
  assert.equal(allowsServiceAuthPath('/api/content-feed/transcripts/result'), true)
  assert.equal(allowsServiceAuthPath('/api/content-feed/11111111-1111-4111-8111-111111111111/transcript'), false)
})

test('subtitle provenance and pre-conversion text are retained without mislabelling automatic captions', () => {
  const value = parseTranscriptResult({ ...result, textSource: 'platform_auto', originalText: '測試語音' })
  assert.equal(value?.originalText, '測試語音')
  assert.equal(value?.textSource, 'platform_auto')
  assert.equal(transcriptSourceLabel(value?.textSource), '平台自动字幕')
  assert.equal(transcriptSourceLabel('platform_manual'), '平台字幕')
  assert.equal(parseTranscriptResult({ ...result, textSource: 'ocr' }), null)
  assert.equal(parseTranscriptResult({ ...result, text: '与段落不符' }), null)
})

test('article text is independent from video success and never invents time segments', () => {
  const article = { ...result, text:'',originalText:'',segments:[],textSource:'article_body',articleText:'文章正文',originalArticleText:'文章正文',videoExpected:false }
  assert.equal(parseTranscriptResult(article)?.articleText,'文章正文')
  assert.equal(transcriptSourceLabel('article_body'),'文章正文')
  assert.equal(isTranscriptSource('xiaoheihe_guide'),true)
  assert.equal(isTranscriptSource('xiaoheihe_ns'),true)
  assert.equal(parseTranscriptResult({...article,videoExpected:true}),null)
  assert.equal(parseTranscriptResult({...article,articleText:''}),null)
  assert.equal(parseTranscriptResult({...article,articleText:'大'.repeat(120001)}),null)
  const partial=parseTranscriptResult({...article,status:'blocked',videoExpected:true,message:'视频要求验证，正文已保留'})
  assert.equal(partial?.articleText,'文章正文')
  assert.equal(partial?.status,'blocked')
  assert.equal(parseTranscriptResult({...result,articleText:'文章',originalArticleText:'文章',videoExpected:true})?.text,'测试语音')
})

test('rejected payload reports a fixed field code without leaking content', () => {
  const cases = [
    [{ ...result, text: 'private-words' }, 'RESULT_TEXT_MISMATCH'],
    [{ ...result, segments: [{ start: -0.1, end: 1, text: 'private-words' }] }, 'RESULT_TIMESTAMP'],
    [{ ...result, durationSeconds: -1 }, 'RESULT_DURATION'],
    [{ ...result, segments: [{ start: 0, end: 1, text: '字'.repeat(4001) }] }, 'RESULT_SEGMENT_TEXT'],
    [{ ...result, model: 'x'.repeat(121) }, 'RESULT_METADATA'],
  ] as const
  for (const [payload, expected] of cases) {
    let diagnostic = ''
    assert.equal(parseTranscriptResult(payload, code => { diagnostic = code }), null)
    assert.equal(diagnostic, expected)
    assert.ok(!diagnostic.includes('private-words'))
  }
})

test('canonical BOM/space trimmed lines retain literal words, but nonmatching content stays invalid', () => {
  const segments = [{ start: 0, end: 1, text: '\ufeff 夜市摆摊 🎮 \ufeff' }, { start: 1, end: 2, text: '国潮烤冷面' }]
  const payload = { ...result, segments, text: segments.map(part => part.text.trim()).join('\n') }
  assert.equal(parseTranscriptResult(payload)?.text, '夜市摆摊 🎮\n国潮烤冷面')
  assert.equal(parseTranscriptResult({ ...payload, text: '擅自改词' }), null)
})
