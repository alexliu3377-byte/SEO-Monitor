'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TrendQueryPlatform } from '@/lib/trend-discovery'

type SuggestionStatus = 'pending' | 'added' | 'ignored'
type Suggestion = {
  id: string
  displayTerm: string
  reviewStatus: SuggestionStatus
  addedPlatforms: TrendQueryPlatform[]
  firstSeenAt: string
  lastSeenAt: string
  platforms: TrendQueryPlatform[]
  sourceKinds: Array<'related_search' | 'everyone_search'>
  seedQueries: string[]
  observationCount: number
}

const PLATFORM_LABELS: Record<TrendQueryPlatform, string> = { xiaohongshu: '小红书', douyin: '抖音' }
const STATUS_TABS: Array<{ key: SuggestionStatus; label: string }> = [
  { key: 'pending', label: '待处理' },
  { key: 'added', label: '已加入采集' },
  { key: 'ignored', label: '已忽略' },
]

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

export default function TrendKeywordDiscovery() {
  const [status, setStatus] = useState<SuggestionStatus>('pending')
  const [platform, setPlatform] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [counts, setCounts] = useState<Record<SuggestionStatus, number>>({ pending: 0, added: 0, ignored: 0 })
  const [total, setTotal] = useState(0)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null)
  const [error, setError] = useState('')
  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const loadSuggestions = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) })
    if (platform) params.set('platform', platform)
    if (search) params.set('q', search)
    try {
      const response = await fetch(`/api/trend-discovery/suggestions?${params}`, { signal, cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '新词线索读取失败')
      setSuggestions(data.suggestions ?? [])
      setSelectedIds(new Set())
      setCounts(data.counts ?? { pending: 0, added: 0, ignored: 0 })
      setTotal(data.total ?? 0)
      setCanManage(Boolean(data.canManage))
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') setError((loadError as Error).message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [page, platform, search, status])

  useEffect(() => {
    const controller = new AbortController()
    loadSuggestions(controller.signal)
    return () => controller.abort()
  }, [loadSuggestions])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  async function updateSuggestion(item: Suggestion, action: 'add' | 'ignore' | 'restore') {
    await updateSuggestions([item.id], action, action === 'add' ? item.platforms : undefined)
  }

  async function updateSuggestions(ids: string[], action: 'add' | 'ignore' | 'restore', platforms?: TrendQueryPlatform[]) {
    if (ids.length === 0) return
    setSavingId(ids.length === 1 ? ids[0] : 'bulk')
    setError('')
    try {
      const response = await fetch('/api/trend-discovery/suggestions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, platforms }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '新词处理失败')
      setSelectedIds(new Set())
      await loadSuggestions()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setSavingId('')
    }
  }

  function toggleSuggestion(id: string) {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllSuggestions() {
    setSelectedIds(suggestions.length > 0 && suggestions.every(item => selectedIds.has(item.id))
      ? new Set()
      : new Set(suggestions.map(item => item.id)))
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-lg font-bold text-slate-900">搜索平台正在推荐的新词</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">来自“相关搜索”和“大家都在搜”。这些只是采集线索，不参与趋势评分；加入采集后抓到真实内容才会进入趋势词。</p>
          </div>
          <div className="flex flex-none items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> 平台推荐词自动采集中
          </div>
        </div>
      </div>

      <div className="border-b border-slate-100 px-4 pt-2 sm:px-6">
        <div className="flex gap-6 overflow-x-auto">
          {STATUS_TABS.map(tab => (
            <button key={tab.key} type="button" onClick={() => { setStatus(tab.key); setPage(1) }} className={`relative min-h-12 flex-none text-sm font-medium ${status === tab.key ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}>
              {tab.label}<span className="ml-1.5 text-xs text-slate-400">{counts[tab.key]}</span>
              {status === tab.key && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-emerald-600" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="relative w-full sm:max-w-sm">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></svg>
          <input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="搜索新词线索" className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
        </div>
        <select value={platform} onChange={event => { setPlatform(event.target.value); setPage(1) }} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
          <option value="">全部平台</option>
          <option value="xiaohongshu">小红书</option>
          <option value="douyin">抖音</option>
        </select>
      </div>

      {error && <div className="m-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 sm:m-6">{error}</div>}

      {canManage && (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2 sm:px-6">
          <span className="text-xs text-slate-500">已选择 <strong className="text-slate-800">{selectedIds.size}</strong> 个新词</span>
          <div className="flex items-center gap-2">
            {status === 'pending' && <button type="button" disabled={Boolean(savingId) || selectedIds.size === 0} onClick={() => updateSuggestions([...selectedIds], 'add')} className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">批量加入采集</button>}
            {status !== 'ignored' && <button type="button" disabled={Boolean(savingId) || selectedIds.size === 0} onClick={() => updateSuggestions([...selectedIds], 'ignore')} className="h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">批量忽略</button>}
            {status === 'ignored' && <button type="button" disabled={Boolean(savingId) || selectedIds.size === 0} onClick={() => updateSuggestions([...selectedIds], 'restore')} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-40">批量恢复</button>}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-[1080px] w-full table-fixed">
          <thead className="bg-slate-50/80 text-left text-xs font-medium text-slate-500">
            <tr><th className="w-12 px-4 py-2.5"><input type="checkbox" aria-label="全选当前页" checked={suggestions.length > 0 && suggestions.every(item => selectedIds.has(item.id))} onChange={toggleAllSuggestions} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></th><th className="w-56 px-3 py-2.5">候选新词</th><th className="w-52 px-3 py-2.5">发现位置</th><th className="px-3 py-2.5">由哪些搜索发现</th><th className="w-24 px-3 py-2.5">入口</th><th className="w-40 px-3 py-2.5">最近发现</th><th className="w-48 px-4 py-2.5 text-right">操作</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? Array.from({ length: 5 }).map((_, index) => <tr key={index} className="animate-pulse"><td colSpan={7} className="px-4 py-3"><div className="h-4 w-full rounded bg-slate-100" /></td></tr>) : suggestions.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-20 text-center"><p className="text-sm font-medium text-slate-700">目前没有{status === 'pending' ? '待处理的' : status === 'added' ? '已加入的' : '已忽略的'}新词</p><p className="mt-1 text-xs text-slate-400">采集到新的平台推荐词后会自动出现在这里。</p></td></tr>
            ) : suggestions.map(item => (
              <tr key={item.id} className={`hover:bg-emerald-50/30 ${selectedIds.has(item.id) ? 'bg-emerald-50/50' : ''}`}>
                <td className="px-4 py-2.5"><input type="checkbox" aria-label={`选择${item.displayTerm}`} checked={selectedIds.has(item.id)} onChange={() => toggleSuggestion(item.id)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></td>
                <td className="px-3 py-2.5"><p className="truncate text-sm font-semibold text-slate-900">{item.displayTerm}</p></td>
                <td className="px-3 py-2.5"><div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">{item.platforms.map(value => <span key={value} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{PLATFORM_LABELS[value]}</span>)}<span className="truncate text-xs text-slate-400">{item.sourceKinds.includes('everyone_search') ? '大家都在搜' : '相关搜索'}</span></div></td>
                <td className="truncate px-3 py-2.5 text-xs text-slate-600" title={item.seedQueries.join('、')}>{item.seedQueries.join('、') || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-slate-700">{item.observationCount} 个</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-600">{formatDate(item.lastSeenAt)}</td>
                <td className="px-4 py-2.5"><div className="flex justify-end gap-1.5"><button type="button" onClick={() => setSelectedSuggestion(item)} className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50">查看</button>{canManage && status === 'pending' && <><button disabled={Boolean(savingId)} onClick={() => updateSuggestion(item, 'add')} className="h-8 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">加入采集</button><button disabled={Boolean(savingId)} onClick={() => updateSuggestion(item, 'ignore')} className="h-8 rounded-lg border border-red-200 bg-white px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">忽略</button></>}{canManage && status === 'ignored' && <button disabled={Boolean(savingId)} onClick={() => updateSuggestion(item, 'restore')} className="h-8 rounded-lg border border-emerald-200 bg-white px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">恢复</button>}{status === 'added' && <span className="self-center truncate text-xs font-medium text-emerald-700">已加入 {item.addedPlatforms.map(value => PLATFORM_LABELS[value]).join('、')}</span>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && totalPages > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-sm text-slate-500"><span>共 {total} 个新词</span><div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="h-9 rounded-lg border border-slate-200 px-3 disabled:opacity-40">上一页</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))} className="h-9 rounded-lg border border-slate-200 px-3 disabled:opacity-40">下一页</button></div></div>}

      {selectedSuggestion && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="新词详情" onMouseDown={event => { if (event.currentTarget === event.target) setSelectedSuggestion(null) }}>
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div><p className="text-xs font-medium text-emerald-700">新词发现</p><h3 className="mt-1 text-lg font-bold text-slate-950">{selectedSuggestion.displayTerm}</h3><p className="mt-1 text-xs text-slate-400">首次发现 {formatDate(selectedSuggestion.firstSeenAt)}</p></div>
              <button type="button" aria-label="关闭" onClick={() => setSelectedSuggestion(null)} className="h-9 w-9 rounded-lg text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
            </div>
            <div className="space-y-4 overflow-y-auto bg-slate-50/70 px-5 py-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-400">出现入口</p><p className="mt-1 text-lg font-bold text-slate-900">{selectedSuggestion.observationCount}</p></div>
                <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-400">来源平台</p><p className="mt-1 text-lg font-bold text-slate-900">{selectedSuggestion.platforms.length}</p></div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 sm:col-span-2"><p className="text-xs text-slate-400">最近发现</p><p className="mt-1 text-sm font-semibold text-slate-900">{formatDate(selectedSuggestion.lastSeenAt)}</p></div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold text-slate-500">发现位置</p>
                <div className="mt-2 flex flex-wrap gap-2">{selectedSuggestion.platforms.map(value => <span key={value} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700">{PLATFORM_LABELS[value]}</span>)}<span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">{selectedSuggestion.sourceKinds.includes('everyone_search') ? '大家都在搜' : '相关搜索'}</span></div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold text-slate-500">由这些搜索词发现</p><div className="mt-2 flex flex-wrap gap-2">{selectedSuggestion.seedQueries.map(value => <span key={value} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">{value}</span>)}</div></div>
            </div>
            {canManage && selectedSuggestion.reviewStatus === 'pending' && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4"><button type="button" disabled={Boolean(savingId)} onClick={async () => { await updateSuggestion(selectedSuggestion, 'add'); setSelectedSuggestion(null) }} className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">加入采集</button><button type="button" disabled={Boolean(savingId)} onClick={async () => { await updateSuggestion(selectedSuggestion, 'ignore'); setSelectedSuggestion(null) }} className="h-10 rounded-lg border border-red-200 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">忽略</button></div>}
          </div>
        </div>
      )}
    </section>
  )
}
