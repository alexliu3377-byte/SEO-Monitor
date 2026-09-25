'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  TREND_QUERY_LIMITS,
  type TrendPlatform,
  type TrendQueryPlatform,
  type TrendReviewStatus,
  type TrendStage,
} from '@/lib/trend-discovery'
import TrendKeywordDiscovery from './trend-keyword-discovery'

type Role = 'normal' | 'admin' | 'super'

type TrendTerm = {
  id: string
  display_term: string
  trend_stage: TrendStage
  review_status: TrendReviewStatus
  first_seen_at: string
  last_seen_at: string
  platforms: TrendPlatform[]
  signal_count: number
  recent_signal_count: number
  previous_signal_count: number
  growth_percent: number | null
  trend_score: number
  confidence_score: number
  explanation: string | null
  suggested_keywords: string[]
}

type CollectorNode = {
  id: string
  name: string
  collector_version: string
  platforms: TrendPlatform[]
  status: 'online' | 'offline' | 'blocked' | 'error'
  last_seen_at: string | null
  last_success_at: string | null
  last_error: string | null
}

type TrendSource = {
  observed_at: string
  trend_signals: {
    id: string
    platform: TrendPlatform
    source_url: string
    title: string
    excerpt: string | null
    tags: string[]
    query_terms: string[]
    published_at: string | null
    first_collected_at: string
    last_collected_at: string
    latest_metrics: Record<string, number>
  }
}

type TrendQueryDrafts = Record<TrendQueryPlatform, string>

const PLATFORM_LABELS: Record<TrendPlatform, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  xiaoheihe: '小黑盒',
}

const STAGE_META: Record<TrendStage, { label: string; className: string }> = {
  new: { label: '今日新词', className: 'bg-sky-50 text-sky-700 border-sky-100' },
  warming: { label: '快速升温', className: 'bg-orange-50 text-orange-700 border-orange-100' },
  hot: { label: '正在热门', className: 'bg-rose-50 text-rose-700 border-rose-100' },
  persistent: { label: '持续出现', className: 'bg-violet-50 text-violet-700 border-violet-100' },
  cooling: { label: '热度放缓', className: 'bg-slate-50 text-slate-600 border-slate-200' },
}

const TABS: { key: 'pending' | 'tracked'; label: string }[] = [
  { key: 'pending', label: '待处理' },
  { key: 'tracked', label: '已布局' },
]

function formatDate(value: string | null, withTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  const day = `${part('year')}-${part('month')}-${part('day')}`
  return withTime ? `${day} ${part('hour')}:${part('minute')}` : day
}

