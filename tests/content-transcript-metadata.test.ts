import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { loadContentTranscriptMetadata } from '../lib/content-transcript-metadata'

function fixture(failedColumns = '') {
  const queries: { columns: string; ids: string[]; filter: string }[] = []
  const rows = [
    {item_id:'video',status:'completed',transcript_text:'已有视频文字',article_text:''},
    {item_id:'article',status:'blocked',transcript_text:'',article_text:'已有文章正文'},
    {item_id:'queued',status:'queued',transcript_text:'',article_text:''},
    {item_id:'empty',status:'completed',transcript_text:'',article_text:''},
    {item_id:'other-page',status:'completed',transcript_text:'另一页',article_text:''},
  ]
  const service = { from(table: string) {
    assert.equal(table,'content_feed_transcripts')
    return { select(columns: string) {
      const entry = {columns,ids:[] as string[],filter:''}
      queries.push(entry)
      const query = {
        in(column: string, ids: string[]) { assert.equal(column,'item_id');entry.ids=ids;return query },
        or(filter: string) { entry.filter=filter;return query },
        then(resolve: (value: unknown) => unknown) {
          const data = rows.filter(row=>entry.ids.includes(row.item_id)&&(!entry.filter||row.transcript_text!==''||row.article_text!==''))
            .map(row=>Object.fromEntries(columns.split(',').map(key=>[key,row[key as keyof typeof row]])))
          return Promise.resolve({data:columns===failedColumns?null:data,error:columns===failedColumns?{code:'unavailable'}:null}).then(resolve)
        },
      }
      return query
    }}
  }}
  return {service,queries}
}

test('text viewing follows saved text, not success status alone, and never reads bodies in the list', async () => {
  const {service,queries} = fixture()
  const metadata = await loadContentTranscriptMetadata(service,['video','article','queued','empty'])
  assert.equal(metadata.unavailable,false)
  assert.deepEqual([...metadata.textIds],['video','article'])
  assert.equal(metadata.states.get('article'),'blocked')
  assert.equal(metadata.textIds.has('empty'),false)
  assert.equal(metadata.textIds.has('other-page'),false)
  assert.deepEqual(queries.map(query=>query.columns),['item_id,status','item_id'])
  assert.equal(queries[1].filter,'transcript_text.neq."",article_text.neq.""')
  assert.ok(queries.every(query=>query.ids.length===4))
})

test('missing metadata disables viewing instead of assuming every completed item has text', async () => {
  for (const column of ['item_id,status','item_id']) {
    const {service} = fixture(column)
    const metadata = await loadContentTranscriptMetadata(service,['video','article'])
    assert.equal(metadata.unavailable,true)
    assert.equal(metadata.textIds.size,0)
    assert.equal(metadata.states.size,0)
  }
})

test('pages without supported text sources do not query transcript metadata', async () => {
  const {service,queries} = fixture()
  const metadata = await loadContentTranscriptMetadata(service,[])
  assert.equal(metadata.unavailable,false)
  assert.deepEqual(queries,[])
})

test('reader does not poll or show collector diagnostics when no text is available', () => {
  const reader = readFileSync('components/content-transcript-dialog.tsx','utf8')
  assert.doesNotMatch(reader,/setTimeout|transcriptStatusLabel|data\?\.message|刷新状态/)
  assert.match(reader,/暂无可查看文字/)
})
