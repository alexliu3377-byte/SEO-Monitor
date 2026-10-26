export const DEVELOPMENT_STAGES = ['pending', 'planned', 'development', 'testing', 'ready', 'live', 'paused', 'cancelled'] as const
export type DevelopmentStage = typeof DEVELOPMENT_STAGES[number]
export const STAGE_LABELS: Record<DevelopmentStage, string> = {
  pending: '待评估', planned: '已计划', development: '开发中', testing: '待测试',
  ready: '待上线', live: '已上线', paused: '已暂停', cancelled: '已取消',
}
export const DEVELOPMENT_FLOW = DEVELOPMENT_STAGES.slice(0, 6)
export type DevelopmentCheck = { id: string; text: string; done: boolean }
export type DevelopmentTask = {
  id: string; title: string; description: string; owner_name: string; stage: DevelopmentStage
  checklist: DevelopmentCheck[]; blocker: string; next_step: string; test_notes: string; deployment_notes: string
  revision: number; created_at: string; updated_at: string; started_at: string | null
  tested_at: string | null; deployed_at: string | null; release_id: string | null
  release?: { id: string; version: string; title: string } | null
}
export type DevelopmentTaskInput = Pick<DevelopmentTask, 'title' | 'description' | 'owner_name' | 'stage' | 'checklist' | 'blocker' | 'next_step' | 'test_notes' | 'deployment_notes'>
export function checklistProgress(checklist: DevelopmentCheck[]) {
  const total = checklist.length
  const completed = checklist.filter(item => item.done).length
  return { total, completed, percent: total ? Math.round(completed / total * 100) : 0 }
}
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function parseDevelopmentTask(value: unknown): { data?: DevelopmentTaskInput; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '请求格式不正确' }
  const raw = value as Record<string, unknown>
  const fields = { title: 120, description: 4000, owner_name: 80, blocker: 2000, next_step: 2000, test_notes: 4000, deployment_notes: 4000 }
  const text: Record<string, string> = {}
  for (const [field, limit] of Object.entries(fields)) {
    if (typeof raw[field] !== 'string' || raw[field].length > limit) return { error: '文字内容缺失或超过长度限制' }
    text[field] = raw[field].trim()
  }
  if (!text.title || !text.description) return { error: '请填写事项名称和需求背景' }
  if (!DEVELOPMENT_STAGES.includes(raw.stage as DevelopmentStage)) return { error: '请选择有效开发阶段' }
  if (!Array.isArray(raw.checklist) || raw.checklist.length > 30) return { error: '检查项最多 30 项' }
  const ids = new Set<string>()
  const checklist: DevelopmentCheck[] = []
  for (const item of raw.checklist) {
    if (!item || typeof item !== 'object' || !UUID_PATTERN.test(item.id) || ids.has(item.id)
      || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 300 || typeof item.done !== 'boolean') {
      return { error: '检查项需要有不重复的编号、内容及完成状态' }
    }
    ids.add(item.id)
    checklist.push({ id: item.id, text: item.text.trim(), done: item.done })
  }
  if (['ready', 'live'].includes(raw.stage as string)) {
    if (!checklist.length || checklist.some(item => !item.done)) return { error: '待上线前需要完成全部检查项' }
    if (!text.test_notes) return { error: '请先填写测试结果与验收依据' }
  }
  if (raw.stage === 'live' && !text.deployment_notes) return { error: '请填写部署及线上验证结果，不能只凭推送标记已上线' }
  if (['paused', 'cancelled'].includes(raw.stage as string) && !text.blocker) return { error: '暂停或取消时请填写原因' }
  return { data: { ...text, stage: raw.stage, checklist } as DevelopmentTaskInput }
}
export function localDevelopmentDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
}