function relativeTime(value: string | null) {
  if (!value) return '尚未运行'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`
  return `${Math.floor(minutes / 1_440)} 天前`
}

function trendScoreBreakdown(term: TrendTerm) {
  const firstSeen = new Date(term.first_seen_at).getTime()
  const lastSeen = new Date(term.last_seen_at).getTime()
  const ageHours = Math.max(0, (Date.now() - firstSeen) / 3_600_000)
  const durationDays = Math.max(0, (lastSeen - firstSeen) / 86_400_000)
  const freshness = ageHours <= 24 ? 20 : ageHours <= 72 ? 12 : ageHours <= 168 ? 6 : 0
  const crossPlatform = term.platforms.length >= 3 ? 30 : term.platforms.length === 2 ? 22 : 8
  const momentum = term.previous_signal_count === 0
    ? term.recent_signal_count >= 5 ? 25 : term.recent_signal_count >= 2 ? 18 : term.recent_signal_count === 1 ? 8 : 0
    : term.recent_signal_count > term.previous_signal_count
      ? Math.min(25, 8 + (term.recent_signal_count - term.previous_signal_count) * 4)
      : 0
  const evidence = Math.min(15, term.signal_count * 3)
  const persistence = durationDays >= 7 ? 10 : durationDays >= 3 ? 6 : 0
  const rawTotal = freshness + crossPlatform + momentum + evidence + persistence
  return {
    items: [
      { label: '新鲜度', points: freshness, detail: ageHours <= 24 ? '首次出现不超过 24 小时' : ageHours <= 72 ? '首次出现不超过 3 天' : ageHours <= 168 ? '首次出现不超过 7 天' : '首次出现已超过 7 天' },
      { label: '跨平台', points: crossPlatform, detail: `${term.platforms.length} 个平台出现` },
      { label: '近期动能', points: momentum, detail: `近24小时 ${term.recent_signal_count} 份；前24小时 ${term.previous_signal_count} 份` },
      { label: '独立资料', points: evidence, detail: `${term.signal_count} 份去重资料，每份 3 分，上限 15 分` },
      { label: '持续时间', points: persistence, detail: durationDays >= 1 ? `跨越约 ${Math.floor(durationDays)} 天` : '尚未跨日持续' },
    ],
    rawTotal,
    calculatedTotal: Math.min(100, Math.max(0, rawTotal)),
    confidenceFormula: Math.min(100, term.signal_count * 8 + term.platforms.length * 15),
  }
}

function NodeStatus({ node }: { node: CollectorNode }) {
  const meta = node.status === 'online'
    ? { dot: 'bg-emerald-500', label: '运行正常' }
    : node.status === 'blocked'
      ? { dot: 'bg-amber-500', label: '需要验证' }
      : node.status === 'error'
        ? { dot: 'bg-red-500', label: '运行异常' }
        : { dot: 'bg-slate-300', label: '已离线' }
  return (
    <div className="min-w-[230px] rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 flex-none rounded-full ${meta.dot}`} />
            <p className="truncate text-sm font-semibold text-slate-800">{node.name}</p>
          </div>
          <p className="mt-1 truncate text-xs text-slate-400">
            {node.platforms.map(platform => PLATFORM_LABELS[platform]).join('、') || '尚未分配平台'} · {node.collector_version}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-slate-600">{meta.label}</p>
          <p className="mt-1 text-[11px] text-slate-400">{relativeTime(node.last_seen_at)}</p>
        </div>
      </div>
      {node.last_error && node.status !== 'online' && (
        <p className="mt-2 line-clamp-1 text-xs text-red-500" title={node.last_error}>{node.last_error}</p>
      )}
    </div>
  )
}

