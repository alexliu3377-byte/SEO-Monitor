'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'

type ReleaseStatus = 'completed' | 'in_progress' | 'planned'
type RequestStatus = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'blocked' | 'declined'

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

type DevelopmentRequest = {
  id: string
  title: string
  details: string
  status: RequestStatus
  problem_details: string | null
  owner_response: string | null
  created_by_name: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

type Permissions = { canSubmitRequest: boolean; canManage: boolean }
type Tab = 'releases' | 'requests'
const PAGE_SIZE = 10

const RELEASE_STATUS: Record<ReleaseStatus, { label: string; className: string }> = {
  completed: { label: '已完成', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  in_progress: { label: '开发中', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  planned: { label: '规划中', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
}

const REQUEST_STATUS: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: '待评估', className: 'bg-slate-100 text-slate-700 ring-slate-200' },
  accepted: { label: '已接受', className: 'bg-violet-50 text-violet-700 ring-violet-200' },
  in_progress: { label: '开发中', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  completed: { label: '已完成', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  blocked: { label: '遇到问题', className: 'bg-red-50 text-red-700 ring-red-200' },
  declined: { label: '暂不处理', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
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

const EMPTY_RELEASE: ReleaseForm = {
  version: '', title: '', releaseDate: '', status: 'completed', summary: '',
  highlights: '', implementationNotes: '', limitations: '', deploymentRange: '', sourceNote: '',
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

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur', hour12: false,
  }).format(new Date(value))
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>{label}</span>
}

function InfoList({ title, items, tone = 'normal' }: { title: string; items: string[]; tone?: 'normal' | 'warning' }) {
  if (!items.length) return null
  return (
    <section className={tone === 'warning' ? 'rounded-xl bg-amber-50/70 p-4' : ''}>
      <h4 className={`text-sm font-semibold ${tone === 'warning' ? 'text-amber-900' : 'text-slate-900'}`}>{title}</h4>
      <ul className={`mt-2 space-y-2 text-sm leading-6 ${tone === 'warning' ? 'text-amber-900/80' : 'text-slate-600'}`}>
        {items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" /> <span>{item}</span></li>)}
      </ul>
    </section>
  )
}

export default function DevelopmentLogClient() {
  const [tab, setTab] = useState<Tab>('releases')
  const [releases, setReleases] = useState<DevelopmentRelease[]>([])
  const [requests, setRequests] = useState<DevelopmentRequest[]>([])
  const [releasePage, setReleasePage] = useState(1)
  const [requestPage, setRequestPage] = useState(1)
  const [releaseTotal, setReleaseTotal] = useState(0)
  const [requestTotal, setRequestTotal] = useState(0)
  const [permissions, setPermissions] = useState<Permissions>({ canSubmitRequest: false, canManage: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [requestTitle, setRequestTitle] = useState('')
  const [requestDetails, setRequestDetails] = useState('')
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [releaseFormOpen, setReleaseFormOpen] = useState(false)
  const [editingReleaseId, setEditingReleaseId] = useState<string | null>(null)
  const [releaseForm, setReleaseForm] = useState<ReleaseForm>(EMPTY_RELEASE)
  const [savingRelease, setSavingRelease] = useState(false)
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null)
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('pending')
  const [problemDetails, setProblemDetails] = useState('')
  const [ownerResponse, setOwnerResponse] = useState('')
  const [savingRequest, setSavingRequest] = useState(false)

  const load = useCallback(async (kind: Tab, page: number) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/development-log?kind=${kind}&page=${page}&pageSize=${PAGE_SIZE}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '开发日志加载失败')
      if (kind === 'releases') {
        setReleases(body.releases ?? [])
        setReleaseTotal(body.total ?? 0)
      } else {
        setRequests(body.requests ?? [])
        setRequestTotal(body.total ?? 0)
      }
      setPermissions(body.permissions ?? { canSubmitRequest: false, canManage: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : '开发日志加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(tab, tab === 'releases' ? releasePage : requestPage)
  }, [load, releasePage, requestPage, tab])

  async function submitRequest(event: FormEvent) {
    event.preventDefault()
    setSubmittingRequest(true)
    setMessage('')
    try {
      const response = await fetch('/api/development-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'request', title: requestTitle, details: requestDetails }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '意见提交失败')
      setRequestTitle('')
      setRequestDetails('')
      setMessage('意见已提交，项目负责人可以在这里更新处理进度。')
      if (requestPage === 1) await load('requests', 1)
      else setRequestPage(1)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '意见提交失败')
    } finally {
      setSubmittingRequest(false)
    }
  }

  function startNewRelease() {
    setEditingReleaseId(null)
    setReleaseForm({ ...EMPTY_RELEASE, releaseDate: new Date().toISOString().slice(0, 10) })
    setReleaseFormOpen(true)
  }

  function startEditRelease(release: DevelopmentRelease) {
    setEditingReleaseId(release.id)
    setReleaseForm({
      version: release.version,
      title: release.title,
      releaseDate: release.release_date,
      status: release.status,
      summary: release.summary,
      highlights: release.highlights.join('\n'),
      implementationNotes: release.implementation_notes.join('\n'),
      limitations: release.limitations.join('\n'),
      deploymentRange: release.deployment_range ?? '',
      sourceNote: release.source_note ?? '',
    })
    setReleaseFormOpen(true)
  }

  async function saveRelease(event: FormEvent) {
    event.preventDefault()
    setSavingRelease(true)
    setMessage('')
    try {
      const payload = {
        kind: 'release',
        ...releaseForm,
        highlights: lines(releaseForm.highlights),
        implementationNotes: lines(releaseForm.implementationNotes),
        limitations: lines(releaseForm.limitations),
      }
      const response = await fetch(editingReleaseId ? `/api/development-log/${editingReleaseId}` : '/api/development-log', {
        method: editingReleaseId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '版本保存失败')
      if (editingReleaseId) {
        setReleases(previous => previous.map(item => item.id === editingReleaseId ? body.release : item))
      } else {
        if (releasePage === 1) await load('releases', 1)
        else setReleasePage(1)
      }
      setReleaseFormOpen(false)
      setEditingReleaseId(null)
      setMessage('版本记录已保存。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '版本保存失败')
    } finally {
      setSavingRelease(false)
    }
  }

  function startManageRequest(item: DevelopmentRequest) {
    setEditingRequestId(item.id)
    setRequestStatus(item.status)
    setProblemDetails(item.problem_details ?? '')
    setOwnerResponse(item.owner_response ?? '')
  }

  async function saveRequest() {
    if (!editingRequestId) return
    setSavingRequest(true)
    setMessage('')
    try {
      const response = await fetch(`/api/development-log/${editingRequestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'request', status: requestStatus, problemDetails, ownerResponse }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '处理状态保存失败')
      setRequests(previous => previous.map(item => item.id === editingRequestId ? body.request : item))
      setEditingRequestId(null)
      setMessage('意见处理状态已更新。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '处理状态保存失败')
    } finally {
      setSavingRequest(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">项目交接与改进</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">开发日志</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">了解系统为何这样设计、目前做到哪里，以及哪些需求正在评估或处理。</p>
          </div>
          {permissions.canManage && tab === 'releases' && !loading && (
            <button type="button" onClick={startNewRelease} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">新增版本</button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex border-b border-slate-200" role="tablist" aria-label="开发日志分类">
          <button type="button" role="tab" aria-selected={tab === 'releases'} onClick={() => setTab('releases')} className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === 'releases' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>版本开发记录</button>
          <button type="button" role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')} className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === 'requests' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>意见与优化 {requestTotal > 0 && <span className="ml-1 text-xs">({requestTotal})</span>}</button>
        </div>

        {message && <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800" role="status">{message}</div>}
        {loading && <div className="space-y-4" aria-label="正在加载"><div className="h-36 animate-pulse rounded-xl bg-slate-200" /><div className="h-56 animate-pulse rounded-xl bg-slate-200" /></div>}
        {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><p>{error}</p><button type="button" onClick={() => void load(tab, tab === 'releases' ? releasePage : requestPage)} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 font-medium hover:bg-red-50">重试</button></div>}

        {!loading && !error && tab === 'releases' && (
          <div className="space-y-5">
            <section className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-5">
              <h2 className="font-semibold text-emerald-950">这份版本记录怎么来的？</h2>
              <p className="mt-2 text-sm leading-6 text-emerald-900/80">本次整理核对了从 2026 年 6 月 8 日开始的 Git 提交，以及 GitHub 中 954 次 Vercel 历史部署。调试部署没有逐条列出，而是按真正影响使用方式的阶段归纳。旧 Vercel 账号即使无法登录，也不会影响这条可追溯时间线。</p>
              <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-lg bg-white/80 p-3"><span className="font-mono font-semibold text-emerald-800">v1.0.0 / v2.0.0</span><p className="mt-1 text-slate-600">主版本：系统用途或工作方式发生明显改变</p></div>
                <div className="rounded-lg bg-white/80 p-3"><span className="font-mono font-semibold text-emerald-800">v2.1.0</span><p className="mt-1 text-slate-600">次版本：新增一组重要功能或能力</p></div>
                <div className="rounded-lg bg-white/80 p-3"><span className="font-mono font-semibold text-emerald-800">v2.3.1</span><p className="mt-1 text-slate-600">修订版本：权限、性能、稳定性或小幅体验改进</p></div>
              </div>
            </section>

            {releaseFormOpen && permissions.canManage && (
              <ReleaseEditor form={releaseForm} setForm={setReleaseForm} saving={savingRelease} editing={Boolean(editingReleaseId)} onSubmit={saveRelease} onCancel={() => setReleaseFormOpen(false)} />
            )}

            {releases.map(release => {
              const status = RELEASE_STATUS[release.status]
              return (
                <article key={release.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 p-5 sm:p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-950 px-2.5 py-1 font-mono text-sm font-semibold text-white">{release.version}</span>
                      <StatusBadge {...status} />
                      <span className="text-xs text-slate-500">{dateLabel(release.release_date)}</span>
                      {release.deployment_range && <span className="text-xs text-slate-400">开发范围：{release.deployment_range}</span>}
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-4">
                      <div><h2 className="text-xl font-bold text-slate-950">{release.title}</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{release.summary}</p></div>
                      {permissions.canManage && <button type="button" onClick={() => startEditRelease(release)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">编辑</button>}
                    </div>
                  </div>
                  <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
                    <InfoList title="本版本完成内容" items={release.highlights ?? []} />
                    <InfoList title="实现方式（交接重点）" items={release.implementation_notes ?? []} />
                    <div className="lg:col-span-2"><InfoList title="已知限制与维护提醒" items={release.limitations ?? []} tone="warning" /></div>
                    {release.source_note && <p className="text-xs text-slate-400 lg:col-span-2">记录依据：{release.source_note}</p>}
                  </div>
                </article>
              )
            })}
            <Pagination page={releasePage} total={releaseTotal} pageSize={PAGE_SIZE} onChange={setReleasePage} label="版本记录" />
          </div>
        )}

        {!loading && !error && tab === 'requests' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">共 {requestTotal} 条意见；每次只从数据库读取当前页的 {PAGE_SIZE} 条记录。</div>

            {permissions.canSubmitRequest && (
              <form onSubmit={submitRequest} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-slate-950">提交功能意见或优化建议</h2>
                <p className="mt-1 text-sm text-slate-500">请说明使用场景、希望结果和当前遇到的问题，方便判断能否实现。</p>
                <div className="mt-4 grid gap-4">
                  <label className="text-sm font-medium text-slate-700">标题<input required maxLength={120} value={requestTitle} onChange={event => setRequestTitle(event.target.value)} placeholder="例如：成效报告增加季度筛选" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
                  <label className="text-sm font-medium text-slate-700">具体需求<textarea required maxLength={4000} rows={4} value={requestDetails} onChange={event => setRequestDetails(event.target.value)} placeholder="谁在什么情况下使用？现在有什么不方便？希望最终看到什么？" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
                </div>
                <button disabled={submittingRequest} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60">{submittingRequest ? '正在提交…' : '提交意见'}</button>
              </form>
            )}

            {requests.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="font-medium text-slate-800">暂时没有意见记录</p><p className="mt-1 text-sm text-slate-500">超管提交建议后，会在这里持续看到处理进度。</p></div>}
            {requests.map(item => {
              const status = REQUEST_STATUS[item.status]
              const editing = editingRequestId === item.id
              return (
                <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="flex flex-wrap items-center gap-2"><StatusBadge {...status} /><span className="text-xs text-slate-400">{item.created_by_name} · {dateTimeLabel(item.created_at)}</span></div><h2 className="mt-3 text-base font-semibold text-slate-950">{item.title}</h2></div>
                    {permissions.canManage && !editing && <button type="button" onClick={() => startManageRequest(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">更新进度</button>}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.details}</p>
                  {item.owner_response && <div className="mt-4 rounded-lg bg-blue-50 p-4"><p className="text-xs font-semibold text-blue-800">负责人回复</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-blue-900">{item.owner_response}</p></div>}
                  {item.problem_details && <div className="mt-4 rounded-lg bg-red-50 p-4"><p className="text-xs font-semibold text-red-800">问题详情</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-red-900">{item.problem_details}</p></div>}
                  {editing && permissions.canManage && (
                    <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
                      <label className="block text-sm font-medium text-slate-700">处理状态<select value={requestStatus} onChange={event => setRequestStatus(event.target.value as RequestStatus)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal sm:max-w-xs">{Object.entries(REQUEST_STATUS).map(([value, itemStatus]) => <option key={value} value={value}>{itemStatus.label}</option>)}</select></label>
                      <label className="block text-sm font-medium text-slate-700">给提议者的回复<textarea rows={3} maxLength={4000} value={ownerResponse} onChange={event => setOwnerResponse(event.target.value)} placeholder="说明是否能做、计划或已经完成的内容" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
                      <label className="block text-sm font-medium text-slate-700">问题详情<textarea rows={3} maxLength={4000} value={problemDetails} onChange={event => setProblemDetails(event.target.value)} placeholder="状态为“遇到问题”时，写明技术限制、外部依赖或下一步" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
                      <div className="flex gap-2"><button type="button" disabled={savingRequest} onClick={() => void saveRequest()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{savingRequest ? '保存中…' : '保存'}</button><button type="button" onClick={() => setEditingRequestId(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">取消</button></div>
                    </div>
                  )}
                </article>
              )
            })}
            <Pagination page={requestPage} total={requestTotal} pageSize={PAGE_SIZE} onChange={setRequestPage} label="意见记录" />
          </div>
        )}
      </main>
    </div>
  )
}

function Pagination({ page, total, pageSize, onChange, label }: { page: number; total: number; pageSize: number; onChange: (page: number) => void; label: string }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <nav aria-label={`${label}分页`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-sm text-slate-500">第 {page} / {totalPages} 页 · 共 {total} 条</p>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
        <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
      </div>
    </nav>
  )
}

function ReleaseEditor({ form, setForm, saving, editing, onSubmit, onCancel }: {
  form: ReleaseForm
  setForm: (value: ReleaseForm) => void
  saving: boolean
  editing: boolean
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
}) {
  function update<K extends keyof ReleaseForm>(key: K, value: ReleaseForm[K]) { setForm({ ...form, [key]: value }) }
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-950">{editing ? '编辑版本记录' : '新增版本记录'}</h2><p className="mt-1 text-sm text-slate-500">列表字段每行填写一项，保存后会自动显示为要点。</p></div><button type="button" onClick={onCancel} aria-label="关闭版本编辑" className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100">关闭</button></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="版本号"><input required value={form.version} onChange={e => update('version', e.target.value)} placeholder="v2.2.0" className="field" /></Field>
        <Field label="版本日期"><input required type="date" value={form.releaseDate} onChange={e => update('releaseDate', e.target.value)} className="field" /></Field>
        <Field label="版本标题"><input required maxLength={120} value={form.title} onChange={e => update('title', e.target.value)} className="field" /></Field>
        <Field label="完成状态"><select value={form.status} onChange={e => update('status', e.target.value as ReleaseStatus)} className="field"><option value="completed">已完成</option><option value="in_progress">开发中</option><option value="planned">规划中</option></select></Field>
        <div className="sm:col-span-2"><Field label="版本说明"><textarea required rows={3} maxLength={2000} value={form.summary} onChange={e => update('summary', e.target.value)} className="field" /></Field></div>
        <Field label="完成内容（每行一项）"><textarea rows={6} value={form.highlights} onChange={e => update('highlights', e.target.value)} className="field" /></Field>
        <Field label="实现与交接重点（每行一项）"><textarea rows={6} value={form.implementationNotes} onChange={e => update('implementationNotes', e.target.value)} className="field" /></Field>
        <Field label="限制与维护提醒（每行一项）"><textarea rows={5} value={form.limitations} onChange={e => update('limitations', e.target.value)} className="field" /></Field>
        <div className="space-y-4"><Field label="开发时间范围"><input maxLength={100} value={form.deploymentRange} onChange={e => update('deploymentRange', e.target.value)} placeholder="2026-09-01 至 2026-09-10" className="field" /></Field><Field label="记录依据"><input maxLength={300} value={form.sourceNote} onChange={e => update('sourceNote', e.target.value)} placeholder="Git 提交与部署记录" className="field" /></Field></div>
      </div>
      <div className="mt-5 flex gap-2"><button disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{saving ? '保存中…' : '保存版本'}</button><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">取消</button></div>
      <style jsx>{`.field { margin-top: .375rem; width: 100%; border-radius: .5rem; border: 1px solid rgb(203 213 225); padding: .625rem .75rem; font-weight: 400; color: rgb(15 23 42); outline: none; } .field:focus { border-color: rgb(16 185 129); box-shadow: 0 0 0 2px rgb(209 250 229); }`}</style>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700">{label}{children}</label>
}
