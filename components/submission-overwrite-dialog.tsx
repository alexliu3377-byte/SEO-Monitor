'use client'

import { PageNumberInput } from '@/components/page-number-input'

import { useEffect, useId, useRef, useState } from 'react'
import AppDialog from './app-dialog'
import { OVERWRITE_PAGE_SIZE, validateOverwriteUrl, type OverwriteCandidate, type SubmissionOverwriteHistory } from '@/lib/submission-overwrite'

type Lookup = { rows: OverwriteCandidate[]; total: number; actorName: string }
type Saved = {
  keyword: string; pageUrl: string; username: string; submitDate: string
  volume: number; volumeMatched: boolean; cacheReady: boolean; message: string
}

// Match the report's adjacent controls on desktop. Global coarse-pointer
// rules still enlarge touch targets; no product-wide button style is changed.
const buttonBase = 'inline-flex items-center justify-center whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton = `${buttonBase} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`
const primaryButton = `${buttonBase} border-green-600 bg-green-600 text-white hover:border-green-700 hover:bg-green-700`

function localDate(value: string | null) {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll('-', '/')
  const stamp = Date.parse(value)
  if (!Number.isFinite(stamp)) return '—'
  return new Date(stamp + 8 * 3600000).toISOString().slice(0, 16).replaceAll('-', '/').replace('T', ' ')
}

async function read<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? '处理失败，请稍后重试')
  return data
}

