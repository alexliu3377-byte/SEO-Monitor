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

function HighlightList({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {items.map((item, index) => (
        <li key={`${index}-${item}`} className="flex gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-5 text-slate-700">
          <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m4 10 4 4 8-8" /></svg>
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function DetailPanel({ title, items, warning = false }: { title: string; items: string[]; warning?: boolean }) {
  if (!items.length) return null
  return (
    <details className={`group overflow-hidden rounded-xl border ${warning ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset [&::-webkit-details-marker]:hidden ${warning ? 'text-amber-900' : 'text-slate-800'}`}>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-lg ${warning ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
            {warning ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 9v4m0 4h.01M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 4 7v5c0 4.4 3.4 7.8 8 9 4.6-1.2 8-4.6 8-9V7l-8-4Z" /><path d="m9 12 2 2 4-4" /></svg>
            )}
          </span>
          {title}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${warning ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{items.length} 项</span>
        </span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-current transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7.5 5 5 5-5" /></svg>
      </summary>
      <ul className={`space-y-2 border-t px-4 py-3 text-sm leading-6 ${warning ? 'border-amber-200 text-amber-900/80' : 'border-slate-100 text-slate-600'}`}>
        {items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><span aria-hidden="true" className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" /><span>{item}</span></li>)}
      </ul>
    </details>
  )
}

export default function DevelopmentLogClient() {
  const [releases, setReleases] = useState<DevelopmentRelease[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [currentVersion, setCurrentVersion] = useState('')
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
      if (targetPage === 1) setCurrentVersion(body.releases?.[0]?.version ?? '')
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
    <div className="min-h-full bg-[#f6f8fb]">
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <section className="relative overflow-hidden rounded-[28px] bg-slate-950 px-6 py-7 text-white shadow-[0_20px_60px_-32px_rgba(15,23,42,0.7)] sm:px-8 sm:py-9">
          <div aria-hidden="true" className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                <span className="h-px w-7 bg-emerald-400" />
                奇心内容发布系统
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">开发日志</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">记录每个阶段解决的问题、实现方式与维护边界，让管理层快速掌握产品进展，也让后续维护人员能够顺利接手。</p>
              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">仅超管可查看</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">按产品阶段记录</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">支持长期交接</span>
              </div>
            </div>
            <div className="flex flex-wrap items-stretch gap-3 lg:justify-end">
              <div className="min-w-28 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-sm">
                <p className="text-xs text-slate-400">版本记录</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{loading ? '—' : total}</p>
              </div>
              <div className="min-w-36 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-xs text-emerald-200">当前版本</p>
                <p className="mt-1 font-mono text-xl font-semibold text-emerald-300">{currentVersion || '—'}</p>
              </div>
              {canManage && !loading && (
                <button type="button" onClick={startNew} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 4v12M4 10h12" /></svg>
                  新增版本
                </button>
              )}
            </div>
          </div>
        </section>

        {message && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}
        {formOpen && canManage && <ReleaseEditor form={form} setForm={setForm} saving={saving} editing={Boolean(editingId)} onSubmit={save} onCancel={() => setFormOpen(false)} />}

        <section aria-labelledby="release-timeline-title" className="mx-auto min-w-0 max-w-5xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div><h2 id="release-timeline-title" className="text-xl font-bold text-slate-950">版本更新记录</h2><p className="mt-1 text-sm text-slate-500">按完成时间从新到旧排列，只记录有意义的产品阶段。</p></div>
              {!loading && total > 0 && <span className="text-xs text-slate-500">共 {total} 个版本</span>}
            </div>

            {loading && <div className="space-y-4" aria-label="正在加载"><div className="h-44 animate-pulse rounded-2xl bg-slate-200" /><div className="h-64 animate-pulse rounded-2xl bg-slate-200" /></div>}
            {!loading && error && <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><p>{error}</p><button type="button" onClick={() => void load(page)} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 font-medium">重试</button></div>}

            {!loading && !error && releases.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><p className="font-medium text-slate-700">暂无版本记录</p><p className="mt-1 text-sm text-slate-500">完成一轮有意义的产品更新后再建立版本。</p></div>
            )}

            {!loading && !error && (
              <div className="space-y-5">
                {releases.map((release, index) => (
                  <ReleaseTimelineItem key={release.id} release={release} latest={page === 1 && index === 0} canManage={canManage} onEdit={startEdit} />
                ))}
                <Pagination page={page} total={total} onChange={setPage} />
              </div>
            )}
        </section>
      </main>
    </div>
  )
}

function ReleaseTimelineItem({ release, latest, canManage, onEdit }: { release: DevelopmentRelease; latest: boolean; canManage: boolean; onEdit: (release: DevelopmentRelease) => void }) {
  return (
    <article className="grid gap-3 md:grid-cols-[110px_minmax(0,1fr)] md:gap-6">
      <div className="relative hidden pt-5 text-right md:block">
        <p className="text-xs font-semibold text-slate-700">{dateLabel(release.release_date)}</p>
        {release.deployment_range && <p className="mt-1 text-[11px] leading-4 text-slate-400">{release.deployment_range}</p>}
        <span aria-hidden="true" className={`absolute -right-[29px] top-6 z-10 h-3 w-3 rounded-full border-[3px] bg-white ${latest ? 'border-emerald-500 ring-4 ring-emerald-100' : 'border-slate-300'}`} />
        <span aria-hidden="true" className="absolute -right-6 top-0 h-[calc(100%+1.25rem)] w-px bg-slate-200" />
      </div>

      <div className={`overflow-hidden rounded-2xl border bg-white transition-shadow ${latest ? 'border-emerald-200 shadow-[0_16px_40px_-28px_rgba(5,150,105,0.7)]' : 'border-slate-200 shadow-sm hover:shadow-md'}`}>
        {latest && <div className="h-1 bg-gradient-to-r from-emerald-500 via-green-400 to-cyan-400" />}
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-lg px-2.5 py-1 font-mono text-sm font-bold ${latest ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'}`}>{release.version}</span>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS[release.status].className}`}>{STATUS[release.status].label}</span>
                {latest && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">最新版本</span>}
                <span className="text-xs text-slate-500 md:hidden">{dateLabel(release.release_date)}</span>
              </div>
              <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{release.title}</h3>
            </div>
            {canManage && (
              <button type="button" onClick={() => onEdit(release)} aria-label={`编辑 ${release.version}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m13.5 3.5 3 3L7 16l-4 1 1-4 9.5-9.5Z" /></svg>
                编辑
              </button>
            )}
          </div>

          <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600">{release.summary}</p>

          {release.highlights?.length > 0 && (
            <section className="mt-5">
              <div className="mb-3 flex items-center gap-2"><h4 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">本版本完成内容</h4><span className="h-px flex-1 bg-slate-100" /></div>
              <HighlightList items={release.highlights} />
            </section>
          )}

          <div className="mt-4 grid gap-2 lg:grid-cols-2">
            <DetailPanel title="实现方式与交接重点" items={release.implementation_notes ?? []} />
            <DetailPanel title="限制与维护提醒" items={release.limitations ?? []} warning />
          </div>

          {canManage && release.source_note && (
            <section className="mt-4 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-bold text-violet-800">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 9V6a4 4 0 0 1 8 0v3m-9 0h10v8H5V9Z" /></svg>
                内部备注 · 仅你可见
              </div>
              <p className="mt-2 text-sm leading-6 text-violet-950/75">{release.source_note}</p>
            </section>
          )}
        </div>
      </div>
    </article>
  )
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (total <= PAGE_SIZE) return null
  return (
    <nav aria-label="版本记录分页" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-500">第 <span className="font-semibold text-slate-800">{page}</span> / {pages} 页 · 共 {total} 条</p>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">上一页</button>
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">下一页</button>
      </div>
    </nav>
  )
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
        <div className="space-y-4"><Field label="开发时间范围"><input value={form.deploymentRange} onChange={e => update('deploymentRange', e.target.value)} className="field" /></Field><Field label="内部备注（仅你可见）"><textarea rows={3} value={form.sourceNote} onChange={e => update('sourceNote', e.target.value)} placeholder="例如：为什么会有这个想法、当时遇到了什么问题" className="field" /></Field></div>
      </div>
      <div className="mt-5 flex gap-2"><button disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{saving ? '保存中…' : '保存版本'}</button><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm">取消</button></div>
      <style jsx>{`.field{margin-top:.375rem;width:100%;border-radius:.5rem;border:1px solid rgb(203 213 225);padding:.625rem .75rem;font-weight:400;color:rgb(15 23 42);outline:none}.field:focus{border-color:rgb(16 185 129);box-shadow:0 0 0 2px rgb(209 250 229)}`}</style>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700">{label}{children}</label>
}
