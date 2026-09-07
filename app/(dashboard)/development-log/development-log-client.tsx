'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'

type DevelopmentRelease = {
  id: string
  version: string
  title: string
  release_date: string
  summary: string
  highlights: string[]
  implementation_notes: string[]
  limitations: string[]
  source_note: string | null
}
type ReleaseForm = {
  version: string
  title: string
  releaseDate: string
  summary: string
  highlights: string
  implementationNotes: string
  limitations: string
  sourceNote: string
}

const PAGE_SIZE = 10
const EMPTY_RELEASE: ReleaseForm = {
  version: '', title: '', releaseDate: '', summary: '',
  highlights: '', implementationNotes: '', limitations: '', sourceNote: '',
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
          <span aria-hidden="true" className="mt-0.5 font-mono text-xs font-bold tabular-nums text-emerald-700">{String(index + 1).padStart(2, '0')}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function ReleaseDetails({ implementation, limitations }: { implementation: string[]; limitations: string[] }) {
  if (!implementation.length && !limitations.length) return null
  return (
    <details className="group mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <summary className="relative grid cursor-pointer list-none gap-2 px-4 py-3 pr-11 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset [&::-webkit-details-marker]:hidden sm:grid-cols-2">
        <span>实现方式与交接重点 <span className="font-normal text-slate-400">({implementation.length})</span></span>
        <span>限制与维护提醒 <span className="font-normal text-slate-400">({limitations.length})</span></span>
        <svg viewBox="0 0 20 20" className="absolute right-4 top-3.5 h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7.5 5 5 5-5" /></svg>
      </summary>
      <div className="grid gap-4 border-t border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2">
        <DetailList title="实现方式与交接重点" items={implementation} />
        <DetailList title="限制与维护提醒" items={limitations} warning />
      </div>
    </details>
  )
}

function DetailList({ title, items, warning = false }: { title: string; items: string[]; warning?: boolean }) {
  return (
    <section className={`rounded-xl border p-4 ${warning ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-slate-200 bg-white text-slate-700'}`}>
      <h5 className="text-xs font-bold">{title}</h5>
      {items.length ? (
        <ul className="mt-2 space-y-2 text-sm leading-6">
          {items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><span aria-hidden="true" className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" /><span>{item}</span></li>)}
        </ul>
      ) : <p className="mt-2 text-sm opacity-60">暂无内容</p>}
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
      summary: release.summary, highlights: release.highlights.join('\n'),
      implementationNotes: release.implementation_notes.join('\n'), limitations: release.limitations.join('\n'),
      sourceNote: release.source_note ?? '',
    })
    setFormOpen(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const payload = {
        kind: 'release', ...form, status: 'completed', highlights: lines(form.highlights),
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
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-700">奇心内容发布系统</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">开发日志</h1>
            <p className="mt-2 text-sm text-slate-500">记录正式版本的主题、内容、实现方式与维护说明。</p>
          </div>
          <div className="flex items-center gap-3">
            {!loading && <span className="text-sm text-slate-500">共 {total} 个版本</span>}
            {canManage && !loading && (
              <button type="button" onClick={startNew} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 4v12M4 10h12" /></svg>
                新增版本
              </button>
            )}
          </div>
        </header>

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
                {releases.map(release => (
                  <ReleaseTimelineItem key={release.id} release={release} canManage={canManage} onEdit={startEdit} />
                ))}
                <Pagination page={page} total={total} onChange={setPage} />
              </div>
            )}
        </section>
      </main>
    </div>
  )
}

function ReleaseTimelineItem({ release, canManage, onEdit }: { release: DevelopmentRelease; canManage: boolean; onEdit: (release: DevelopmentRelease) => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md md:grid md:grid-cols-[190px_minmax(0,1fr)]">
      <header className="flex flex-col justify-between bg-slate-950 p-5 text-white sm:p-6 md:min-h-64">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Version</p>
          <p className="mt-2 break-all font-mono text-3xl font-bold tracking-tight text-emerald-300">{release.version}</p>
        </div>
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs text-slate-400">上线日期</p>
          <p className="mt-1 text-sm font-medium text-slate-100">{dateLabel(release.release_date)}</p>
        </div>
      </header>

      <div className="min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">版本主题</p>
              <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{release.title}</h3>
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
              <div className="mb-3 flex items-center gap-2"><h4 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">版本内容</h4><span className="h-px flex-1 bg-slate-100" /></div>
              <HighlightList items={release.highlights} />
            </section>
          )}

          <ReleaseDetails implementation={release.implementation_notes ?? []} limitations={release.limitations ?? []} />

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

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onCancel() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onCancel, saving])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onCancel() }}>
      <form onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="release-editor-title" className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div><h2 id="release-editor-title" className="text-lg font-bold text-slate-950">{editing ? '编辑版本记录' : '新增版本记录'}</h2><p className="mt-1 text-sm text-slate-500">保存后会作为正式版本显示，列表字段每行填写一项。</p></div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="关闭编辑窗口" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-40">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="版本号"><input required value={form.version} onChange={e => update('version', e.target.value)} placeholder="v2.4.0" className="field" /></Field>
            <Field label="版本日期"><input required type="date" value={form.releaseDate} onChange={e => update('releaseDate', e.target.value)} className="field" /></Field>
            <div className="sm:col-span-2"><Field label="版本主题"><input required maxLength={120} value={form.title} onChange={e => update('title', e.target.value)} className="field" /></Field></div>
            <div className="sm:col-span-2"><Field label="版本说明"><textarea required rows={3} value={form.summary} onChange={e => update('summary', e.target.value)} className="field" /></Field></div>
            <Field label="版本内容（每行一项）"><textarea rows={6} value={form.highlights} onChange={e => update('highlights', e.target.value)} className="field" /></Field>
            <Field label="实现与交接重点（每行一项）"><textarea rows={6} value={form.implementationNotes} onChange={e => update('implementationNotes', e.target.value)} className="field" /></Field>
            <Field label="限制与维护提醒（每行一项）"><textarea rows={5} value={form.limitations} onChange={e => update('limitations', e.target.value)} className="field" /></Field>
            <Field label="内部备注（仅你可见）"><textarea rows={5} value={form.sourceNote} onChange={e => update('sourceNote', e.target.value)} placeholder="例如：为什么会有这个想法、当时遇到了什么问题" className="field" /></Field>
          </div>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">取消</button>
          <button disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">{saving ? '保存中…' : '保存版本'}</button>
        </footer>
        <style jsx>{`.field{margin-top:.375rem;width:100%;border-radius:.5rem;border:1px solid rgb(203 213 225);padding:.625rem .75rem;font-weight:400;color:rgb(15 23 42);outline:none}.field:focus{border-color:rgb(16 185 129);box-shadow:0 0 0 2px rgb(209 250 229)}`}</style>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700">{label}{children}</label>
}
