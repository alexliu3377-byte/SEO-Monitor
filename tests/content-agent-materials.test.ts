import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { buildAgentMaterialBundle, loadAgentMaterialBundle, parseAgentMaterialBundle, parseAgentMaterialIds, type AgentFeedMaterial, type AgentTranscriptMaterial } from '../lib/content-agent-materials'
import { createAgentMaterialExportHandler } from '../lib/content-agent-materials-http'
import { agentSourceUrl } from '../lib/content-agent-source'
import { loadAgentMaterialFile, loadAgentReferences } from '../lib/local-content-agent-store'
import { runLocalAgent, type AgentDecision } from '../lib/local-content-agent'

const date = '2026-10-26T01:00:00.000Z'
const item = (overrides: Partial<AgentFeedMaterial> = {}): AgentFeedMaterial => ({
  id: randomUUID(), source: 'bilibili', title: '国潮小游戏介绍', url: 'https://www.bilibili.com/video/BV123/?spm_id_from=tracking',
  summary: '只有列表摘要，不能据此编造完整介绍。', published_at: '2026-10-25T01:00:00.000Z', first_seen_at: date, ...overrides,
})
const saved = (id: string, overrides: Partial<AgentTranscriptMaterial> = {}): AgentTranscriptMaterial => ({
  item_id: id, status: 'completed', transcript_text: '今天给大家推荐一款夜市摆摊小游戏。', article_text: '',
  text_source: 'platform_auto', updated_at: date, ...overrides,
})

function database(items: AgentFeedMaterial[], transcripts: AgentTranscriptMaterial[], failedTable = '') {
  const queries: { table: string; columns: string; ids: string[]; limit: number }[] = []
  const service = { from(table: string) {
    assert.ok(['content_feed_items', 'content_feed_transcripts'].includes(table))
    return { select(columns: string) {
      const query = { table, columns, ids: [] as string[], limit: 0 }
      queries.push(query)
      return { in(column: string, ids: string[]) {
        assert.equal(column, table === 'content_feed_items' ? 'id' : 'item_id')
        query.ids = ids
        return { async limit(limit: number) {
          query.limit = limit
          const rows = table === 'content_feed_items' ? items.filter(row => ids.includes(row.id)) : transcripts.filter(row => ids.includes(row.item_id))
          return { data: rows, error: table === failedTable ? { message: 'private database diagnostics' } : null }
        } }
      } }
    } }
  } }
  return { service, queries }
}

test('snapshot uses selected saved text, retains distinct dates and removes private/tracking URL parameters', () => {
  const row = item()
  const bundle = buildAgentMaterialBundle([row.id], [row], [saved(row.id)], date)
  const ref = bundle.references[0]
  assert.equal(ref.evidence?.kind, 'platform_auto')
  assert.equal(ref.evidence?.published_at, row.published_at)
  assert.equal(ref.evidence?.observed_at, date)
  assert.equal(ref.evidence?.text_updated_at, date)
  assert.equal(ref.evidence?.url, 'https://www.bilibili.com/video/BV123/')
  assert.equal(ref.evidence?.truncated, false)
  assert.equal(ref.text, saved(row.id).transcript_text)
  assert.equal(agentSourceUrl('xiaohongshu', 'https://www.xiaohongshu.com/explore/abc?xsec_token=private&share=tracking'), 'https://www.xiaohongshu.com/explore/abc')
  assert.throws(() => agentSourceUrl('bilibili', 'https://www.bilibili.com.evil.test/video/1'), /来源链接/)
  assert.throws(() => agentSourceUrl('bilibili', 'https://user:password@www.bilibili.com/video/1'), /来源链接/)
})

test('missing or unfinished transcripts remain summaries; blocked videos can retain readable article text', () => {
  const rows = [item(), item(), item()]
  const bundle = buildAgentMaterialBundle(rows.map(row => row.id), rows, [
    saved(rows[1].id, { status: 'failed', transcript_text: '不能冒充成功字幕' }),
    saved(rows[2].id, { status: 'blocked', article_text: '已保存的文章正文。' }),
  ], date)
  assert.deepEqual(bundle.references.map(ref => ref.evidence?.kind), ['summary', 'summary', 'article_body'])
  assert.equal(bundle.references[2].text, '已保存的文章正文。')
})

test('excerpts are explicit, secret scanning covers the full text, and invalid bundles fail closed', () => {
  const row = item()
  const bundle = buildAgentMaterialBundle([row.id], [row], [saved(row.id, { transcript_text: '文'.repeat(13000) })], date)
  assert.equal(bundle.references[0].text.length, 12000)
  assert.equal(bundle.references[0].evidence?.original_length, 13000)
  assert.equal(bundle.references[0].evidence?.truncated, true)
  assert.throws(() => buildAgentMaterialBundle([row.id], [row], [saved(row.id, { transcript_text: '文'.repeat(12500) + ' sk-' + 'x'.repeat(30) })]), /密钥或令牌/)
  const wrong = structuredClone(bundle)
  wrong.references[0].evidence!.truncated = false
  assert.throws(() => parseAgentMaterialBundle(wrong), /来源记录无效/)
  for (const ids of [null, '', '../auth', 'x'.repeat(401), [row.id, row.id].join(','), Array.from({ length: 9 }, () => randomUUID()).join(',')]) {
    assert.throws(() => parseAgentMaterialIds(ids), /1 至 8/)
  }
  assert.throws(() => buildAgentMaterialBundle([row.id], [], []), /不完整/)
})

