'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  TREND_QUERY_LIMITS,
  type TrendPlatform,
  type TrendQueryPlatform,
  type TrendReviewStatus,
  type TrendStage,
} from '@/lib/trend-discovery'

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

type Summary = Record<'new' | 'warming' | 'hot' | 'persistent' | 'tracked', number>
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

const TABS: { key: string; label: string; summaryKey?: keyof Summary; stage?: TrendStage; review?: TrendReviewStatus }[] = [
  { key: 'all', label: '全部候选' },
  { key: 'new', label: '今日新词', summaryKey: 'new', stage: 'new' },
  { key: 'warming', label: '快速升温', summaryKey: 'warming', stage: 'warming' },
  { key: 'hot', label: '正在热门', summaryKey: 'hot', stage: 'hot' },
  { key: 'persistent', label: '持续出现', summaryKey: 'persistent', stage: 'persistent' },
  { key: 'tracked', label: '已布局', summaryKey: 'tracked', review: 'tracked' },
]

function formatDate(value: string | null, withTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date)
}

function relativeTime(value: string | null) {
  if (!value) return '尚未运行'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`
  return `${Math.floor(minutes / 1_440)} 天前`
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
  const [activeTab, setActiveTab] = useState('all')
  const [platform, setPlatform] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [terms, setTerms] = useState<TrendTerm[]>([])
  const [summary, setSummary] = useState<Summary>({ new: 0, warming: 0, hot: 0, persistent: 0, tracked: 0 })
  const [nodes, setNodes] = useState<CollectorNode[]>([])
  const [total, setTotal] = useState(0)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<TrendTerm | null>(null)
  const [sources, setSources] = useState<TrendSource[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [queryDrafts, setQueryDrafts] = useState<TrendQueryDrafts>({ xiaohongshu: '', douyin: '' })

  const selectedTab = useMemo(() => TABS.find(tab => tab.key === activeTab) ?? TABS[0], [activeTab])
  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const loadTerms = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (selectedTab.stage) params.set('stage', selectedTab.stage)
    if (selectedTab.review) params.set('review', selectedTab.review)
    if (platform) params.set('platform', platform)
    if (search) params.set('q', search)
    try {
      const response = await fetch(`/api/trend-discovery?${params}`, { signal, cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '趋势资料读取失败')
      setTerms(data.terms ?? [])
      setSummary(data.summary ?? { new: 0, warming: 0, hot: 0, persistent: 0, tracked: 0 })
      setNodes(data.nodes ?? [])
      setTotal(data.total ?? 0)
      setCanManage(Boolean(data.canManage))
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') setError((loadError as Error).message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [page, platform, search, selectedTab])

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
    setSaving(true)
    try {
      const response = await fetch(`/api/trend-discovery/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '候选词处理失败')
      setSelected(current => current ? { ...current, review_status: reviewStatus } : current)
      await loadTerms()
      if (reviewStatus === 'dismissed') setSelected(null)
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setSaving(false)
    }
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
        <div className="mx-auto flex max-w-[1500px] items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-600">社媒信号 · 内部试行</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">趋势发现</h1>
            <p className="mt-2 text-sm text-slate-500">在百度数据出现以前，从公开社媒内容中发现正在形成的新词。</p>
          </div>
          <div className="flex flex-none items-center gap-4">
            {canManage && (
              <button type="button" onClick={openSettings} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M10 18h4" /></svg>
                设置采集词
              </button>
            )}
            {initialRole === 'super' && (
              <div className="hidden text-right lg:block">
                <p className="text-xs text-slate-400">当前阶段</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">个人电脑低频试行</p>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8">
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
                  {tab.summaryKey && summary[tab.summaryKey] > 0 && (
                    <span className="ml-1.5 text-xs text-slate-400">{summary[tab.summaryKey]}</span>
                  )}
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
            <select
              value={platform}
              onChange={event => { setPlatform(event.target.value); setPage(1) }}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">全部平台</option>
              <option value="xiaohongshu">小红书</option>
              <option value="douyin">抖音</option>
              <option value="xiaoheihe">小黑盒</option>
            </select>
          </div>

          {error && (
            <div className="m-4 flex items-center justify-between gap-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 sm:m-6">
              <span>{error}</span>
              <button type="button" className="font-medium underline" onClick={() => loadTerms()}>重试</button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full table-fixed">
              <thead className="bg-slate-50/80">
                <tr className="text-left text-xs font-medium text-slate-500">
                  <th className="w-24 px-5 py-3">趋势分</th>
                  <th className="px-4 py-3">候选新词</th>
                  <th className="w-36 px-4 py-3">阶段</th>
                  <th className="w-40 px-4 py-3">来源信号</th>
                  <th className="w-32 px-4 py-3">首次发现</th>
                  <th className="w-24 px-4 py-3 text-right">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index} className="animate-pulse">
                      <td className="px-5 py-5"><div className="h-8 w-10 rounded bg-slate-100" /></td>
                      <td className="px-4 py-5"><div className="h-4 w-48 rounded bg-slate-100" /><div className="mt-2 h-3 w-32 rounded bg-slate-100" /></td>
                      <td className="px-4 py-5"><div className="h-7 w-20 rounded-full bg-slate-100" /></td>
                      <td className="px-4 py-5"><div className="h-4 w-24 rounded bg-slate-100" /></td>
                      <td className="px-4 py-5"><div className="h-4 w-16 rounded bg-slate-100" /></td>
                      <td className="px-4 py-5"><div className="h-9 w-14 rounded bg-slate-100" /></td>
                    </tr>
                  ))
                ) : terms.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-20 text-center">
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
                    <tr key={term.id} className="group hover:bg-emerald-50/30">
                      <td className="px-5 py-4">
                        <span className={`text-xl font-bold tabular-nums ${term.trend_score >= 70 ? 'text-rose-600' : term.trend_score >= 45 ? 'text-orange-600' : 'text-slate-700'}`}>{term.trend_score}</span>
                      </td>
                      <td className="px-4 py-4">
                        <button type="button" onClick={() => openDetail(term)} className="block max-w-full text-left">
                          <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-700">{term.display_term}</span>
                          <span className="mt-1 block truncate text-xs text-slate-400">
                            近24小时 {term.recent_signal_count} 条
                            {term.growth_percent !== null && term.growth_percent > 0 ? ` · 较前一天 +${Math.round(term.growth_percent)}%` : ''}
                            {term.review_status === 'tracked' ? ' · 已加入布局观察' : ''}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${stage.className}`}>{stage.label}</span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {term.platforms.map(item => <span key={item} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{PLATFORM_LABELS[item]}</span>)}
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-400">{term.signal_count} 条独立内容</p>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {formatDate(term.first_seen_at, true)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button type="button" onClick={() => openDetail(term)} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:border-emerald-300 hover:text-emerald-700">查看</button>
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

            <div className="overflow-y-auto px-5 py-5 sm:px-6">
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
                          maxLength={500}
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
              <button type="button" disabled={settingsLoading || settingsSaving} onClick={saveSettings} className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
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
                  ['独立内容', selected.signal_count],
                  ['近24小时', selected.recent_signal_count],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>

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
                    <a key={`${signal.id}-${source.observed_at}`} href={signal.source_url} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-200 px-4 py-3 transition hover:border-emerald-300 hover:bg-emerald-50/30">
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
                <button type="button" disabled={saving} onClick={() => updateReviewStatus('dismissed')} className="h-10 rounded-lg px-3 text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">忽略这个词</button>
                <button type="button" disabled={saving || selected.review_status === 'tracked'} onClick={() => updateReviewStatus('tracked')} className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {selected.review_status === 'tracked' ? '已加入布局观察' : saving ? '处理中…' : '标记为已布局'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
