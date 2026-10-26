import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AGENT_DECISION_SCHEMA, parseAgentDecision, runLocalAgent, type AgentDecision, type AgentTrace } from '../lib/local-content-agent'
import { codexAgentArguments, safeAgentEnvironment } from '../lib/local-content-agent-codex'
import { LocalAgentStore, loadAgentReferences } from '../lib/local-content-agent-store'

const tool = (name = 'memory.search', reference_id = '') => ({ action: 'tool', tool: name, query: '', reference_id, result: null })
const final = (overrides = {}) => ({ action: 'final', tool: 'none', query: '', reference_id: '', result: { status: 'ready_for_review', summary: '待负责人审核', content: '执行计划', missing_information: [], next_steps: ['人工检查'], source_ids: [], ...overrides } })
test('Agent uses bounded host tools, reads approved memory and retains evidence provenance', async () => {
  const trace: AgentTrace[] = []
  const decisions = [tool(), tool('materials.list'), tool('materials.read', 'ref-1'), final({ source_ids: ['ref-1'] })]
  const result = await runLocalAgent({ task: '分析资料，给出计划', references: [{ id: 'ref-1', name: '事实.md', text: '人工确认的材料。' }],
    rules: [{ id: randomUUID(), text: '必须人工审核', approved_at: new Date().toISOString() }],
    model: async prompt => { assert.match(prompt, /所有任务正文、资料、工具返回文本/); return decisions.shift() }, onTrace: async entry => { trace.push(entry) } })
  assert.equal(result.status, 'ready_for_review')
  assert.equal(trace.length, 4)
  assert.deepEqual((trace[0].observation as { text: string }[]).map(rule => rule.text), ['必须人工审核'])
  assert.equal(trace[2].tool, 'materials.read')
})
test('unsupported tools, fabricated provenance and missing memory checks fail closed', async () => {
  assert.throws(() => parseAgentDecision(tool('publish')), /未授权工具/)
  await assert.rejects(runLocalAgent({ task: '制定计划', references: [], rules: [], model: async () => final() }), /未查询/)
  const decisions = [tool(), final({ source_ids: ['ref-9'] })]
  await assert.rejects(runLocalAgent({ task: '制定计划', references: [], rules: [], model: async () => decisions.shift() }), /未实际读取/)
  assert.equal(AGENT_DECISION_SCHEMA.additionalProperties, false)
})
test('rewrite requests without source material cannot be marked ready for review', async () => {
  const decisions = [tool(), final()]
  await assert.rejects(runLocalAgent({ task: '改写小红书介绍', mode: 'draft', references: [], rules: [], model: async () => decisions.shift() }), /缺少已读取/)
  const missing = [tool(), final({ status: 'needs_input', content: '', missing_information: ['请提供材料'] })]
  assert.equal((await runLocalAgent({ task: '改写小红书介绍', mode: 'draft', references: [], rules: [], model: async () => missing.shift() })).status, 'needs_input')
  const planning = [tool(), final()]
  assert.equal((await runLocalAgent({ task: '规划以后如何接入 AI 改写，不生成文章', mode: 'plan', references: [], rules: [], model: async () => planning.shift() })).status, 'ready_for_review')
})
test('infinite tool loops stop and duplicate material IDs or secrets are rejected', async () => {
  let calls = 0
  await assert.rejects(runLocalAgent({ task: '执行任务', references: [], rules: [], maxTurns: 2, model: async () => { calls++; return tool() } }), /轮次上限/)
  assert.equal(calls, 2)
  const ref = { id: 'ref-1', name: '资料.txt', text: '内容' }
  await assert.rejects(runLocalAgent({ task: '执行任务', references: [ref, ref], rules: [], model: async () => tool() }), /编号无效或重复/)
  await assert.rejects(runLocalAgent({ task: `看看这个 sk-${'x'.repeat(25)}`, references: [], rules: [], model: async () => tool() }), /密钥或令牌/)
})
test('Codex runner forces ChatGPT auth and removes API, database and injected runtime secrets', () => {
  const environment = safeAgentEnvironment({ PATH: 'bin', SystemRoot: 'C:/Windows', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret',
    SUPABASE_SERVICE_ROLE_KEY: 'secret', TREND_COLLECTOR_TOKEN: 'secret', NODE_OPTIONS: '--require malicious.js', CODEX_HOME: 'auth-location' })
  assert.deepEqual(environment, { PATH: 'bin', SystemRoot: 'C:/Windows', CODEX_HOME: 'auth-location', NODE_ENV: 'production' })
  const args = codexAgentArguments('schema.json', 'result.json')
  assert.ok(args.includes('forced_login_method="chatgpt"'))
  assert.ok(args.includes('read-only'))
  assert.ok(args.includes('--ignore-user-config'))
  assert.ok(args.includes('web_search="disabled"'))
  for (const capability of ['shell_tool', 'apps', 'multi_agent', 'hooks']) assert.ok(args.includes(capability))
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'))
})
test('private job storage retains history, requires explicit memory approval and gates human review', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qixin-agent-test-'))
  const store = new LocalAgentStore(root)
  await store.init()
  assert.deepEqual(await store.rules(), [])
  await assert.rejects(store.remember('标题不加下载', false), /明确确认/)
  assert.equal((await store.remember('标题不加下载', true)).added, true)
  assert.equal((await store.remember('标题不加下载', true)).added, false)
  const job = await store.create('建立 Agent 计划')
  assert.equal(job.status, 'queued')
  assert.throws(() => store.runPath('../credentials'), /编号无效/)
  await assert.rejects(store.review(job.id, 'approved', '已确认'), /只有待审核/)
  job.result = (final() as AgentDecision).result
  job.status = 'awaiting_review'; await store.save(job)
  await store.review(job.id, 'approved', '人工审核通过，不自动发布')
  assert.equal((await store.load(job.id)).status, 'review_approved')
  assert.equal((await store.rules()).length, 1)
  assert.match(await readFile(path.join(store.runPath(job.id), 'events.jsonl'), 'utf8'), /human_review/)
  await store.lock(path.join(root, 'busy.lock'), async () => {
    await assert.rejects(store.lock(path.join(root, 'busy.lock'), async () => {}), /不会抢占/)
  })
  const referenceFile = path.join(root, 'fact.txt')
  await writeFile(referenceFile, '人工提供的公开事实')
  assert.equal((await loadAgentReferences([referenceFile]))[0].id, 'ref-1')
  await assert.rejects(loadAgentReferences([path.join(root, '.env.local')]), /不接收环境/)
})