test('export checks authentication and owner permission before any data read; bounds and sanitizes database failures', async () => {
  const row = item()
  for (const [caller, status] of [
    [null, 401], [{ role: 'normal', isOwner: false }, 403], [{ role: 'admin', isOwner: true }, 403], [{ role: 'super', isOwner: false }, 403],
  ] as const) {
    const fixture = database([row], [])
    const response = await createAgentMaterialExportHandler(async () => ({ caller, service: fixture.service }))(new Request('https://qixin.test/api/content-agent/materials?ids=' + row.id))
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(fixture.queries.length, 0)
  }
  const fixture = database([row], [saved(row.id)])
  const handler = createAgentMaterialExportHandler(async () => ({ caller: { role: 'super', isOwner: true }, service: fixture.service }))
  assert.equal((await handler(new Request('https://qixin.test/api/content-agent/materials'))).status, 400)
  assert.equal(fixture.queries.length, 0)
  const response = await handler(new Request('https://qixin.test/api/content-agent/materials?ids=' + row.id))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-disposition')!, /attachment/)
  const bundle = parseAgentMaterialBundle(await response.json())
  assert.equal(bundle.references.length, 1)
  assert.ok(fixture.queries.every(query => query.ids.length === 1 && query.limit === 8))
  assert.ok(fixture.queries.every(query => !/original|cookie|token|user_id|segments/.test(query.columns)))
  const broken = database([row], [], 'content_feed_transcripts')
  await assert.rejects(loadAgentMaterialBundle(broken.service, [row.id]), /读取失败/)
  const failure = await createAgentMaterialExportHandler(async () => ({ caller: { role: 'super', isOwner: true }, service: broken.service }))(new Request('https://qixin.test/api/content-agent/materials?ids=' + row.id))
  assert.equal(failure.status, 503)
  assert.doesNotMatch(await failure.text(), /private database diagnostics/)
})

const tool = (tool: string, reference_id = '') => ({ action: 'tool', tool, query: '', reference_id, result: null })
const final = (status = 'ready_for_review') => ({
  action: 'final', tool: 'none', query: '', reference_id: '',
  result: { status, summary: '资料检查', content: status === 'ready_for_review' ? '待审核草稿' : '', missing_information: status === 'needs_input' ? ['需要正文或字幕'] : [], next_steps: ['人工核对字幕'], source_ids: ['ref-1'] },
})

test('a summary cannot support a ready draft, but may support planning or a request for more evidence', async () => {
  const row = item()
  const references = buildAgentMaterialBundle([row.id], [row], [], date).references
  const run = (mode: 'plan' | 'draft', status = 'ready_for_review') => {
    const decisions = [tool('memory.search'), tool('materials.read', 'ref-1'), final(status)]
    return runLocalAgent({ task: '分析这些资料', mode, references, rules: [], model: async prompt => {
      assert.match(prompt, /summary/)
      return decisions.shift()
    } })
  }
  await assert.rejects(run('draft'), /只有列表摘要/)
  assert.equal((await run('plan')).status, 'ready_for_review')
  assert.equal((await run('draft', 'needs_input')).status, 'needs_input')
  const full = buildAgentMaterialBundle([row.id], [row], [saved(row.id)], date).references
  const decisions = [tool('memory.search'), tool('materials.read', 'ref-1'), final()]
  const result = await runLocalAgent({ task: '分析这些资料', mode: 'draft', references: full, rules: [], model: async () => decisions.shift() as AgentDecision })
  assert.equal(result.status, 'ready_for_review')
})

test('material import preserves provenance, drops unrelated fields, and cannot silently flatten an exported bundle', async () => {
  const row = item()
  const bundle = buildAgentMaterialBundle([row.id], [row], [saved(row.id)], date)
  const root = await mkdtemp(path.join(tmpdir(), 'qixin-materials-test-'))
  const file = path.join(root, 'materials.json')
  await writeFile(file, JSON.stringify({ ...bundle, injected_instruction: 'publish', references: bundle.references.map(ref => ({ ...ref, extra_secret: 'not relayed', evidence: { ...ref.evidence, extra_secret: 'not relayed' } })) }))
  const refs = await loadAgentMaterialFile(file)
  assert.equal(refs[0].evidence?.item_id, row.id)
  assert.doesNotMatch(JSON.stringify(refs), /extra_secret|injected_instruction/)
  await assert.rejects(loadAgentReferences([file]), /使用 --materials/)
  const renamed = path.join(root, 'materials.txt')
  await writeFile(renamed, JSON.stringify(bundle))
  await assert.rejects(loadAgentReferences([renamed]), /使用 --materials/)
  await assert.rejects(loadAgentMaterialFile(path.join(root, '.env.local')), /凭证或配置/)
})
