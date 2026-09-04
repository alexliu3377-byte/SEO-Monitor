'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'

type ReleaseStatus = 'completed' | 'in_progress' | 'planned'
type DevelopmentRelease = {
  id: string
  version: string
  title: string
  release_date: string
  status: ReleaseStatus
  summary: string
  highlights: string[]
  implementation_notes: string[]
  limitations: string[]
  deployment_range: string | null
  source_note: string | null
}
type ReleaseForm = {
  version: string
  title: string
  releaseDate: string
  status: ReleaseStatus
  summary: string
  highlights: string
  implementationNotes: string
  limitations: string
  deploymentRange: string
  sourceNote: string
}

const PAGE_SIZE = 10
const EMPTY_RELEASE: ReleaseForm = {
  version: '', title: '', releaseDate: '', status: 'completed', summary: '',
  highlights: '', implementationNotes: '', limitations: '', deploymentRange: '', sourceNote: '',
}
const STATUS: Record<ReleaseStatus, { label: string; className: string }> = {
  completed: { label: '已完成', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  in_progress: { label: '开发中', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  planned: { label: '规划中', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
}

function lines(value: string) {
  return value.split('\n').map(item => item.trim()).filter(Boolean)
}

function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00+08:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kuala_Lumpur',
  }).format(date)
}

