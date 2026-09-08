'use client'

import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type FeedbackRole = 'normal' | 'admin' | 'super'
type FeedbackScope = 'board' | 'mine' | 'super'
type FeedbackStatus = 'pending' | 'accepted' | 'researching' | 'trial' | 'in_progress' | 'completed' | 'blocked' | 'declined'
type FeedbackType = 'bug' | 'usability' | 'data' | 'performance' | 'feature' | 'optimization' | 'site_submission' | 'other'
type FeedbackPage = 'home' | 'charts' | 'task-groups' | 'group-report' | 'research' | 'hot-keywords' | 'site-intel' | 'weight-monitor' | 'index-monitor' | 'competitor-daily' | 'index-pages' | 'sites' | 'crawl-log' | 'development-log' | 'settings' | 'feedback'
type FeedbackMessageType = 'discussion' | 'research' | 'experiment' | 'decision'
type Feedback = {
  id: string
  title: string
  details: string
  status: FeedbackStatus
  problem_details: string | null
  owner_response: string | null
  created_by_name: string
  submitter_role: FeedbackRole
  feedback_type: FeedbackType
  related_page: FeedbackPage | null
  submitted_site: string | null
  created_at: string
  message_count: number
  latest_message_at: string | null
  has_unread: boolean
}
type FeedbackMessage = {
  id: string
  author_name: string
  author_role: FeedbackRole
  message_type: FeedbackMessageType
  content: string
  created_at: string
}

