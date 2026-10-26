import path from 'node:path'
import { parseArgs } from 'node:util'
import { appendFile, writeFile } from 'node:fs/promises'
import { LOCAL_AGENT_NAME, runLocalAgent, type AgentMode } from '../lib/local-content-agent'
import { checkLocalAgentCodex, createLocalCodexModel } from '../lib/local-content-agent-codex'
import { loadAgentMaterialFile, loadAgentReferences, LocalAgentStore } from '../lib/local-content-agent-store'

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    task: { type: 'string' }, id: { type: 'string' }, reference: { type: 'string', multiple: true },
    text: { type: 'string' }, confirm: { type: 'boolean' }, decision: { type: 'string' },
    mode: { type: 'string' }, materials: { type: 'string' },
  } })
  const command = positionals[0] || 'help'
  const store = new LocalAgentStore(path.resolve('.content-agent'))
  if (command === 'help') {
    console.log(`奇心本地 Agent（负责人试用，不是团队共享 AI 接口）
init                              建立本地资料目录，不调用模型
status                            检查 Codex ChatGPT 登录，不运行推理
new --task "任务" [--mode plan|draft] [--reference ... | --materials 资料包.json] 建立任务，不自动运行
run --id UUID                     运行一个明确指定的排队任务，最多 5 轮
show --id UUID                    查看结果和记录位置
remember --text "规则" --confirm   将你确认的偏好加入记忆，不训练模型
review --id UUID --decision approved|rejected --text "说明"
所有资料保存在 .content-agent；没有常驻任务、自动发布或收费 API 兜底。`)
    return
  }
  await store.init()
  if (command === 'init') {
    console.log(JSON.stringify({ agent: LOCAL_AGENT_NAME, created: true, root: store.root, modelCalled: false }))
  } else if (command === 'status') {
    await checkLocalAgentCodex()
    console.log(JSON.stringify({ agent: LOCAL_AGENT_NAME, authentication: 'chatgpt', modelCalled: false, tools: ['memory.search', 'materials.list', 'materials.read'], rules: (await store.rules()).length }))
  } else if (command === 'remember') {
    console.log(JSON.stringify(await store.remember(values.text ?? '', values.confirm === true)))
  } else if (command === 'new') {
    if (values.materials && values.reference?.length) throw new Error('--materials 与 --reference 暂不混用，请明确选择本次资料来源')
    const references = values.materials ? await loadAgentMaterialFile(values.materials) : await loadAgentReferences(values.reference ?? [])
    const job = await store.create(values.task ?? '', references, (values.mode ?? 'plan') as AgentMode)
    console.log(JSON.stringify({ id: job.id, status: job.status, modelCalled: false }))
  } else if (command === 'show') {
    const job = await store.load(values.id ?? '')
    console.log(JSON.stringify({ ...job, references: job.references.map(ref => ({ id: ref.id, name: ref.name, length: ref.text.length, evidence: ref.evidence })), records: store.runPath(job.id) }, null, 2))
  } else if (command === 'review') {
    const job = await store.review(values.id ?? '', values.decision ?? '', values.text ?? '')
    console.log(JSON.stringify({ id: job.id, status: job.status, published: false, memoryChanged: false }))
  } else if (command === 'run') {
    const id = values.id ?? ''
    await store.lock(path.join(store.runPath(id), 'run.lock'), async () => {
      const job = await store.load(id)
      if (job.status !== 'queued') throw new Error('只运行排队任务；已执行或中断的任务不自动重跑，请建立新任务')
      const { executable } = await checkLocalAgentCodex()
      job.status = 'running'; await store.save(job)
      await store.trace(id, { action: 'started', authentication: 'chatgpt', maxTurns: 5 })
      try {
        job.result = await runLocalAgent({ task: job.task, mode: job.mode, references: job.references, rules: await store.rules(), model: createLocalCodexModel(executable),
          onTrace: async trace => { await store.trace(id, trace); console.log(`[Agent] 第 ${trace.turn} 轮：${trace.action === 'tool' ? trace.tool : trace.result?.status}`) } })
        job.status = job.result.status === 'ready_for_review' ? 'awaiting_review' : job.result.status
        await writeFile(path.join(store.runPath(id), 'result.md'), `# ${LOCAL_AGENT_NAME}\n\n状态：${job.result.status}\n\n${job.result.summary}\n\n${job.result.content}\n\n## 缺少资料\n\n${job.result.missing_information.map(text => `- ${text}`).join('\n')}\n\n## 下一步\n\n${job.result.next_steps.map(text => `- ${text}`).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
        const sources = job.references.filter(ref => job.result!.source_ids.includes(ref.id)).map(ref => ref.id + ' ' + ref.name + '\n' + (ref.evidence ? JSON.stringify(ref.evidence) : '人工提供资料；未独立核实')).join('\n\n')
        await appendFile(path.join(store.runPath(id), 'result.md'), '\n## 来源与资料范围\n\n' + (sources || '无引用资料') + '\n', 'utf8')
      } catch (error) {
        job.status = 'failed'; job.error = error instanceof Error ? error.message : '执行失败'
        await store.trace(id, { action: 'failed', error: job.error })
        throw error
      } finally { await store.save(job) }
      console.log(JSON.stringify({ id, status: job.status, result: path.join(store.runPath(id), 'result.md'), published: false }))
    })
  } else throw new Error('未知命令，请运行 npm run agent -- help')
}
main().catch(error => { console.error(`Agent：${error instanceof Error ? error.message : '运行失败'}`); process.exitCode = 1 })