function InfoList({ title, items, warning = false }: { title: string; items: string[]; warning?: boolean }) {
  if (!items.length) return null
  return (
    <section className={warning ? 'rounded-xl bg-amber-50/70 p-4' : ''}>
      <h3 className={`text-sm font-semibold ${warning ? 'text-amber-900' : 'text-slate-900'}`}>{title}</h3>
      <ul className={`mt-2 space-y-2 text-sm leading-6 ${warning ? 'text-amber-900/80' : 'text-slate-600'}`}>
        {items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" /><span>{item}</span></li>)}
      </ul>
    </section>
  )
}

export default function DevelopmentLogClient() {
  const [releases, setReleases] = useState<DevelopmentRelease[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ReleaseForm>(EMPTY_RELEASE)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (targetPage: number) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/development-log?page=${targetPage}&pageSize=${PAGE_SIZE}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '开发日志加载失败')
      setReleases(body.releases ?? [])
      setTotal(body.total ?? 0)
      setCanManage(Boolean(body.permissions?.canManage))
    } catch (err) {
      setError(err instanceof Error ? err.message : '开发日志加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(page) }, [load, page])

  function startNew() {
    setEditingId(null)
    setForm({ ...EMPTY_RELEASE, releaseDate: new Date().toISOString().slice(0, 10) })
    setFormOpen(true)
  }

  function startEdit(release: DevelopmentRelease) {
    setEditingId(release.id)
    setForm({
      version: release.version, title: release.title, releaseDate: release.release_date,
      status: release.status, summary: release.summary, highlights: release.highlights.join('\n'),
      implementationNotes: release.implementation_notes.join('\n'), limitations: release.limitations.join('\n'),
      deploymentRange: release.deployment_range ?? '', sourceNote: release.source_note ?? '',
    })
    setFormOpen(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const payload = {
        kind: 'release', ...form, highlights: lines(form.highlights),
        implementationNotes: lines(form.implementationNotes), limitations: lines(form.limitations),
      }
      const response = await fetch(editingId ? `/api/development-log/${editingId}` : '/api/development-log', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '版本保存失败')
      setFormOpen(false)
      setEditingId(null)
      setMessage('版本记录已保存。')
      if (page === 1) await load(1)
      else setPage(1)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '版本保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">项目交接与版本维护</p><h1 className="mt-1 text-2xl font-bold text-slate-950">开发日志</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">仅超管可查看，用于说明系统演进、实现方式和长期维护限制。</p></div>
          {canManage && !loading && <button type="button" onClick={startNew} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">新增版本</button>}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {message && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}
        <section className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-5">
          <h2 className="font-semibold text-emerald-950">版本记录规则</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-900/80">开发日志按系统发展阶段和实际使用变化整理，帮助管理层与后续维护人员快速了解每一轮更新解决了什么问题。</p>
          <p className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-sm font-medium text-emerald-900">部署不等于版本：同一目标下的多次调整与上线测试合并记录；单独修 Bug、改文案、调样式或补测试不单独升版本。</p>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
            <VersionRule version="v1.0.0 / v2.0.0" text="主版本：系统用途或工作方式明显改变" />
            <VersionRule version="v2.1.0" text="次版本：新增一组重要功能或能力" />
            <VersionRule version="v2.3.1" text="修订版本：完成一整轮权限、性能或稳定性更新" />
          </div>
        </section>

        {formOpen && canManage && <ReleaseEditor form={form} setForm={setForm} saving={saving} editing={Boolean(editingId)} onSubmit={save} onCancel={() => setFormOpen(false)} />}
        {loading && <div className="space-y-4" aria-label="正在加载"><div className="h-36 animate-pulse rounded-xl bg-slate-200" /><div className="h-56 animate-pulse rounded-xl bg-slate-200" /></div>}
        {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><p>{error}</p><button type="button" onClick={() => void load(page)} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 font-medium">重试</button></div>}

        {!loading && !error && releases.map(release => (
          <article key={release.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-slate-950 px-2.5 py-1 font-mono text-sm font-semibold text-white">{release.version}</span><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS[release.status].className}`}>{STATUS[release.status].label}</span><span className="text-xs text-slate-500">{dateLabel(release.release_date)}</span>{release.deployment_range && <span className="text-xs text-slate-400">开发范围：{release.deployment_range}</span>}</div>
              <div className="mt-3 flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-950">{release.title}</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{release.summary}</p></div>{canManage && <button type="button" onClick={() => startEdit(release)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">编辑</button>}</div>
            </div>
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2"><InfoList title="本版本完成内容" items={release.highlights ?? []} /><InfoList title="实现方式（交接重点）" items={release.implementation_notes ?? []} /><div className="lg:col-span-2"><InfoList title="已知限制与维护提醒" items={release.limitations ?? []} warning /></div></div>
          </article>
        ))}
        {!loading && !error && <Pagination page={page} total={total} onChange={setPage} />}
      </main>
    </div>
  )
}

function VersionRule({ version, text }: { version: string; text: string }) {
  return <div className="rounded-lg bg-white/80 p-3"><span className="font-mono font-semibold text-emerald-800">{version}</span><p className="mt-1 text-slate-600">{text}</p></div>
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (total <= PAGE_SIZE) return null
  return <nav aria-label="版本记录分页" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-sm text-slate-500">第 {page} / {pages} 页 · 共 {total} 条</p><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">上一页</button><button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">下一页</button></div></nav>
}

function ReleaseEditor({ form, setForm, saving, editing, onSubmit, onCancel }: { form: ReleaseForm; setForm: (form: ReleaseForm) => void; saving: boolean; editing: boolean; onSubmit: (event: FormEvent) => void; onCancel: () => void }) {
  function update<K extends keyof ReleaseForm>(key: K, value: ReleaseForm[K]) { setForm({ ...form, [key]: value }) }
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-950">{editing ? '编辑版本记录' : '新增版本记录'}</h2><p className="mt-1 text-sm text-slate-500">列表字段每行填写一项。</p></div><button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100">关闭</button></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="版本号"><input required value={form.version} onChange={e => update('version', e.target.value)} placeholder="v2.4.0" className="field" /></Field>
        <Field label="版本日期"><input required type="date" value={form.releaseDate} onChange={e => update('releaseDate', e.target.value)} className="field" /></Field>
        <Field label="版本标题"><input required maxLength={120} value={form.title} onChange={e => update('title', e.target.value)} className="field" /></Field>
        <Field label="完成状态"><select value={form.status} onChange={e => update('status', e.target.value as ReleaseStatus)} className="field"><option value="completed">已完成</option><option value="in_progress">开发中</option><option value="planned">规划中</option></select></Field>
        <div className="sm:col-span-2"><Field label="版本说明"><textarea required rows={3} value={form.summary} onChange={e => update('summary', e.target.value)} className="field" /></Field></div>
        <Field label="完成内容（每行一项）"><textarea rows={6} value={form.highlights} onChange={e => update('highlights', e.target.value)} className="field" /></Field>
        <Field label="实现与交接重点（每行一项）"><textarea rows={6} value={form.implementationNotes} onChange={e => update('implementationNotes', e.target.value)} className="field" /></Field>
        <Field label="限制与维护提醒（每行一项）"><textarea rows={5} value={form.limitations} onChange={e => update('limitations', e.target.value)} className="field" /></Field>
        <div className="space-y-4"><Field label="开发时间范围"><input value={form.deploymentRange} onChange={e => update('deploymentRange', e.target.value)} className="field" /></Field><Field label="记录依据"><input value={form.sourceNote} onChange={e => update('sourceNote', e.target.value)} className="field" /></Field></div>
      </div>
      <div className="mt-5 flex gap-2"><button disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{saving ? '保存中…' : '保存版本'}</button><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm">取消</button></div>
      <style jsx>{`.field{margin-top:.375rem;width:100%;border-radius:.5rem;border:1px solid rgb(203 213 225);padding:.625rem .75rem;font-weight:400;color:rgb(15 23 42);outline:none}.field:focus{border-color:rgb(16 185 129);box-shadow:0 0 0 2px rgb(209 250 229)}`}</style>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700">{label}{children}</label>
}
