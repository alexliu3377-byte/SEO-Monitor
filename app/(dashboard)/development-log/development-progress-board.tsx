'use client'

import { cloneElement, FormEvent, ReactElement, useEffect, useId, useRef, useState } from 'react'
import AppDialog from '@/components/app-dialog'
import { PageNumberInput } from '@/components/page-number-input'
import { DevelopmentStageProgress } from '@/components/development-stage-progress'
import {
  checklistProgress, DEVELOPMENT_STAGES, STAGE_LABELS,
  type DevelopmentStage, type DevelopmentTask, type DevelopmentTaskInput,
} from '@/lib/development-progress'

const EMPTY: DevelopmentTaskInput = {
  title: '', description: '', owner_name: '', stage: 'pending', checklist: [],
  blocker: '', next_step: '', test_notes: '', deployment_notes: '',
}
const INPUT = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50'
type ProgressEvent = { id: number; actor_name: string; note: string; created_at: string; snapshot: DevelopmentTask }

function timestamp(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '尚未记录'
}
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || '操作失败，请重试')
  return body
}
function TaskStage({ stage }: { stage: DevelopmentStage }) {
  return <span className={`inline-flex shrink-0 rounded px-2 py-1 text-xs font-medium ${stage === 'live' ? 'bg-emerald-50 text-emerald-800' : stage === 'paused' || stage === 'cancelled' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{STAGE_LABELS[stage]}</span>
}
function ProgressBar({ task }: { task: Pick<DevelopmentTask, 'checklist' | 'stage'> }) {
  const progress = checklistProgress(task.checklist)
  return <div className="min-w-0">
    <div className="mb-1 flex justify-between gap-3 text-xs text-slate-600"><span>检查项 {progress.completed}/{progress.total}</span><span>{progress.total ? `${progress.percent}%` : '待拆分'}</span></div>
    <progress aria-label="检查项完成进度（不代表已上线）" max={Math.max(1, progress.total)} value={progress.completed} className="block h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-slate-100 [&::-webkit-progress-value]:bg-emerald-600 [&::-moz-progress-bar]:bg-emerald-600" />
  </div>
}
function Pager({ page, total, onChange, disabled = false, label }: { page: number; total: number; onChange: (page: number) => void; disabled?: boolean; label: string }) {
  const pages = Math.max(1, Math.ceil(total / 10))
  if (pages <= 1) return null
  return <nav aria-label={label} className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs text-slate-600">
    <span>共 {total} 条 · 第 <PageNumberInput page={page} totalPages={pages} onChange={onChange} disabled={disabled} label={`${label}跳转页码`} /> / {pages} 页</span>
    <button className="btn-secondary" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>上一页</button>
    <button className="btn-secondary" disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>下一页</button>
  </nav>
}

export default function DevelopmentProgressBoard({ onChange }: { onChange?: () => void }) {
  const [tasks, setTasks] = useState<DevelopmentTask[]>([])
  const [counts, setCounts] = useState<Partial<Record<DevelopmentStage, number>>>({})
  const [scope, setScope] = useState('active')
  const [stage, setStage] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [selected, setSelected] = useState<string | null | undefined>(undefined)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    request(`/api/development-log/tasks?${new URLSearchParams({ scope, stage, page: String(page) })}`, { signal: controller.signal })
      .then(body => { setTasks(body.tasks); setCounts(body.counts); setTotal(body.total); setCanManage(body.canManage) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [scope, stage, page, refresh])
  function filter(value: string) { setScope('active'); setStage(value); setPage(1) }
  return <section aria-labelledby="development-progress-title" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 id="development-progress-title" className="text-lg font-semibold text-slate-900">开发进度</h2><p className="mt-1 text-xs leading-5 text-slate-500">圆点表示开发阶段；检查项与测试、上线分别记录。</p></div>
      <div className="flex gap-2"><button className="btn-secondary" onClick={() => setRefresh(n => n + 1)} disabled={loading}>刷新</button>{canManage && <button className="btn-primary" onClick={() => setSelected(null)}>新增事项</button>}</div>
    </div>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap gap-1" aria-label="事项范围">
          <button aria-pressed={scope === 'active' && !stage} className={scope === 'active' && !stage ? 'btn-primary' : 'btn-ghost'} onClick={() => filter('')}>未归档</button>
          <button aria-pressed={scope === 'active' && stage === 'paused'} className={scope === 'active' && stage === 'paused' ? 'btn-primary' : 'btn-ghost'} onClick={() => filter('paused')}>已暂停 {counts.paused ?? 0}</button>
          <button aria-pressed={scope === 'history'} className={scope === 'history' ? 'btn-primary' : 'btn-ghost'} onClick={() => { setScope('history'); setStage(''); setPage(1) }}>归档 / 已取消</button>
        </div><div className="flex items-center gap-3"><label className="sr-only" htmlFor="development-stage-filter">阶段筛选</label><select id="development-stage-filter" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500" value={stage} onChange={event => { setStage(event.target.value); setPage(1) }}><option value="">全部阶段</option>{DEVELOPMENT_STAGES.map(value => <option key={value} value={value}>{STAGE_LABELS[value]}</option>)}</select><span className="text-xs text-slate-500">{total} 项</span></div>
      </div>
      {error ? <div role="alert" className="p-5 text-sm text-red-700">{error}<button className="btn-secondary ml-3" onClick={() => setRefresh(n => n + 1)}>重试</button></div>
        : loading ? <div role="status" className="p-6 text-sm text-slate-500">正在读取开发进度…</div>
          : tasks.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">{scope === 'history' ? '暂无归档或取消事项，过去的版本日志仍保留在下方。' : '暂无此阶段的事项。新增想法后，就可以拆分检查项、记录进展。'}</div>
            : <ul className="divide-y divide-slate-100">{tasks.map(task => <li key={task.id} className="px-4 py-5 sm:px-5">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><TaskStage stage={task.stage} /><button className="min-w-0 text-left text-sm font-semibold text-slate-900 hover:text-emerald-700 focus-visible:underline [overflow-wrap:anywhere]" onClick={() => setSelected(task.id)}>{task.title}</button></div>
                <p className="mt-2 text-xs text-slate-500">{task.owner_name || '负责人待定'} · {timestamp(task.updated_at)} 更新{task.release && ` · ${task.release.version}`}</p>
                {(task.blocker || task.next_step) && <p title={task.blocker || task.next_step} className={`mt-1 truncate text-xs ${task.blocker ? 'text-amber-800' : 'text-slate-600'}`}>{task.blocker ? `难题：${task.blocker}` : `下一步：${task.next_step}`}</p>}
              </div><button className="btn-secondary shrink-0" onClick={() => setSelected(task.id)}>查看进度</button></div>
              <div className="mt-5"><DevelopmentStageProgress stage={task.stage} /></div>
              <p className="mt-3 text-right text-xs text-slate-600">检查项完成 {checklistProgress(task.checklist).completed}/{task.checklist.length} · {task.checklist.length ? '不代表已测试或已上线' : '等待拆分工作项'}</p>
            </li>)}</ul>}
    </div>
    <Pager page={page} total={total} onChange={setPage} disabled={loading} label="开发事项分页" />
    {selected !== undefined && <TaskDialog taskId={selected} onClose={() => setSelected(undefined)} onSaved={() => { setRefresh(n => n + 1); onChange?.() }} />}
  </section>
}

function Facts({ task }: { task: DevelopmentTask }) {
  return <div className="space-y-4 text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
    <div className="flex items-center gap-3"><TaskStage stage={task.stage} /><span>{task.owner_name || '负责人待定'}</span>{task.release && <span className="text-emerald-700">已归入 {task.release.version}</span>}</div>
    <DevelopmentStageProgress stage={task.stage} />
    <p className="text-xs text-slate-600">检查项完成 {checklistProgress(task.checklist).completed}/{task.checklist.length}，不代表已测试或已上线。</p>
    <p className="whitespace-pre-wrap">{task.description}</p>
    {task.checklist.length > 0 && <ul className="space-y-1">{task.checklist.map(item => <li key={item.id} className="flex gap-2"><span className={item.done ? 'text-emerald-700' : 'text-slate-500'}>{item.done ? '已完成' : '待完成'}</span><span className="min-w-0 flex-1">{item.text}</span></li>)}</ul>}
    {([['当前难题 / 暂停原因', task.blocker], ['下一步', task.next_step], ['测试与验收', task.test_notes], ['部署与线上验证', task.deployment_notes]] as const).map(([label, text]) => text && <div key={label}><h4 className="font-medium text-slate-900">{label}</h4><p className="mt-1 whitespace-pre-wrap">{text}</p></div>)}
    <dl className="grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 sm:grid-cols-2">{([['提出时间', task.created_at], ['开始开发', task.started_at], ['测试通过记录', task.tested_at], ['上线记录', task.deployed_at]] as const).map(([label, value]) => <div key={label}><dt className="inline">{label}：</dt><dd className="inline">{timestamp(value)}</dd></div>)}</dl>
  </div>
}
function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId()
  return <div className="text-sm font-medium text-slate-700"><label htmlFor={id}>{label}</label>{cloneElement(children, { id })}</div>
}
function toInput(task: DevelopmentTask): DevelopmentTaskInput {
  return { title: task.title, description: task.description, owner_name: task.owner_name, stage: task.stage, checklist: task.checklist,
    blocker: task.blocker, next_step: task.next_step, test_notes: task.test_notes, deployment_notes: task.deployment_notes }
}
function TaskDialog({ taskId, onClose, onSaved }: { taskId: string | null; onClose: () => void; onSaved: () => void }) {
  const [task, setTask] = useState<DevelopmentTask | null>(null)
  const [form, setForm] = useState<DevelopmentTaskInput>(EMPTY)
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [eventTotal, setEventTotal] = useState(0)
  const [eventPage, setEventPage] = useState(1)
  const [editing, setEditing] = useState(!taskId)
  const [loading, setLoading] = useState(!!taskId)
  const [canManage, setCanManage] = useState(!taskId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [archive, setArchive] = useState(false)
  const [releaseId, setReleaseId] = useState('')
  const [releases, setReleases] = useState<{ id: string; version: string; title: string; status: string }[]>([])
  const [releasePage, setReleasePage] = useState(1)
  const [releaseTotal, setReleaseTotal] = useState(0)
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const dirty = useRef(false)
  dirty.current = archive ? !!(releaseId || note) : editing && (JSON.stringify(form) !== JSON.stringify(task ? toInput(task) : EMPTY) || !!note)
  function close() { if (!saving && (!dirty.current || window.confirm('尚有未保存的内容，确定放弃并关闭？'))) onClose() }
  useEffect(() => {
    if (!taskId) return
    const controller = new AbortController()
    setLoading(true); setError('')
    request(`/api/development-log/tasks/${taskId}?page=${eventPage}`, { signal: controller.signal })
      .then(body => { setTask(body.task); setForm(toInput(body.task)); setEvents(body.events); setEventTotal(body.total); setCanManage(body.canManage) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [taskId, eventPage, reload])
  useEffect(() => {
    if (!archive) return
    const controller = new AbortController()
    setReleaseLoading(true); setError('')
    request(`/api/development-log?page=${releasePage}&pageSize=10`, { signal: controller.signal })
      .then(body => { setReleases(body.releases); setReleaseTotal(body.total) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setReleaseLoading(false) })
    return () => controller.abort()
  }, [archive, releasePage, reload])
  function update<K extends keyof DevelopmentTaskInput>(key: K, value: DevelopmentTaskInput[K]) { setForm(previous => ({ ...previous, [key]: value })) }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSaving(true)
    try {
      const payload = archive ? { action: 'archive', releaseId, revision: task?.revision, note: note || '归入发布版本，保留开发过程' }
        : { ...form, revision: task?.revision, note }
      await request(taskId ? `/api/development-log/tasks/${taskId}` : '/api/development-log/tasks', { method: taskId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      dirty.current = false; onSaved(); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
    finally { setSaving(false) }
  }
  return <AppDialog title={!taskId ? '新增开发事项' : archive ? '归入发布版本' : editing ? '更新开发进度' : task?.title || '开发事项'} description="只有项目负责人可修改；每次保存追加历史，归档不会删除原来的过程。" onClose={close} closeOnBackdrop={false} width="max-w-3xl">
    {error && <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}{!editing && !saving && <button className="btn-secondary ml-2" onClick={() => setReload(n => n + 1)}>重试</button>}</div>}
    {loading ? <p role="status" className="py-6 text-sm text-slate-500">读取事项与进度历史…</p> : editing || archive ? <form onSubmit={save} className="space-y-4">
      <fieldset disabled={saving} className="space-y-4 disabled:opacity-70">
        {archive ? <>
          <p className="text-sm text-slate-700">{task?.title}：选择已经发布的版本。只建立关联，不改写旧日志；同一版本可归入多个事项。</p>
          <Field label="发布版本"><select required className={INPUT} value={releaseId} onChange={event => setReleaseId(event.target.value)} disabled={releaseLoading}><option value="">请选择版本</option>{releases.filter(item => item.status === 'completed').map(item => <option key={item.id} value={item.id}>{item.version} · {item.title}</option>)}</select></Field>
          {releaseLoading && <p role="status" className="text-xs text-slate-500">正在读取版本…</p>}
          <Pager page={releasePage} total={releaseTotal} onChange={value => { setReleasePage(value); setReleaseId('') }} disabled={releaseLoading} label="可归档版本分页" />
        </> : <>
          <Field label="事项名称"><input required maxLength={120} className={INPUT} value={form.title} onChange={event => update('title', event.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="负责人"><input maxLength={80} className={INPUT} placeholder="可以暂不指定" value={form.owner_name} onChange={event => update('owner_name', event.target.value)} /></Field>
            <Field label="当前阶段"><select className={INPUT} value={form.stage} onChange={event => update('stage', event.target.value as DevelopmentStage)}>{DEVELOPMENT_STAGES.map(stage => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}</select></Field></div>
          <DevelopmentStageProgress stage={form.stage} />
          <Field label="需求背景 / 想解决什么"><textarea required rows={3} maxLength={4000} className={INPUT} value={form.description} onChange={event => update('description', event.target.value)} /></Field>
          <section aria-label="检查项" className="space-y-2"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-slate-800">检查项（最多 30 项）</h3><button type="button" className="btn-secondary" disabled={form.checklist.length >= 30} onClick={() => update('checklist', [...form.checklist, { id: crypto.randomUUID(), text: '', done: false }])}>添加检查项</button></div>
            {form.checklist.map((item, index) => <div key={item.id} className="flex items-center gap-2"><input type="checkbox" aria-label={`完成检查项 ${index + 1}`} checked={item.done} className="h-4 w-4 accent-emerald-600" onChange={event => update('checklist', form.checklist.map(check => check.id === item.id ? { ...check, done: event.target.checked } : check))} /><input required aria-label={`检查项 ${index + 1}内容`} maxLength={300} className={`${INPUT} !mt-0 min-w-0 flex-1`} value={item.text} onChange={event => update('checklist', form.checklist.map(check => check.id === item.id ? { ...check, text: event.target.value } : check))} /><button type="button" className="btn-ghost" aria-label={`移除检查项 ${index + 1}`} onClick={() => update('checklist', form.checklist.filter(check => check.id !== item.id))}>移除</button></div>)}
            <ProgressBar task={form} />
          </section>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="当前难题 / 暂停或取消原因"><textarea rows={3} maxLength={2000} className={INPUT} required={['paused', 'cancelled'].includes(form.stage)} value={form.blocker} onChange={event => update('blocker', event.target.value)} /></Field><Field label="下一步"><textarea rows={3} maxLength={2000} className={INPUT} value={form.next_step} onChange={event => update('next_step', event.target.value)} /></Field></div>
          <details open={['testing', 'ready', 'live'].includes(form.stage)}><summary className="cursor-pointer text-sm font-medium text-slate-800">测试与上线依据</summary><div className="mt-3 space-y-3">
            <p className="text-xs text-slate-600">待上线前需完成全部检查项并填写测试结果；已上线还需填写线上验证，不能只写“已推送”。</p>
            <Field label="测试结果 / 验收依据"><textarea rows={3} maxLength={4000} required={['ready', 'live'].includes(form.stage)} className={INPUT} value={form.test_notes} onChange={event => update('test_notes', event.target.value)} /></Field>
            <Field label="部署与线上验证"><textarea rows={3} maxLength={4000} required={form.stage === 'live'} className={INPUT} value={form.deployment_notes} onChange={event => update('deployment_notes', event.target.value)} /></Field>
          </div></details>
        </>}
        {taskId && <Field label="本次进展说明"><textarea required={!archive} rows={2} maxLength={2000} className={INPUT} placeholder="记录本次做了什么、解决了什么问题" value={note} onChange={event => setNote(event.target.value)} /></Field>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" className="btn-secondary" onClick={close}>取消</button><button className="btn-primary" disabled={saving || (archive && (!releaseId || releaseLoading))}>{saving ? '保存中…' : archive ? '确认归档' : '保存进度'}</button></div>
      </fieldset>
    </form> : task && <div className="space-y-5">
      <Facts task={task} />
      {canManage && !task.release_id && <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4"><button className="btn-primary" onClick={() => setEditing(true)}>更新进度</button>{task.stage === 'live' && <button className="btn-secondary" onClick={() => setArchive(true)}>归入发布版本</button>}</div>}
      <section className="border-t border-slate-200 pt-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">进度历史 · {eventTotal} 条</h3><ol className="space-y-3">{events.map(event => <li key={event.id} className="border-l-2 border-slate-200 pl-3"><p className="text-xs text-slate-500">{timestamp(event.created_at)} · {event.actor_name} · {STAGE_LABELS[event.snapshot.stage]}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{event.note}</p><details className="mt-1"><summary className="cursor-pointer text-xs text-emerald-700">查看当时的完整记录</summary><div className="mt-3 border-t border-slate-100 pt-3"><Facts task={event.snapshot} /></div></details></li>)}</ol><Pager page={eventPage} total={eventTotal} onChange={setEventPage} disabled={loading} label="进度历史分页" /></section>
    </div>}
  </AppDialog>
}

export function ReleaseDevelopmentTasks({ releaseId, refreshKey = 0 }: { releaseId: string; refreshKey?: number }) {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<DevelopmentTask[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError('')
    request(`/api/development-log/tasks?releaseId=${releaseId}&page=${page}`, { signal: controller.signal })
      .then(body => { setTasks(body.tasks); setTotal(body.total) }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, releaseId, page, retry, refreshKey])
  return <section className="mt-4 border-t border-slate-100 pt-3">
    <button aria-expanded={open} className="text-sm font-medium text-emerald-700 hover:underline" onClick={() => setOpen(!open)}>{open ? '收起开发过程' : '查看关联开发过程'}</button>
    {open && <div className="mt-3 text-sm">{error ? <p role="alert" className="text-red-700">{error}<button className="btn-secondary ml-2" onClick={() => setRetry(n => n + 1)}>重试</button></p> : loading ? <p role="status" className="text-slate-500">读取关联事项…</p> : tasks.length ? <ul className="space-y-2">{tasks.map(task => <li key={task.id}><button className="text-left text-slate-800 hover:text-emerald-700 hover:underline" onClick={() => setSelected(task.id)}>{task.title} · 查看难题、测试与进度历史</button></li>)}</ul> : <p className="text-slate-500">这个版本暂未关联开发事项。旧版本内容保留不变。</p>}<Pager page={page} total={total} onChange={setPage} disabled={loading} label="版本关联事项分页" /></div>}
    {selected && <TaskDialog taskId={selected} onClose={() => setSelected(null)} onSaved={() => setRetry(n => n + 1)} />}
  </section>
}
