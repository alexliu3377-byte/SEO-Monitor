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
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
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
    setSavingId(item.id)
    setError('')
    try {
      const response = await fetch('/api/trend-discovery/suggestions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, platforms: item.platforms }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '新词处理失败')
      await loadSuggestions()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setSavingId('')
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-lg font-bold text-slate-900">搜索平台正在推荐的新词</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">来自“相关搜索”和“大家都在搜”。这些只是采集线索，不参与趋势评分；加入采集后抓到真实内容才会进入趋势词。</p>
          </div>
          <div className="flex flex-none items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> 等待接入平台提取规则
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

      <div className="overflow-x-auto">
        <table className="min-w-[960px] w-full table-fixed">
          <thead className="bg-slate-50/80 text-left text-xs font-medium text-slate-500">
            <tr><th className="w-52 px-5 py-3">新词</th><th className="w-44 px-4 py-3">发现位置</th><th className="px-4 py-3">由哪些搜索发现</th><th className="w-32 px-4 py-3">独立入口</th><th className="w-36 px-4 py-3">最近发现</th><th className="w-44 px-4 py-3 text-right">处理</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? Array.from({ length: 5 }).map((_, index) => <tr key={index} className="animate-pulse"><td colSpan={6} className="px-5 py-5"><div className="h-4 w-full rounded bg-slate-100" /></td></tr>) : suggestions.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-20 text-center"><p className="text-sm font-medium text-slate-700">目前没有{status === 'pending' ? '待处理的' : status === 'added' ? '已加入的' : '已忽略的'}新词</p><p className="mt-1 text-xs text-slate-400">接入平台提取规则后，搜索推荐会自动出现在这里。</p></td></tr>
            ) : suggestions.map(item => (
              <tr key={item.id} className="hover:bg-emerald-50/30">
                <td className="px-5 py-4"><p className="truncate text-sm font-semibold text-slate-900">{item.displayTerm}</p><p className="mt-1 text-[11px] text-slate-400">首次 {formatDate(item.firstSeenAt)}</p></td>
                <td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{item.platforms.map(value => <span key={value} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{PLATFORM_LABELS[value]}</span>)}</div><p className="mt-1.5 text-[11px] text-slate-400">{item.sourceKinds.includes('everyone_search') ? '大家都在搜' : '相关搜索'}</p></td>
                <td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{item.seedQueries.map(value => <span key={value} className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">{value}</span>)}</div></td>
                <td className="px-4 py-4 text-sm text-slate-700">{item.observationCount} 个</td>
                <td className="px-4 py-4 text-sm text-slate-600">{formatDate(item.lastSeenAt)}</td>
                <td className="px-4 py-4"><div className="flex justify-end gap-2">{canManage && status === 'pending' && <><button disabled={savingId === item.id} onClick={() => updateSuggestion(item, 'ignore')} className="h-9 rounded-lg px-3 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">忽略</button><button disabled={savingId === item.id} onClick={() => updateSuggestion(item, 'add')} className="h-9 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">加入采集词</button></>}{canManage && status === 'ignored' && <button disabled={savingId === item.id} onClick={() => updateSuggestion(item, 'restore')} className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50">恢复</button>}{status === 'added' && <span className="text-xs text-emerald-700">已加入 {item.addedPlatforms.map(value => PLATFORM_LABELS[value]).join('、')}</span>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && totalPages > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-sm text-slate-500"><span>共 {total} 个新词</span><div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="h-9 rounded-lg border border-slate-200 px-3 disabled:opacity-40">上一页</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))} className="h-9 rounded-lg border border-slate-200 px-3 disabled:opacity-40">下一页</button></div></div>}
    </section>
  )
}
