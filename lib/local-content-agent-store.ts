import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { checkAgentText, type AgentMode, type AgentReference, type AgentResult, type AgentRule, type AgentTrace } from './local-content-agent'
import { AGENT_MATERIAL_FORMAT, parseAgentMaterialBundle } from './content-agent-materials'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type LocalAgentJob = {
  version: 1; id: string; task: string; mode: AgentMode; references: AgentReference[]; created_at: string; updated_at: string
  status: 'queued' | 'running' | 'awaiting_review' | 'needs_input' | 'blocked' | 'failed' | 'review_approved' | 'review_rejected'
  result: AgentResult | null; error: string | null
}
async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, file) }
  finally { await unlink(temporary).catch(() => {}) }
}
export class LocalAgentStore {
  constructor(readonly root: string) {}
  async init() {
    await mkdir(path.join(this.root, 'runs'), { recursive: true, mode: 0o700 })
    const file = path.join(this.root, 'rules.json')
    try { await writeFile(file, JSON.stringify({ version: 1, rules: [] }), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  runPath(id: string) {
    if (!UUID.test(id)) throw new Error('任务编号无效')
    return path.join(this.root, 'runs', id)
  }
  async lock<T>(file: string, operation: () => Promise<T>) {
    let handle
    try { handle = await open(file, 'wx', 0o600) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('此资料正在操作或存在未清理的锁，请先检查运行中的 Agent，不会抢占执行'); throw error }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })); return await operation() }
    finally { await handle.close(); await unlink(file) }
  }
  async rules(): Promise<AgentRule[]> {
    const raw = JSON.parse(await readFile(path.join(this.root, 'rules.json'), 'utf8'))
    if (raw.version !== 1 || !Array.isArray(raw.rules) || raw.rules.length > 100) throw new Error('规则记忆文件格式无效')
    for (const rule of raw.rules) {
      if (!UUID.test(rule.id) || typeof rule.approved_at !== 'string') throw new Error('记忆规则未经确认')
      checkAgentText(rule.text, 300, '规则')
    }
    return raw.rules
  }
  async remember(text: string, confirmed: boolean) {
    if (!confirmed) throw new Error('只有明确确认的偏好才能加入记忆，请加 --confirm')
    const clean = checkAgentText(text, 300, '规则')
    return this.lock(path.join(this.root, 'rules.lock'), async () => {
      const rules = await this.rules()
      if (rules.some(rule => rule.text === clean)) return { added: false }
      if (rules.length >= 100) throw new Error('规则记忆最多 100 条，请先整理')
      rules.push({ id: randomUUID(), text: clean, approved_at: new Date().toISOString() })
      await atomicJson(path.join(this.root, 'rules.json'), { version: 1, rules })
      return { added: true }
    })
  }
  async create(task: string, references: AgentReference[] = [], mode: AgentMode = 'plan') {
    if (!['plan', 'draft'].includes(mode)) throw new Error('任务模式只能是 plan 或 draft')
    const text = checkAgentText(task, 4000, '任务')
    const id = randomUUID(), time = new Date().toISOString()
    const job: LocalAgentJob = { version: 1, id, task: text, mode, references, created_at: time, updated_at: time, status: 'queued', result: null, error: null }
    await mkdir(this.runPath(id), { mode: 0o700 })
    await this.save(job)
    await this.trace(id, { action: 'created', at: time })
    return job
  }
  async load(id: string): Promise<LocalAgentJob> {
    const job = JSON.parse(await readFile(path.join(this.runPath(id), 'job.json'), 'utf8'))
    if (job.version !== 1 || job.id !== id || !Array.isArray(job.references)) throw new Error('任务记录格式无效')
    checkAgentText(job.task, 4000, '任务')
    job.mode ??= 'plan'
    if (!['plan', 'draft'].includes(job.mode)) throw new Error('任务模式无效')
    return job
  }
  async save(job: LocalAgentJob) {
    await atomicJson(path.join(this.runPath(job.id), 'job.json'), { ...job, updated_at: new Date().toISOString() })
  }
  async trace(id: string, entry: AgentTrace | Record<string, unknown>) {
    await appendFile(path.join(this.runPath(id), 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  async review(id: string, decision: string, note: string) {
    if (!['approved', 'rejected'].includes(decision)) throw new Error('审核决定只能是 approved 或 rejected')
    checkAgentText(note, 2000, '审核说明')
    return this.lock(path.join(this.runPath(id), 'run.lock'), async () => {
      const job = await this.load(id)
      if (job.status !== 'awaiting_review' || job.result?.status !== 'ready_for_review') throw new Error('只有待审核结果才能审核；资料不足不算完成')
      await this.trace(id, { action: 'human_review', decision, note })
      job.status = decision === 'approved' ? 'review_approved' : 'review_rejected'
      await this.save(job)
      return job
    })
  }
}
export async function loadAgentReferences(files: string[]): Promise<AgentReference[]> {
  if (files.length > 8) throw new Error('每次最多提供 8 份文字资料')
  const references: AgentReference[] = []
  for (const file of files) {
    const denied = /(^|[\\/])(\.env[^\\/]*|auth\.json|credentials[^\\/]*|\.git|\.codex)([\\/]|$)/i
    if (!['.md', '.txt', '.json'].includes(path.extname(file).toLowerCase())
      || denied.test(file)) throw new Error('只接收明确提供的 md/txt/json 资料，不接收环境、凭证或配置目录')
    const resolved = await realpath(file)
    if (denied.test(resolved)) throw new Error('资料链接指向了环境或凭证目录，未读取')
    const info = await stat(resolved)
    if (!info.isFile() || info.size > 48000) throw new Error('单份资料不是普通文件或超过大小限制，请先摘录必要部分')
    const raw = await readFile(resolved, 'utf8')
    let parsed: { format?: unknown } | null = null
    try { parsed = JSON.parse(raw) } catch { /* Ordinary user-provided materials need not be JSON. */ }
    if (parsed?.format === AGENT_MATERIAL_FORMAT) throw new Error('奇心资料包请使用 --materials，避免丢失来源及摘要标记')
    const text = checkAgentText(raw, 12000, '资料')
    references.push({ id: `ref-${references.length + 1}`, name: path.basename(file), text })
  }
  return references
}

export async function loadAgentMaterialFile(file: string): Promise<AgentReference[]> {
  const denied = /(^|[\\/])(\.env[^\\/]*|auth\.json|credentials[^\\/]*|\.git|\.codex)([\\/]|$)/i
  if (path.extname(file).toLowerCase() !== '.json' || denied.test(file)) throw new Error('资料包必须是明确提供的 JSON，不能是凭证或配置文件')
  const resolved = await realpath(file)
  if (denied.test(resolved)) throw new Error('资料包指向了环境或凭证目录，未读取')
  const info = await stat(resolved)
  if (!info.isFile() || info.size > 512000) throw new Error('资料包不是普通文件或超过 512KB')
  return parseAgentMaterialBundle(JSON.parse(await readFile(resolved, 'utf8'))).references
}