const PAGE_SIZE = 10
const STATUS: Record<FeedbackStatus, { label: string; className: string }> = {
  pending: { label: '待评估', className: 'bg-slate-100 text-slate-700 ring-slate-200' },
  accepted: { label: '已接受', className: 'bg-violet-50 text-violet-700 ring-violet-200' },
  researching: { label: '调研中', className: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  trial: { label: '试行中', className: 'bg-cyan-50 text-cyan-700 ring-cyan-200' },
  in_progress: { label: '开发中', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  completed: { label: '已完成', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  blocked: { label: '遇到问题', className: 'bg-red-50 text-red-700 ring-red-200' },
  declined: { label: '暂不处理', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
}
const ROLE: Record<FeedbackRole, { label: string; className: string }> = {
  normal: { label: '组员', className: 'bg-slate-100 text-slate-600' },
  admin: { label: '组长', className: 'bg-blue-50 text-blue-700' },
  super: { label: '超管', className: 'bg-amber-50 text-amber-800' },
}
const TYPE: Record<FeedbackType, { label: string; className: string }> = {
  bug: { label: '功能异常', className: 'bg-red-50 text-red-700' },
  usability: { label: '交互不方便', className: 'bg-orange-50 text-orange-700' },
  data: { label: '数据问题', className: 'bg-purple-50 text-purple-700' },
  performance: { label: '加载缓慢', className: 'bg-cyan-50 text-cyan-700' },
  feature: { label: '新功能建议', className: 'bg-emerald-50 text-emerald-700' },
  optimization: { label: '流程优化', className: 'bg-blue-50 text-blue-700' },
  site_submission: { label: '站点提交', className: 'bg-lime-50 text-lime-700' },
  other: { label: '其他', className: 'bg-slate-100 text-slate-600' },
}
const PAGE: Record<FeedbackPage, string> = {
  home: '首页快报', charts: '近期榜单', 'task-groups': '任务工作台', 'group-report': '成效报告',
  research: '研究中心', 'hot-keywords': '热词雷达', 'site-intel': '站点情报', 'weight-monitor': '权重监控',
  'index-monitor': '收录监控', 'competitor-daily': '竞品日收', 'index-pages': '收录页面', sites: '网站管理',
  'crawl-log': '抓取日志', 'development-log': '开发日志', settings: '账户设置', feedback: '反馈优化',
}
const MESSAGE_TYPE: Record<FeedbackMessageType, { label: string; className: string }> = {
  discussion: { label: '普通讨论', className: 'bg-slate-100 text-slate-700' },
  research: { label: '调研资料', className: 'bg-indigo-50 text-indigo-700' },
  experiment: { label: '试行结果', className: 'bg-cyan-50 text-cyan-700' },
  decision: { label: '决策结论', className: 'bg-emerald-50 text-emerald-700' },
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur', hour12: false,
  }).format(new Date(value))
}

function Modal({ title, description, onClose, children, width = 'max-w-3xl' }: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <header className="flex shrink-0 items-start gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1"><h2 className="text-lg font-bold text-slate-950">{title}</h2>{description && <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>}</div>
          <button type="button" onClick={onClose} aria-label="关闭弹窗" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5 sm:p-6">{children}</div>
      </section>
    </div>,
    document.body
  )
}

export default function FeedbackClient({ initialRole }: { initialRole: FeedbackRole }) {
  const [scope, setScope] = useState<FeedbackScope>('board')
  const [viewerRole, setViewerRole] = useState<FeedbackRole>(initialRole)
  const [items, setItems] = useState<Feedback[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [canManage, setCanManage] = useState(false)
  const [limits, setLimits] = useState<{ daily: number | null; open: number | null }>({ daily: null, open: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('')
  const [typeFilter, setTypeFilter] = useState<FeedbackType | ''>('')

  const [submitOpen, setSubmitOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [feedbackType, setFeedbackType] = useState<FeedbackType | ''>('')
  const [relatedPage, setRelatedPage] = useState<FeedbackPage | ''>('')
  const [submittedSite, setSubmittedSite] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [status, setStatus] = useState<FeedbackStatus>('pending')
  const [ownerResponse, setOwnerResponse] = useState('')
  const [problemDetails, setProblemDetails] = useState('')
  const [saving, setSaving] = useState(false)
  const [progressError, setProgressError] = useState('')

  const [discussionId, setDiscussionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<FeedbackMessage[]>([])
  const [messagePage, setMessagePage] = useState(1)
  const [messageTotal, setMessageTotal] = useState(0)
  const [messageLoading, setMessageLoading] = useState(false)
  const [messageError, setMessageError] = useState('')
  const [messageType, setMessageType] = useState<FeedbackMessageType>('discussion')
  const [messageContent, setMessageContent] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [canReply, setCanReply] = useState(false)
  const [priorityDiscussion, setPriorityDiscussion] = useState(false)

  const load = useCallback(async (targetScope: FeedbackScope, targetPage: number, targetStatus: FeedbackStatus | '', targetType: FeedbackType | '') => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ scope: targetScope, page: String(targetPage), pageSize: String(PAGE_SIZE) })
      if (targetStatus) params.set('status', targetStatus)
      if (targetType) params.set('type', targetType)
      const response = await fetch(`/api/feedback?${params}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '反馈加载失败')
      setItems(body.requests ?? [])
      setTotal(body.total ?? 0)
      setScope(body.scope ?? targetScope)
      setViewerRole(body.viewerRole)
      setCanManage(Boolean(body.canManage))
      setLimits(body.limits ?? { daily: null, open: null })
    } catch (err) {
      setError(err instanceof Error ? err.message : '反馈加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(scope, page, statusFilter, typeFilter) }, [load, page, scope, statusFilter, typeFilter])

  function changeScope(next: FeedbackScope) {
    setDiscussionId(null)
    setEditingId(null)
    setPage(1)
    setScope(next)
  }

  async function loadMessages(requestId: string, targetPage: number) {
    setMessageLoading(true)
    setMessageError('')
    try {
      const response = await fetch(`/api/feedback/${requestId}/messages?page=${targetPage}&pageSize=20`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '沟通记录加载失败')
      setMessages(body.messages ?? [])
      setMessageTotal(body.total ?? 0)
      setMessagePage(body.page ?? targetPage)
      setCanReply(Boolean(body.canReply))
      setPriorityDiscussion(Boolean(body.priority))
      if (targetPage === 1) setItems(previous => previous.map(item => item.id === requestId ? { ...item, has_unread: false } : item))
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : '沟通记录加载失败')
    } finally {
      setMessageLoading(false)
    }
  }

  async function openDiscussion(requestId: string) {
    setDiscussionId(requestId)
    setMessagePage(1)
    setMessageContent('')
    setCanReply(false)
    await loadMessages(requestId, 1)
  }

  function closeDiscussion() {
    setDiscussionId(null)
    setMessages([])
    void load(scope, page, statusFilter, typeFilter)
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!discussionId) return
    setSendingMessage(true)
    setMessageError('')
    try {
      const response = await fetch(`/api/feedback/${discussionId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageType, content: messageContent }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '沟通内容发送失败')
      setMessageContent('')
      await loadMessages(discussionId, 1)
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : '沟通内容发送失败')
    } finally {
      setSendingMessage(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setFormError('')
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, details, feedbackType, relatedPage, submittedSite }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '反馈提交失败')
      setTitle('')
      setDetails('')
      setFeedbackType('')
      setRelatedPage('')
      setSubmittedSite('')
      setSubmitOpen(false)
      setNotice(viewerRole === 'super' ? '重点反馈已提交，并归入“超管重点”。' : '反馈已提交，可以在列表中查看处理进度。')
      const targetScope: FeedbackScope = viewerRole === 'super' ? 'super' : 'board'
      setStatusFilter('')
      setTypeFilter('')
      setPage(1)
      setScope(targetScope)
      await load(targetScope, 1, '', '')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '反馈提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  function startEdit(item: Feedback) {
    setEditingId(item.id)
    setStatus(item.status)
    setOwnerResponse(item.owner_response ?? '')
    setProblemDetails(item.problem_details ?? '')
    setProgressError('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editingId) return
    setSaving(true)
    setProgressError('')
    try {
      const response = await fetch(`/api/feedback/${editingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ownerResponse, problemDetails }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '处理状态更新失败')
      setEditingId(null)
      setNotice('反馈处理状态已更新。')
      await load(scope, page, statusFilter, typeFilter)
    } catch (err) {
      setProgressError(err instanceof Error ? err.message : '处理状态更新失败')
    } finally {
      setSaving(false)
    }
  }

  const discussionItem = items.find(item => item.id === discussionId) ?? null
  const editingItem = items.find(item => item.id === editingId) ?? null
  const audienceText = viewerRole === 'super'
    ? '你的提交会进入“超管重点”，只对超管开放。'
    : '普通反馈会公开展示处理进度，只有你和项目负责人可以继续回复。'
  const limitText = limits.daily === null
    ? '请写清使用场景和希望结果。'
    : `每天最多提交 ${limits.daily} 条，同时最多保留 ${limits.open} 条未完成反馈。`

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">需求与问题跟进</p><h1 className="mt-1 text-2xl font-bold text-slate-950">反馈留言板</h1><p className="mt-1 text-sm leading-6 text-slate-600">集中查看反馈、沟通记录和处理进度。</p></div>
          <button type="button" onClick={() => { setFormError(''); setSubmitOpen(true) }} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"><span className="text-lg leading-none">＋</span>提交反馈</button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 border-b border-slate-200 sm:flex-row sm:items-end sm:justify-between">
          <div role="tablist" aria-label="反馈分类" className="flex overflow-x-auto">
            <button type="button" role="tab" aria-selected={scope === 'board'} onClick={() => changeScope('board')} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium ${scope === 'board' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500'}`}>反馈留言板</button>
            {viewerRole !== 'super' && <button type="button" role="tab" aria-selected={scope === 'mine'} onClick={() => changeScope('mine')} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium ${scope === 'mine' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500'}`}>我的反馈</button>}
            {viewerRole === 'super' && <button type="button" role="tab" aria-selected={scope === 'super'} onClick={() => changeScope('super')} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium ${scope === 'super' ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500'}`}>超管重点</button>}
          </div>
          <div className="flex flex-wrap gap-2 pb-3">
            <select aria-label="按处理状态筛选" value={statusFilter} onChange={event => { setPage(1); setStatusFilter(event.target.value as FeedbackStatus | '') }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"><option value="">全部状态</option>{Object.entries(STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
            <select aria-label="按反馈类型筛选" value={typeFilter} onChange={event => { setPage(1); setTypeFilter(event.target.value as FeedbackType | '') }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"><option value="">全部类型</option>{Object.entries(TYPE).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
          </div>
        </div>

        {notice && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{notice}</div>}
        {loading && <div className="h-72 animate-pulse rounded-xl bg-slate-200" />}
        {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><p>{error}</p><button type="button" onClick={() => void load(scope, page, statusFilter, typeFilter)} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2">重试</button></div>}
        {!loading && !error && items.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="font-medium text-slate-800">当前筛选下没有反馈</p><p className="mt-1 text-sm text-slate-500">可以调整筛选条件，或提交一条新反馈。</p></div>}

        {!loading && !error && items.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-[1080px] w-full border-collapse text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">最近动态</th><th className="px-4 py-3">反馈内容</th><th className="px-4 py-3">分类</th><th className="px-4 py-3">提交人</th><th className="px-4 py-3">状态</th><th className="px-4 py-3 text-center">留言</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map(item => {
                    const itemStatus = STATUS[item.status]
                    const role = ROLE[item.submitter_role]
                    const type = TYPE[item.feedback_type] ?? TYPE.other
                    const activityAt = item.latest_message_at ?? item.created_at
                    return (
                      <tr key={item.id} className={`align-top transition hover:bg-slate-50 ${item.has_unread ? 'bg-amber-50/45' : ''}`}>
                        <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500"><span className="block font-medium text-slate-700">{dateTime(activityAt)}</span><span className="mt-1 block">{item.latest_message_at ? '留言更新' : '提交时间'}</span>{item.has_unread && <span className="mt-2 inline-flex rounded-full bg-amber-500 px-2 py-0.5 font-semibold text-white">新留言</span>}</td>
                        <td className="max-w-md px-4 py-4"><h2 className="font-semibold text-slate-950">{item.title}</h2><p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">{item.details}</p>{item.submitted_site && <a href={`https://${item.submitted_site}`} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-xs font-medium text-lime-700 hover:underline">{item.submitted_site} ↗</a>}</td>
                        <td className="px-4 py-4"><div className="flex max-w-40 flex-wrap gap-1.5"><span className={`rounded-full px-2 py-1 text-xs font-medium ${type.className}`}>{type.label}</span>{item.related_page && <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">{PAGE[item.related_page] ?? item.related_page}</span>}</div></td>
                        <td className="whitespace-nowrap px-4 py-4"><span className="block text-sm font-medium text-slate-800">{item.created_by_name}</span><span className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${role.className}`}>{role.label}</span></td>
                        <td className="whitespace-nowrap px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${itemStatus.className}`}>{itemStatus.label}</span></td>
                        <td className="px-4 py-4 text-center"><button type="button" onClick={() => void openDiscussion(item.id)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${item.has_unread ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}><span>{scope === 'super' ? '沟通' : '留言'}</span><span className="rounded-full bg-white/80 px-1.5 py-0.5 text-xs tabular-nums">{item.message_count ?? 0}</span></button></td>
                        <td className="whitespace-nowrap px-4 py-4 text-right">{canManage ? <button type="button" onClick={() => startEdit(item)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">更新进度</button> : <span className="text-xs text-slate-400">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">未读留言优先显示，其余按反馈提交时间排列 · 共 {total} 条</div>
          </div>
        )}
        {!loading && !error && <Pagination page={page} total={total} onChange={setPage} />}
      </main>

      {submitOpen && (
        <Modal title="提交反馈" description={`${audienceText} ${limitText}`} onClose={() => { if (!submitting) setSubmitOpen(false) }}>
          <form onSubmit={submit} className="space-y-4">
            {formError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">反馈类型<select required value={feedbackType} onChange={event => { const next = event.target.value as FeedbackType | ''; setFeedbackType(next); if (next === 'site_submission') setRelatedPage('sites') }} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-emerald-500"><option value="" disabled>请选择反馈类型</option>{Object.entries(TYPE).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
              <label className="text-sm font-medium text-slate-700">相关页面（可选）<select value={relatedPage} onChange={event => setRelatedPage(event.target.value as FeedbackPage | '')} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-emerald-500"><option value="">无特定页面 / 全局</option>{Object.entries(PAGE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            {feedbackType === 'site_submission' && <label className="block text-sm font-medium text-slate-700">站点域名或网址<input required maxLength={500} value={submittedSite} onChange={event => setSubmittedSite(event.target.value)} placeholder="例如：example.com 或 https://example.com" className="mt-1.5 w-full rounded-lg border border-lime-300 bg-lime-50/40 px-3 py-2.5 font-normal outline-none focus:border-lime-500" /><span className="mt-1.5 block text-xs font-normal text-slate-500">系统会整理成域名，并检查是否已经提交或加入网站管理。</span></label>}
            <label className="block text-sm font-medium text-slate-700">标题<input required minLength={4} maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder={feedbackType === 'site_submission' ? '简要说明为什么建议追踪这个站点' : '简要说明要解决的问题'} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-500" /></label>
            <label className="block text-sm font-medium text-slate-700">具体说明<textarea required minLength={20} maxLength={4000} rows={5} value={details} onChange={event => setDetails(event.target.value)} placeholder={feedbackType === 'site_submission' ? '说明站点与业务的关系、值得追踪的原因，以及希望关注哪些资料（至少 20 个字）' : '写明使用场景、现在的问题和希望得到的结果（至少 20 个字）'} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-500" /></label>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" disabled={submitting} onClick={() => setSubmitOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-40">取消</button><button disabled={submitting} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{submitting ? '正在提交…' : '提交反馈'}</button></div>
          </form>
        </Modal>
      )}

      {discussionItem && (
        <Modal title={priorityDiscussion ? '超管沟通记录' : '反馈留言'} description={discussionItem.title} onClose={closeDiscussion} width="max-w-4xl">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${STATUS[discussionItem.status].className}`}>{STATUS[discussionItem.status].label}</span><span className={`rounded-full px-2 py-1 text-xs font-medium ${TYPE[discussionItem.feedback_type].className}`}>{TYPE[discussionItem.feedback_type].label}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{discussionItem.details}</p>{discussionItem.owner_response && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900"><span className="font-semibold">负责人回复：</span>{discussionItem.owner_response}</div>}{discussionItem.problem_details && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900"><span className="font-semibold">问题详情：</span>{discussionItem.problem_details}</div>}</div>
            <p className="text-xs text-slate-500">{priorityDiscussion ? '可补充调研资料、试行观察和最终决策。' : '留言公开可见，只有反馈人和项目负责人可以回复。'} 请勿粘贴账号密码、Cookie 或密钥。</p>
            {messageLoading && <div className="h-24 animate-pulse rounded-lg bg-indigo-100" />}
            {!messageLoading && messageError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{messageError}</div>}
            {!messageLoading && !messageError && messages.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">还没有留言记录。</p>}
            {!messageLoading && !messageError && messages.length > 0 && <div className="space-y-3">{messages.map(item => { const messageMeta = MESSAGE_TYPE[item.message_type]; const messageRole = ROLE[item.author_role] ?? ROLE.normal; return <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center gap-2">{priorityDiscussion && <span className={`rounded-full px-2 py-1 text-xs font-medium ${messageMeta.className}`}>{messageMeta.label}</span>}<span className={`rounded-full px-2 py-1 text-xs font-medium ${messageRole.className}`}>{messageRole.label}</span><span className="text-xs text-slate-500">{item.author_name} · {dateTime(item.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.content}</p></article>})}</div>}
            {!messageLoading && !messageError && messageTotal > 20 && <div className="flex items-center justify-between text-xs text-slate-500"><span>第 {messagePage} / {Math.ceil(messageTotal / 20)} 页，共 {messageTotal} 条</span><div className="flex gap-2"><button type="button" disabled={messagePage >= Math.ceil(messageTotal / 20)} onClick={() => void loadMessages(discussionItem.id, messagePage + 1)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 disabled:opacity-40">更早记录</button><button type="button" disabled={messagePage <= 1} onClick={() => void loadMessages(discussionItem.id, messagePage - 1)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 disabled:opacity-40">更新记录</button></div></div>}
            {canReply ? <form onSubmit={sendMessage} className="space-y-3 border-t border-slate-200 pt-4"><div className={`grid gap-3 ${priorityDiscussion ? 'sm:grid-cols-[180px_1fr]' : ''}`}>{priorityDiscussion && <label className="text-sm font-medium text-slate-700">记录类型<select value={messageType} onChange={event => setMessageType(event.target.value as FeedbackMessageType)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal">{Object.entries(MESSAGE_TYPE).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>}<label className="text-sm font-medium text-slate-700">{priorityDiscussion ? '沟通内容' : '回复留言'}<textarea required minLength={2} maxLength={10000} rows={4} value={messageContent} onChange={event => setMessageContent(event.target.value)} placeholder={priorityDiscussion ? '补充调研资料、试行结果或决策结论……' : '补充问题情况或回复处理进展……'} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label></div><div className="flex justify-end"><button disabled={sendingMessage} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{sendingMessage ? '发送中…' : priorityDiscussion ? '加入沟通记录' : '发送留言'}</button></div></form> : !messageLoading && !messageError && <p className="border-t border-slate-200 pt-4 text-xs text-slate-500">你可以阅读这段沟通，但只有反馈人和项目负责人可以继续回复。</p>}
          </div>
        </Modal>
      )}

      {editingItem && canManage && (
        <Modal title="更新处理进度" description={editingItem.title} onClose={() => { if (!saving) setEditingId(null) }}>
          <form onSubmit={save} className="space-y-4">
            {progressError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{progressError}</div>}
            <label className="block text-sm font-medium text-slate-700">处理状态<select value={status} onChange={event => setStatus(event.target.value as FeedbackStatus)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal">{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
            <label className="block text-sm font-medium text-slate-700">负责人回复<textarea rows={4} value={ownerResponse} onChange={event => setOwnerResponse(event.target.value)} placeholder="说明已经确认的情况、准备如何处理或完成结果" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-medium text-slate-700">问题详情<textarea rows={4} value={problemDetails} onChange={event => setProblemDetails(event.target.value)} placeholder="遇到外部限制或暂时无法实现时说明原因" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" disabled={saving} onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-40">取消</button><button disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? '保存中…' : '保存进度'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (total <= PAGE_SIZE) return null
  return <nav aria-label="反馈分页" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-sm text-slate-500">第 {page} / {pages} 页 · 共 {total} 条</p><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">上一页</button><button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">下一页</button></div></nav>
}
