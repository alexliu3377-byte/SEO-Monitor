'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'

type FeedbackRole = 'normal' | 'admin' | 'super'
type FeedbackScope = 'mine' | 'routine' | 'super'
type FeedbackStatus = 'pending' | 'accepted' | 'researching' | 'trial' | 'in_progress' | 'completed' | 'blocked' | 'declined'
type FeedbackType = 'bug' | 'usability' | 'data' | 'performance' | 'feature' | 'optimization' | 'other'
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
  created_at: string
}
type FeedbackMessage = {
  id: string
  author_name: string
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

export default function FeedbackClient({ initialRole }: { initialRole: FeedbackRole }) {
  const [scope, setScope] = useState<FeedbackScope>(initialRole === 'normal' ? 'mine' : 'routine')
  const [viewerRole, setViewerRole] = useState<FeedbackRole>(initialRole)
  const [items, setItems] = useState<Feedback[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [canManage, setCanManage] = useState(false)
  const [limits, setLimits] = useState<{ daily: number | null; open: number | null }>({ daily: null, open: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [feedbackType, setFeedbackType] = useState<FeedbackType | ''>('')
  const [relatedPage, setRelatedPage] = useState<FeedbackPage | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [status, setStatus] = useState<FeedbackStatus>('pending')
  const [ownerResponse, setOwnerResponse] = useState('')
  const [problemDetails, setProblemDetails] = useState('')
  const [saving, setSaving] = useState(false)
  const [discussionId, setDiscussionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<FeedbackMessage[]>([])
  const [messagePage, setMessagePage] = useState(1)
  const [messageTotal, setMessageTotal] = useState(0)
  const [messageLoading, setMessageLoading] = useState(false)
  const [messageError, setMessageError] = useState('')
  const [messageType, setMessageType] = useState<FeedbackMessageType>('discussion')
  const [messageContent, setMessageContent] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)

  const load = useCallback(async (targetScope: FeedbackScope, targetPage: number) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/feedback?scope=${targetScope}&page=${targetPage}&pageSize=${PAGE_SIZE}`, { cache: 'no-store' })
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

  useEffect(() => { void load(scope, page) }, [load, page, scope])

  function changeScope(next: FeedbackScope) {
    setEditingId(null)
    setDiscussionId(null)
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
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : '沟通记录加载失败')
    } finally {
      setMessageLoading(false)
    }
  }

  async function toggleDiscussion(requestId: string) {
    if (discussionId === requestId) {
      setDiscussionId(null)
      return
    }
    setDiscussionId(requestId)
    setMessagePage(1)
    setMessageContent('')
    await loadMessages(requestId, 1)
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
      setMessagePage(1)
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
    setMessage('')
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, details, feedbackType, relatedPage }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '反馈提交失败')
      setTitle('')
      setDetails('')
      setFeedbackType('')
      setRelatedPage('')
      setMessage(viewerRole === 'super' ? '重点反馈已提交，并归入“超管重点”。' : '反馈已提交，你可以在这里查看处理进度。')
      const targetScope: FeedbackScope = viewerRole === 'super' ? 'super' : scope
      if (scope !== targetScope) changeScope(targetScope)
      else if (page !== 1) setPage(1)
      else await load(targetScope, 1)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '反馈提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  function startEdit(item: Feedback) {
    setEditingId(item.id)
    setStatus(item.status)
    setOwnerResponse(item.owner_response ?? '')
    setProblemDetails(item.problem_details ?? '')
  }

  async function save() {
    if (!editingId) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(`/api/feedback/${editingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ownerResponse, problemDetails }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '处理状态更新失败')
      setItems(previous => previous.map(item => item.id === editingId ? body.request : item))
      setEditingId(null)
      setMessage('反馈处理状态已更新。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '处理状态更新失败')
    } finally {
      setSaving(false)
    }
  }

  const audienceText = viewerRole === 'normal'
    ? '这里只显示你自己提交的反馈和处理进度。'
    : viewerRole === 'admin'
      ? '这里显示组员和组长提交的日常反馈；超管重点不会出现在此列表。'
      : '日常反馈与超管提出的重点功能分开处理。'
  const limitText = limits.daily === null
    ? '超管反馈会进入“超管重点”，但仍请写清使用场景和希望结果。'
    : `每天最多提交 ${limits.daily} 条，同时最多保留 ${limits.open} 条未完成反馈。`

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">需求与问题跟进</p><h1 className="mt-1 text-2xl font-bold text-slate-950">反馈优化</h1><p className="mt-1 text-sm leading-6 text-slate-600">提交实际使用中遇到的问题或功能建议，并持续查看评估和处理进度。</p></div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {viewerRole === 'super' && (
          <div role="tablist" aria-label="反馈分类" className="flex border-b border-slate-200">
            <button type="button" role="tab" aria-selected={scope === 'routine'} onClick={() => changeScope('routine')} className={`border-b-2 px-4 py-3 text-sm font-medium ${scope === 'routine' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500'}`}>日常反馈</button>
            <button type="button" role="tab" aria-selected={scope === 'super'} onClick={() => changeScope('super')} className={`border-b-2 px-4 py-3 text-sm font-medium ${scope === 'super' ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500'}`}>超管重点</button>
          </div>
        )}

        {message && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}
        <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">提交反馈</h2>
          <p className="mt-1 text-sm text-slate-500">{audienceText} {limitText}</p>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">反馈类型<select required value={feedbackType} onChange={event => setFeedbackType(event.target.value as FeedbackType | '')} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"><option value="" disabled>请选择反馈类型</option>{Object.entries(TYPE).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
              <label className="text-sm font-medium text-slate-700">相关页面（可选）<select value={relatedPage} onChange={event => setRelatedPage(event.target.value as FeedbackPage | '')} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"><option value="">无特定页面 / 全局</option>{Object.entries(PAGE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            <label className="text-sm font-medium text-slate-700">标题<input required minLength={4} maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="简要说明要解决的问题" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
            <label className="text-sm font-medium text-slate-700">具体说明<textarea required minLength={20} maxLength={4000} rows={4} value={details} onChange={event => setDetails(event.target.value)} placeholder="请写明：谁在什么情况下使用、现在有什么问题、希望最终得到什么结果（至少 20 个字）" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
          </div>
          <button disabled={submitting} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">{submitting ? '正在提交…' : '提交反馈'}</button>
        </form>

        {!loading && !error && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">当前列表共 {total} 条，每次只读取本页 {PAGE_SIZE} 条。</div>}
        {loading && <div className="space-y-3"><div className="h-32 animate-pulse rounded-xl bg-slate-200" /><div className="h-32 animate-pulse rounded-xl bg-slate-200" /></div>}
        {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><p>{error}</p><button type="button" onClick={() => void load(scope, page)} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2">重试</button></div>}
        {!loading && !error && items.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="font-medium text-slate-800">当前没有反馈</p><p className="mt-1 text-sm text-slate-500">提交后会在这里看到待评估、开发中或已完成状态。</p></div>}

        {!loading && !error && items.map(item => {
          const itemStatus = STATUS[item.status]
          const role = ROLE[item.submitter_role]
          const type = TYPE[item.feedback_type] ?? TYPE.other
          const editing = editingId === item.id
          return (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${itemStatus.className}`}>{itemStatus.label}</span><span className={`rounded-full px-2 py-1 text-xs font-medium ${type.className}`}>{type.label}</span>{item.related_page && <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">{PAGE[item.related_page] ?? item.related_page}</span>}<span className={`rounded-full px-2 py-1 text-xs font-medium ${role.className}`}>{role.label}</span><span className="text-xs text-slate-400">{item.created_by_name} · {dateTime(item.created_at)}</span></div><h2 className="mt-3 font-semibold text-slate-950">{item.title}</h2></div>
                {canManage && !editing && <button type="button" onClick={() => startEdit(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">更新进度</button>}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.details}</p>
              {item.owner_response && <div className="mt-4 rounded-lg bg-blue-50 p-4"><p className="text-xs font-semibold text-blue-800">负责人回复</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-blue-900">{item.owner_response}</p></div>}
              {item.problem_details && <div className="mt-4 rounded-lg bg-red-50 p-4"><p className="text-xs font-semibold text-red-800">问题详情</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-red-900">{item.problem_details}</p></div>}
              {viewerRole === 'super' && scope === 'super' && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <button type="button" onClick={() => void toggleDiscussion(item.id)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">{discussionId === item.id ? '收起沟通' : '展开沟通与调研'}</button>
                </div>
              )}
              {discussionId === item.id && viewerRole === 'super' && scope === 'super' && (
                <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4" aria-label={`${item.title}的超管沟通记录`}>
                  <div><h3 className="font-semibold text-slate-900">超管沟通记录</h3><p className="mt-1 text-xs leading-5 text-slate-500">可以粘贴 ChatGPT 调研摘要、外部平台资料、试行观察和最后结论。请勿粘贴账号密码、Cookie 或密钥。</p></div>
                  {messageLoading && <div className="mt-4 h-20 animate-pulse rounded-lg bg-indigo-100" />}
                  {!messageLoading && messageError && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{messageError}</div>}
                  {!messageLoading && !messageError && messages.length === 0 && <p className="mt-4 rounded-lg bg-white p-4 text-sm text-slate-500">还没有沟通记录，可以先贴上现有调研资料。</p>}
                  {!messageLoading && !messageError && messages.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {messages.map(message => {
                        const messageMeta = MESSAGE_TYPE[message.message_type]
                        return <article key={message.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${messageMeta.className}`}>{messageMeta.label}</span><span className="text-xs text-slate-500">{message.author_name} · {dateTime(message.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.content}</p></article>
                      })}
                      {messageTotal > 20 && <div className="flex items-center justify-between text-xs text-slate-500"><span>第 {messagePage} / {Math.ceil(messageTotal / 20)} 页，共 {messageTotal} 条</span><div className="flex gap-2"><button type="button" disabled={messagePage >= Math.ceil(messageTotal / 20)} onClick={() => void loadMessages(item.id, messagePage + 1)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 disabled:opacity-40">更早记录</button><button type="button" disabled={messagePage <= 1} onClick={() => void loadMessages(item.id, messagePage - 1)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 disabled:opacity-40">更新记录</button></div></div>}
                    </div>
                  )}
                  <form onSubmit={sendMessage} className="mt-4 space-y-3 border-t border-indigo-100 pt-4">
                    <div className="grid gap-3 sm:grid-cols-[180px_1fr]"><label className="text-sm font-medium text-slate-700">记录类型<select value={messageType} onChange={event => setMessageType(event.target.value as FeedbackMessageType)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal">{Object.entries(MESSAGE_TYPE).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label className="text-sm font-medium text-slate-700">沟通内容<textarea required minLength={2} maxLength={10000} rows={5} value={messageContent} onChange={event => setMessageContent(event.target.value)} placeholder="例如：目前调研到小红书没有稳定公开搜索接口；可以先尝试……" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label></div>
                    <button disabled={sendingMessage} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{sendingMessage ? '发送中…' : '加入沟通记录'}</button>
                  </form>
                </section>
              )}
              {editing && canManage && <div className="mt-5 space-y-4 border-t border-slate-100 pt-5"><label className="block text-sm font-medium text-slate-700">处理状态<select value={status} onChange={event => setStatus(event.target.value as FeedbackStatus)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal sm:max-w-xs">{Object.entries(STATUS).map(([value, statusItem]) => <option key={value} value={value}>{statusItem.label}</option>)}</select></label><label className="block text-sm font-medium text-slate-700">负责人回复<textarea rows={3} value={ownerResponse} onChange={event => setOwnerResponse(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="block text-sm font-medium text-slate-700">问题详情<textarea rows={3} value={problemDetails} onChange={event => setProblemDetails(event.target.value)} placeholder="遇到外部限制或暂时无法实现时说明原因" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{saving ? '保存中…' : '保存'}</button><button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">取消</button></div></div>}
            </article>
          )
        })}
        {!loading && !error && <Pagination page={page} total={total} onChange={setPage} />}
      </main>
    </div>
  )
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (total <= PAGE_SIZE) return null
  return <nav aria-label="反馈分页" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-sm text-slate-500">第 {page} / {pages} 页 · 共 {total} 条</p><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">上一页</button><button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">下一页</button></div></nav>
}