export default function TrendDiscoveryClient({ initialRole }: { initialRole: Role }) {
  const [workspaceTab, setWorkspaceTab] = useState<'trends' | 'keywords'>('trends')
  const [activeTab, setActiveTab] = useState<'pending' | 'tracked'>('pending')
  const [stage, setStage] = useState<TrendStage | ''>('')
  const [platform, setPlatform] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [terms, setTerms] = useState<TrendTerm[]>([])
  const [nodes, setNodes] = useState<CollectorNode[]>([])
  const [total, setTotal] = useState(0)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<TrendTerm | null>(null)
  const [sources, setSources] = useState<TrendSource[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedTermIds, setSelectedTermIds] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [queryDrafts, setQueryDrafts] = useState<TrendQueryDrafts>({ xiaohongshu: '', douyin: '' })

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const selectedScore = selected ? trendScoreBreakdown(selected) : null

  const loadTerms = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    params.set('review', activeTab)
    if (stage) params.set('stage', stage)
    if (platform) params.set('platform', platform)
    if (search) params.set('q', search)
    try {
      const response = await fetch(`/api/trend-discovery?${params}`, { signal, cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '趋势资料读取失败')
      setTerms(data.terms ?? [])
      setSelectedTermIds(new Set())
      setNodes(data.nodes ?? [])
      setTotal(data.total ?? 0)
      setCanManage(Boolean(data.canManage))
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') setError((loadError as Error).message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [activeTab, page, platform, search, stage])

  useEffect(() => {
    const controller = new AbortController()
    loadTerms(controller.signal)
    return () => controller.abort()
  }, [loadTerms])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  async function openDetail(term: TrendTerm) {
    setSelected(term)
    setSources([])
    setDetailLoading(true)
    try {
      const response = await fetch(`/api/trend-discovery/${term.id}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '趋势详情读取失败')
      setSelected(data.term)
      setSources(data.sources ?? [])
    } catch (detailError) {
      setError((detailError as Error).message)
      setSelected(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function updateReviewStatus(reviewStatus: TrendReviewStatus) {
    if (!selected) return
    await updateTermStatuses([selected.id], reviewStatus)
  }

  async function updateTermStatuses(ids: string[], reviewStatus: TrendReviewStatus) {
    if (ids.length === 0) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/trend-discovery/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, reviewStatus }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '候选词处理失败')
      setSelected(current => current && ids.includes(current.id) ? { ...current, review_status: reviewStatus } : current)
      setSelectedTermIds(new Set())
      await loadTerms()
      if (reviewStatus === 'dismissed' && selected && ids.includes(selected.id)) setSelected(null)
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function toggleTerm(id: string) {
    setSelectedTermIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllTerms() {
    setSelectedTermIds(terms.length > 0 && terms.every(term => selectedTermIds.has(term.id))
      ? new Set()
      : new Set(terms.map(term => term.id)))
  }

  async function openSettings() {
    setSettingsOpen(true)
    setSettingsLoading(true)
    setSettingsError('')
    setSettingsSaved(false)
    try {
      const response = await fetch('/api/trend-discovery/settings', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '采集词设置读取失败')
      setQueryDrafts({
        xiaohongshu: (data.platforms?.xiaohongshu ?? []).join('\n'),
        douyin: (data.platforms?.douyin ?? []).join('\n'),
      })
    } catch (settingsLoadError) {
      setSettingsError((settingsLoadError as Error).message)
    } finally {
      setSettingsLoading(false)
    }
  }

  function queryLines(platformName: TrendQueryPlatform) {
    return queryDrafts[platformName]
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean)
  }

  async function saveSettings() {
    setSettingsSaving(true)
    setSettingsError('')
    setSettingsSaved(false)
    try {
      const response = await fetch('/api/trend-discovery/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platforms: {
            xiaohongshu: queryLines('xiaohongshu'),
            douyin: queryLines('douyin'),
          },
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '采集词设置保存失败')
      setQueryDrafts({
        xiaohongshu: (data.platforms?.xiaohongshu ?? []).join('\n'),
        douyin: (data.platforms?.douyin ?? []).join('\n'),
      })
      setSettingsSaved(true)
    } catch (settingsSaveError) {
      setSettingsError((settingsSaveError as Error).message)
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">趋势发现</h1>
            <p className="mt-1.5 text-sm text-slate-500">从公开社媒内容中发现正在形成的新词。</p>
          </div>
          {canManage && (
            <button type="button" onClick={openSettings} className="inline-flex h-9 flex-none items-center gap-2 rounded-lg border border-slate-200 bg-transparent px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M10 18h4" /></svg>
              设置采集词
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8">
        <div className="mb-5 flex gap-6 border-b border-slate-200">
          <button type="button" onClick={() => setWorkspaceTab('trends')} className={`relative h-11 px-1 text-sm font-semibold transition ${workspaceTab === 'trends' ? 'text-emerald-700 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-emerald-600' : 'text-slate-500 hover:text-slate-800'}`}>趋势词</button>
          <button type="button" onClick={() => setWorkspaceTab('keywords')} className={`relative h-11 px-1 text-sm font-semibold transition ${workspaceTab === 'keywords' ? 'text-emerald-700 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-emerald-600' : 'text-slate-500 hover:text-slate-800'}`}>新词发现</button>
        </div>

        {workspaceTab === 'trends' ? <>
        {initialRole === 'super' && (
          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">采集状态</h2>
              <span className="text-xs text-slate-400">节点只保存公开信号，不保存账号凭据</span>
            </div>
            {nodes.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {nodes.map(node => <NodeStatus key={node.id} node={node} />)}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-4 text-sm text-slate-500">
                尚未收到采集节点资料。数据库迁移和本机采集器配置完成后，这里会显示运行状态。
              </div>
            )}
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 pt-2 sm:px-6">
            <div className="flex gap-6 overflow-x-auto">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setActiveTab(tab.key); setPage(1) }}
                  className={`relative min-h-12 flex-none whitespace-nowrap text-sm font-medium transition-colors ${activeTab === tab.key ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {tab.label}
                  {activeTab === tab.key && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-emerald-600" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="relative w-full sm:max-w-sm">
              <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></svg>
              <input
                value={searchInput}
                onChange={event => setSearchInput(event.target.value)}
                placeholder="搜索候选词"
                className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <select value={stage} onChange={event => { setStage(event.target.value as TrendStage | ''); setPage(1) }} className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:flex-none">
                <option value="">全部阶段</option>
                <option value="new">今日新词</option>
                <option value="warming">快速升温</option>
                <option value="hot">正在热门</option>
                <option value="persistent">持续出现</option>
                <option value="cooling">热度放缓</option>
              </select>
              <select
                value={platform}
                onChange={event => { setPlatform(event.target.value); setPage(1) }}
                className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:flex-none"
              >
                <option value="">全部平台</option>
                <option value="xiaohongshu">小红书</option>
                <option value="douyin">抖音</option>
                <option value="xiaoheihe">小黑盒</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="m-4 flex items-center justify-between gap-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 sm:m-6">
              <span>{error}</span>
              <button type="button" className="font-medium underline" onClick={() => loadTerms()}>重试</button>
            </div>
          )}

          {canManage && (
            <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2 sm:px-6">
              <span className="text-xs text-slate-500">已选择 <strong className="text-slate-800">{selectedTermIds.size}</strong> 个候选词</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={saving || selectedTermIds.size === 0} onClick={() => updateTermStatuses([...selectedTermIds], 'tracked')} className="h-8 rounded-md border border-emerald-300 bg-transparent px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">批量已布局</button>
                <button type="button" disabled={saving || selectedTermIds.size === 0} onClick={() => updateTermStatuses([...selectedTermIds], 'dismissed')} className="h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">批量忽略</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full table-fixed">
              <thead className="bg-slate-50/80">
                <tr className="text-left text-xs font-medium text-slate-500">
                  <th className="w-12 px-4 py-2.5"><input type="checkbox" aria-label="全选当前页" checked={terms.length > 0 && terms.every(term => selectedTermIds.has(term.id))} onChange={toggleAllTerms} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></th>
                  <th className="px-3 py-2.5">候选新词</th>
                  <th className="w-20 px-3 py-2.5"><span title="新鲜度 + 跨平台 + 近期动能 + 独立资料 + 持续时间，最高100分" className="cursor-help border-b border-dotted border-slate-400">趋势分</span></th>
                  <th className="w-28 px-3 py-2.5">阶段</th>
                  <th className="w-52 px-3 py-2.5">来源信号</th>
                  <th className="w-40 px-3 py-2.5">首次发现</th>
                  <th className="w-56 px-4 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index} className="animate-pulse">
                      <td colSpan={7} className="px-4 py-3"><div className="h-4 w-full rounded bg-slate-100" /></td>
                    </tr>
                  ))
                ) : terms.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-20 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 17 9 11l4 4 8-9M15 6h6v6" /></svg>
                      </div>
                      <p className="mt-4 text-sm font-medium text-slate-700">目前没有符合条件的趋势词</p>
                      <p className="mt-1 text-xs text-slate-400">采集器送回第一批公开信号后，候选词会自动出现在这里。</p>
                    </td>
                  </tr>
                ) : terms.map(term => {
                  const stage = STAGE_META[term.trend_stage]
                  return (
                    <tr key={term.id} className={`group hover:bg-emerald-50/30 ${selectedTermIds.has(term.id) ? 'bg-emerald-50/50' : ''}`}>
                      <td className="px-4 py-2.5"><input type="checkbox" aria-label={`选择${term.display_term}`} checked={selectedTermIds.has(term.id)} onChange={() => toggleTerm(term.id)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></td>
                      <td className="px-3 py-2.5">
                        <button type="button" onClick={() => openDetail(term)} className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 group-hover:text-emerald-700">{term.display_term}</button>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-sm font-bold tabular-nums ${term.trend_score >= 70 ? 'text-rose-600' : term.trend_score >= 45 ? 'text-orange-600' : 'text-slate-700'}`}>{term.trend_score}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${stage.className}`}>{stage.label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                          {term.platforms.map(item => <span key={item} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{PLATFORM_LABELS[item]}</span>)}
                          <span className="text-xs text-slate-400">{term.signal_count} 份</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-600">
                        {formatDate(term.first_seen_at, true)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openDetail(term)} className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">查看</button>
                          {canManage && <button type="button" disabled={saving || term.review_status === 'tracked'} onClick={() => updateTermStatuses([term.id], 'tracked')} className="h-8 rounded-md border border-emerald-300 bg-transparent px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">已布局</button>}
                          {canManage && <button type="button" disabled={saving} onClick={() => updateTermStatuses([term.id], 'dismissed')} className="h-8 rounded-md border border-red-200 bg-transparent px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">忽略</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
              <span>共 {total} 个候选词</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="h-9 rounded-lg border border-slate-200 px-3 disabled:opacity-40">上一页</button>
                <span className="px-1 tabular-nums">{page} / {totalPages}</span>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))} className="h-9 rounded-lg border border-slate-200 px-3 disabled:opacity-40">下一页</button>
              </div>
            </div>
          )}
        </section>
        </> : <TrendKeywordDiscovery />}
      </main>

      {settingsOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="trend-settings-title" onMouseDown={event => { if (event.currentTarget === event.target && !settingsSaving) setSettingsOpen(false) }}>
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <h2 id="trend-settings-title" className="text-xl font-bold text-slate-950">设置采集词</h2>
                <p className="mt-1 text-sm text-slate-500">每行一个搜索入口词，下次运行本机采集器时自动使用。</p>
              </div>
              <button type="button" aria-label="关闭" disabled={settingsSaving} onClick={() => setSettingsOpen(false)} className="flex h-10 w-10 flex-none items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeWidth={2} d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>

            <div className="overflow-y-auto bg-slate-50/70 px-5 py-5 sm:px-6">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm leading-6 text-emerald-900">
                这里设置的是平台搜索词，例如“新手游”或“效率工具”。系统会从搜索结果中继续发现游戏名、APP 名和新表达。
              </div>

              {settingsLoading ? (
                <div className="py-16 text-center text-sm text-slate-400">正在读取采集词…</div>
              ) : (
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  {(['xiaohongshu', 'douyin'] as TrendQueryPlatform[]).map(platformName => {
                    const count = queryLines(platformName).length
                    const limit = TREND_QUERY_LIMITS[platformName]
                    return (
                      <label key={platformName} className="block">
                        <span className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800">
                          <span>{PLATFORM_LABELS[platformName]}</span>
                          <span className={count > limit || count < 1 ? 'text-red-500' : 'text-slate-400'}>{count} / {limit}</span>
                        </span>
                        <textarea
                          value={queryDrafts[platformName]}
                          onChange={event => {
                            setQueryDrafts(current => ({ ...current, [platformName]: event.target.value }))
                            setSettingsSaved(false)
                          }}
                          rows={9}
                          maxLength={5000}
                          placeholder={platformName === 'xiaohongshu' ? '新手游\n宝藏APP\n效率工具' : '新游戏\n宝藏游戏\n新APP'}
                          className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-7 text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                        />
                        <span className="mt-1.5 block text-xs text-slate-400">每个词 2–40 个字符，顺序就是采集顺序。</span>
                      </label>
                    )
                  })}
                </div>
              )}

              {settingsError && <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{settingsError}</p>}
              {settingsSaved && <p className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">已保存。本机采集器下次运行时会自动读取这些词。</p>}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
              <button type="button" disabled={settingsSaving} onClick={() => setSettingsOpen(false)} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">关闭</button>
              <button type="button" disabled={settingsLoading || settingsSaving} onClick={saveSettings} className="h-10 rounded-lg border border-emerald-300 bg-transparent px-4 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                {settingsSaving ? '保存中…' : '保存设置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="trend-detail-title" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}>
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="trend-detail-title" className="truncate text-xl font-bold text-slate-950">{selected.display_term}</h2>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STAGE_META[selected.trend_stage].className}`}>{STAGE_META[selected.trend_stage].label}</span>
                </div>
                <p className="mt-1 text-sm text-slate-400">首次发现 {formatDate(selected.first_seen_at, true)} · 最近更新 {formatDate(selected.last_seen_at, true)}</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setSelected(null)} className="flex h-10 w-10 flex-none items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeWidth={2} d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-5 sm:px-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['趋势分', selected.trend_score],
                  ['可信度', `${selected.confidence_score}%`],
                  ['独立资料', selected.signal_count],
                  ['近24小时', selected.recent_signal_count],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>

              {selectedScore && (
                <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div><h3 className="text-sm font-semibold text-slate-900">趋势分怎么算</h3><p className="mt-1 text-xs leading-5 text-slate-500">只使用公开社媒信号；SEO 排名和搜索量暂不计入。各项相加后最高为 100 分。</p></div>
                    <div className="flex-none text-right"><p className="text-xs text-slate-400">当前保存分数</p><p className="text-2xl font-bold text-slate-900">{selected.trend_score}</p></div>
                  </div>
                  <div className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
                    {selectedScore.items.map(item => <div key={item.label} className="flex items-center justify-between gap-4 py-2.5"><div className="min-w-0"><p className="text-sm font-medium text-slate-700">{item.label}</p><p className="truncate text-xs text-slate-400" title={item.detail}>{item.detail}</p></div><span className={`flex-none text-sm font-bold tabular-nums ${item.points > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>+{item.points}</span></div>)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-500">项目合计 {selectedScore.rawTotal} 分{selectedScore.rawTotal > 100 ? '，按上限计 100 分' : ''}</span><span className="font-semibold text-slate-700">按当前资料重算：{selectedScore.calculatedTotal} 分</span></div>
                  {selectedScore.calculatedTotal !== selected.trend_score && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">保存分数来自最近一次采集刷新；新鲜度会随时间变化，下次采集后会按同一规则更新。</p>}
                  <p className="mt-3 text-xs leading-5 text-slate-400">可信度：独立资料 {selected.signal_count} × 8，加上平台数 {selected.platforms.length} × 15，最高 100；当前按公式为 {selectedScore.confidenceFormula}%。</p>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">相关公开内容</h3>
                <span className="text-xs text-slate-400">最多显示最近30条</span>
              </div>
              <div className="mt-3 space-y-2.5">
                {detailLoading ? (
                  <div className="py-12 text-center text-sm text-slate-400">正在读取来源…</div>
                ) : sources.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">没有可显示的来源内容</div>
                ) : sources.map(source => {
                  const signal = source.trend_signals
                  return (
                    <a key={`${signal.id}-${source.observed_at}`} href={signal.source_url} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-emerald-300 hover:bg-emerald-50/30">
                      <div className="flex items-start justify-between gap-4">
                        <p className="line-clamp-2 text-sm font-medium leading-6 text-slate-800">{signal.title}</p>
                        <span className="flex-none rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">{PLATFORM_LABELS[signal.platform]}</span>
                      </div>
                      {signal.excerpt && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{signal.excerpt}</p>}
                      <p className="mt-2 text-[11px] text-slate-400">
                        {signal.query_terms.length > 0 ? `由“${signal.query_terms[0]}”发现 · ` : ''}{formatDate(signal.published_at || signal.first_collected_at, true)}
                      </p>
                    </a>
                  )
                })}
              </div>
            </div>

            {canManage && (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
                <button type="button" disabled={saving || selected.review_status === 'tracked'} onClick={() => updateReviewStatus('tracked')} className="h-10 rounded-lg border border-emerald-300 bg-transparent px-4 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                  {selected.review_status === 'tracked' ? '已加入布局观察' : saving ? '处理中…' : '标记为已布局'}
                </button>
                <button type="button" disabled={saving} onClick={() => updateReviewStatus('dismissed')} className="h-10 rounded-lg border border-red-200 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">忽略这个词</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