export default function SubmissionOverwriteDialog({ groupId, groupName, onClose, onSaved }: {
  groupId: string; groupName: string; onClose: () => void; onSaved: () => void
}) {
  const id = useId()
  const endpoint = `/api/task-groups/${encodeURIComponent(groupId)}/submission-overwrite`
  const [url, setUrl] = useState('')
  const [lookupUrl, setLookupUrl] = useState('')
  const [rows, setRows] = useState<OverwriteCandidate[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<OverwriteCandidate | null>(null)
  const [keyword, setKeyword] = useState('')
  const [actorName, setActorName] = useState('当前登录人员')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Saved | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<SubmissionOverwriteHistory[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const request = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const successPanel = useRef<HTMLDivElement>(null)
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; request.current?.abort() }
  }, [])

  useEffect(() => { if (saved) successPanel.current?.focus() }, [saved])

  useEffect(() => {
    if (!showHistory || !selected) return
    const controller = new AbortController()
    setHistoryLoading(true)
    setHistoryError('')
    fetch(`${endpoint}?${new URLSearchParams({ claimId: selected.id, page: String(historyPage) })}`, { signal: controller.signal })
      .then(response => read<{ rows: SubmissionOverwriteHistory[]; total: number }>(response))
      .then(data => { if (!controller.signal.aborted) { setHistory(data.rows); setHistoryTotal(data.total) } })
      .catch(reason => { if (!controller.signal.aborted) setHistoryError((reason as Error).message) })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [endpoint, selected, showHistory, historyPage])

  function close() {
    if (saving) return
    if (selected && keyword.trim() && !saved && !window.confirm('尚未覆盖，关闭会丢弃当前输入。确定关闭吗？')) return
    onClose()
  }

  async function lookup(targetPage = 0, input = url) {
    let validUrl: string
    try { validUrl = validateOverwriteUrl(input) } catch (reason) { setError((reason as Error).message); return }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError(''); setSaved(null); setSelected(null); setConfirmed(false)
    setRows([]); setHistory([]); setShowHistory(false); setHistoryPage(0)
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ url: validUrl, page: String(targetPage) })}`, { signal: controller.signal })
      const data = await read<Lookup>(response)
      if (controller.signal.aborted) return
      setRows(data.rows); setTotal(data.total); setActorName(data.actorName || '当前登录人员')
      setLookupUrl(validUrl); setPage(targetPage); setSearched(true)
    } catch (reason) {
      if (!controller.signal.aborted) setError((reason as Error).message)
    } finally { if (!controller.signal.aborted && alive.current) setLoading(false) }
  }

  async function overwrite() {
    if (!selected || saving || !confirmed) return
    setSaving(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: selected.id, version: selected.version, keyword }),
      })
      const data = await read<Saved>(response)
      if (!alive.current) return
      setSaved(data); setSelected(null); setRows([]); setConfirmed(false); setShowHistory(false)
      if (data.cacheReady) onSaved()
    } catch (reason) { if (alive.current) setError((reason as Error).message) }
    finally { if (alive.current) setSaving(false) }
  }

  const pages = Math.max(1, Math.ceil(total / OVERWRITE_PAGE_SIZE))
  const historyPages = Math.max(1, Math.ceil(historyTotal / OVERWRITE_PAGE_SIZE))
  return (
    <AppDialog title="覆盖已提交内容" description={`${groupName} · 只查当前分组全部成员的已提交记录，不改变普通报告的查看权限。`}
      onClose={close} closeOnBackdrop={!saving} width="max-w-3xl" bodyClassName="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6"
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryButton} disabled={saving} onClick={close}>{saved ? '完成' : '取消'}</button>
        {!saved && <button type="button" className={primaryButton} disabled={saving || loading || !selected || !keyword.trim() || keyword.trim().length > 200 || !confirmed}
          onClick={() => void overwrite()}>{saving ? '覆盖并同步中…' : '确认覆盖'}</button>}
      </div>}>
      <form onSubmit={event => { event.preventDefault(); void lookup() }} className="space-y-2">
        <label htmlFor={`${id}-url`} className="block text-sm font-medium text-gray-800">查找页面链接</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id={`${id}-url`} type="text" inputMode="url" autoComplete="off" value={url} maxLength={2048} disabled={loading || saving}
            placeholder="粘贴已提交的完整 URL" onChange={event => setUrl(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <button type="submit" className={secondaryButton} disabled={loading || saving || !url.trim()}>{loading ? '查找中…' : '查找'}</button>
        </div>
        <p className="text-xs leading-5 text-gray-500">同一链接可能有多条提交，请选中要覆盖的一条；其它记录不会自动覆盖。</p>
      </form>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved ? <div ref={successPanel} tabIndex={-1} role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900 outline-none">
        <p className="font-medium">{saved.message}</p>
        <p className="mt-2 break-words">{saved.keyword} · {saved.username} · {localDate(saved.submitDate)}</p>
        <p className="mt-1">搜索量：{saved.volumeMatched ? saved.volume.toLocaleString() : '未匹配到，已清除旧词搜索量'}</p>
        <p className="mt-1 break-all">{saved.pageUrl}</p>
        {!saved.cacheReady && <button type="button" className={`${secondaryButton} mt-3`} onClick={() => { onSaved(); onClose() }}>刷新报告</button>}
      </div> : <>
        {loading && <p role="status" className="py-6 text-center text-sm text-gray-500">正在查找已提交的记录…</p>}
        {!loading && searched && rows.length === 0 && !error && <p role="status" className="py-6 text-center text-sm text-gray-500">当前分组没有这个链接的已提交记录，请核对链接。</p>}
        {rows.length > 0 && <fieldset disabled={saving} className="mt-4 min-w-0">
          <legend className="mb-2 text-sm font-medium text-gray-800">选择原提交 · {total} 条</legend>
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {rows.map(row => <label key={row.id} className={`flex cursor-pointer items-start gap-3 p-3 ${selected?.id === row.id ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
              <input type="radio" name={`${id}-record`} checked={selected?.id === row.id} className="mt-1 accent-green-600"
                onChange={() => { setSelected(row); setKeyword(''); setConfirmed(false); setShowHistory(false); setHistoryPage(0); setHistory([]) }} />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block break-words font-medium text-gray-900">{row.final_keyword || row.keyword}</span>
                <span className="mt-1 block text-xs leading-5 text-gray-600">关键词：{row.keyword} · {row.username} · {localDate(row.submitted_at || row.claimed_date)} · {row.source || '—'} · {row.operation_type || '—'}</span>
                <span className="block break-all text-xs leading-5 text-gray-500">{row.page_url}</span>
              </span>
            </label>)}
          </div>
          {pages > 1 && <div className="mt-3 flex items-center justify-end gap-3 text-xs text-gray-600">
            <button type="button" className={secondaryButton} disabled={loading || page === 0} onClick={() => void lookup(page - 1, lookupUrl)}>上一页</button>
            <span className="inline-flex items-center gap-1"><PageNumberInput page={page + 1} totalPages={pages} disabled={loading} onChange={next => void lookup(next - 1,lookupUrl)} /> / {pages}</span>
            <button type="button" className={secondaryButton} disabled={loading || page + 1 >= pages} onClick={() => void lookup(page + 1, lookupUrl)}>下一页</button>
          </div>}
        </fieldset>}
        {selected && <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
          <label htmlFor={`${id}-keyword`} className="block text-sm font-medium text-gray-800">覆盖词（关键词与最终词统一替换）</label>
          <input id={`${id}-keyword`} type="text" value={keyword} maxLength={200} disabled={saving}
            onChange={event => { setKeyword(event.target.value); setConfirmed(false) }}
            placeholder="输入这次实际做的词" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <div className="text-xs leading-6 text-gray-600">
            <p>原链接不变；原分组不变；操作类型改为“覆盖”。</p>
            <p>提交日期：{localDate(today)} · 成员：{actorName} · 来源：手动添加</p>
            <p>搜索量按覆盖词重新匹配；未匹配到时不沿用旧词数值。旧名称、成员和提交日期保留在覆盖历史中。</p>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            <input type="checkbox" checked={confirmed} disabled={saving || !keyword.trim()} onChange={event => setConfirmed(event.target.checked)} className="mt-1 accent-green-600" />
            <span>确认把选中记录覆盖为“{keyword.trim() || '覆盖词'}”，并将提交归到我的名下和今天日期。</span>
          </label>
          <button type="button" className={secondaryButton} disabled={saving} onClick={() => setShowHistory(value => !value)} aria-expanded={showHistory}>覆盖历史</button>
          {showHistory && <div className="text-xs leading-5 text-gray-600">
            {historyLoading ? <p role="status">历史加载中…</p> : historyError ? <p role="alert" className="text-red-700">{historyError}</p> : history.length === 0 ? <p>暂无覆盖历史。</p> : <ol className="space-y-3">
              {history.map(row => <li key={row.id} className="border-l-2 border-gray-200 pl-3">
                <p className="break-words text-gray-800">{row.old_final_keyword || row.old_keyword} → {row.new_keyword}</p>
                {row.old_final_keyword !== row.old_keyword && <p>原关键词：{row.old_keyword}</p>}
                <p>原成员：{row.old_username} · 原提交：{localDate(row.old_submitted_at)}</p>
                <p>操作人：{row.actor_name} · 覆盖时间：{localDate(row.overwritten_at)}</p>
              </li>)}
            </ol>}
            {historyPages > 1 && <div className="mt-3 flex items-center gap-3">
              <button type="button" className={secondaryButton} disabled={historyLoading || historyPage === 0} onClick={() => setHistoryPage(value => value - 1)}>上一页</button>
              <span className="inline-flex items-center gap-1"><PageNumberInput page={historyPage + 1} totalPages={historyPages} disabled={historyLoading} onChange={next => setHistoryPage(next - 1)} /> / {historyPages}</span>
              <button type="button" className={secondaryButton} disabled={historyLoading || historyPage + 1 >= historyPages} onClick={() => setHistoryPage(value => value + 1)}>下一页</button>
            </div>}
          </div>}
        </div>}
      </>}
    </AppDialog>
  )
}
