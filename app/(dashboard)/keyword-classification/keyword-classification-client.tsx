'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SimplePagination } from '@/components/simple-pagination'
import {
  APP_SUBCATEGORIES,
  GAME_SUBCATEGORIES,
  KEYWORD_PRIMARY_CATEGORIES,
  subcategoriesFor,
  type KeywordClassificationStatus,
  type KeywordPrimaryCategory,
} from '@/lib/keyword-classification'

type LayoutStatus = 'unassigned' | 'assigned' | 'issue'

type Row = {
  keyword: string
  volume: number
  content_category: KeywordPrimaryCategory | null
  content_subcategory: string | null
  classification_status: KeywordClassificationStatus
  layout_site_domains: string[] | null
  layout_status: LayoutStatus
  layout_issue_note: string | null
}

type SummaryRow = {
  category: string
  subcategory: string | null
  status: KeywordClassificationStatus
  source: 'ai' | 'codex' | 'manual' | null
  keyword_count: number
  total_volume: number
  rising_count: number
}

type SiteGroup = {
  id: string
  name: string
  sites: string[]
}

type Draft = { category: KeywordPrimaryCategory | ''; subcategory: string }
type LayoutFilter = 'all' | 'unassigned' | 'assigned' | 'issue'
type BatchSiteMode = 'add' | 'remove'

const LAYOUT_FILTER_OPTIONS: { value: LayoutFilter; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'unassigned', label: '未布局' },
  { value: 'assigned', label: '已布局' },
  { value: 'issue', label: '有问题' },
]

const SITE_STYLES = [
  { chip: 'border-blue-200 bg-blue-50 text-blue-700', text: '#1d4ed8' },
  { chip: 'border-violet-200 bg-violet-50 text-violet-700', text: '#6d28d9' },
  { chip: 'border-cyan-200 bg-cyan-50 text-cyan-700', text: '#0e7490' },
  { chip: 'border-orange-200 bg-orange-50 text-orange-700', text: '#c2410c' },
  { chip: 'border-pink-200 bg-pink-50 text-pink-700', text: '#be185d' },
  { chip: 'border-teal-200 bg-teal-50 text-teal-700', text: '#0f766e' },
] as const

const CARD_ORDER = ['待分类', ...KEYWORD_PRIMARY_CATEGORIES] as const
const CARD_STYLE: Record<string, string> = {
  待分类: 'border-amber-200 bg-amber-50/60',
  游戏: 'border-violet-200 bg-violet-50/60',
  应用: 'border-blue-200 bg-blue-50/60',
  专题: 'border-pink-200 bg-pink-50/60',
  资讯: 'border-cyan-200 bg-cyan-50/60',
  排行榜: 'border-orange-200 bg-orange-50/60',
  '-': 'border-slate-200 bg-slate-50',
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function siteStyle(domain: string) {
  const hash = Array.from(domain).reduce((total, character) => total + character.charCodeAt(0), 0)
  return SITE_STYLES[hash % SITE_STYLES.length]
}

export function KeywordClassificationClient({ canDelete }: { canDelete: boolean }) {
  const [items, setItems] = useState<Row[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [siteGroups, setSiteGroups] = useState<SiteGroup[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [classificationStatus, setClassificationStatus] = useState('confirmed')
  const [selectedSite, setSelectedSite] = useState('all')
  const [layoutFilter, setLayoutFilter] = useState<LayoutFilter>('all')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [batchSaving, setBatchSaving] = useState(false)
  const [deleting, setDeleting] = useState('')
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [layoutEditor, setLayoutEditor] = useState<Row | null>(null)
  const [layoutDraft, setLayoutDraft] = useState<string[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set())
  const [batchSiteMode, setBatchSiteMode] = useState<BatchSiteMode | null>(null)
  const [batchSiteDraft, setBatchSiteDraft] = useState<string[]>([])
  const layoutDialogRef = useRef<HTMLElement>(null)
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        classificationStatus,
      })
      if (selectedSite !== 'all') params.set('site', selectedSite)
      if (layoutFilter !== 'all') params.set('layout', layoutFilter)
      if (category) params.set('category', category)
      if (subcategory) params.set('subcategory', subcategory)
      if (search) params.set('q', search)
      const response = await fetch(`/api/keyword-classification?${params}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '词库布局资料读取失败')
      const rows = (body.items ?? []) as Row[]
      setItems(rows)
      setSelectedKeywords(new Set())
      setSummary((body.summary ?? []) as SummaryRow[])
      const nextSiteGroups = (body.siteGroups ?? []) as SiteGroup[]
      setSiteGroups(nextSiteGroups)
      setSelectedSite(current => {
        const availableSites = nextSiteGroups.flatMap(group => group.sites)
        return current === 'all' || availableSites.includes(current) ? current : 'all'
      })
      setTotal(Number(body.total) || 0)
      setDrafts(Object.fromEntries(rows.map(row => [row.keyword, {
        category: row.content_category ?? '',
        subcategory: row.content_subcategory ?? '',
      }])))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '词库布局资料读取失败')
    } finally {
      setLoading(false)
    }
  }, [category, classificationStatus, layoutFilter, page, search, selectedSite, subcategory])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!layoutEditor && !batchSiteMode) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusableItems = () => Array.from(layoutDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? [])
    requestAnimationFrame(() => focusableItems()[0]?.focus())
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setLayoutEditor(null)
        setBatchSiteMode(null)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusableItems()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKeys)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleDialogKeys)
      previouslyFocused?.focus()
    }
  }, [batchSiteMode, layoutEditor])

  const primarySummary = useMemo(() => {
    const totals = new Map<string, SummaryRow>()
    for (const row of summary) {
      const current = totals.get(row.category) ?? { category: row.category, subcategory: null, status: row.status, source: row.source, keyword_count: 0, total_volume: 0, rising_count: 0 }
      current.keyword_count += Number(row.keyword_count) || 0
      current.total_volume += Number(row.total_volume) || 0
      current.rising_count += Number(row.rising_count) || 0
      totals.set(row.category, current)
    }
    return totals
  }, [summary])

  const secondarySummary = useMemo(() => {
    const totals = new Map<string, SummaryRow>()
    for (const row of summary) {
      if (row.category !== category || !row.subcategory) continue
      const current = totals.get(row.subcategory) ?? { ...row, keyword_count: 0, total_volume: 0, rising_count: 0 }
      current.keyword_count += Number(row.keyword_count) || 0
      current.total_volume += Number(row.total_volume) || 0
      current.rising_count += Number(row.rising_count) || 0
      totals.set(row.subcategory, current)
    }
    return Array.from(totals.values()).sort((a, b) => Number(b.keyword_count) - Number(a.keyword_count))
  }, [category, summary])

  const allowedSiteDomains = useMemo(() => new Set(siteGroups.flatMap(group => group.sites)), [siteGroups])
  const availableSites = useMemo(() => siteGroups.flatMap(group => group.sites), [siteGroups])
  const selectedRows = useMemo(() => items.filter(row => selectedKeywords.has(row.keyword)), [items, selectedKeywords])
  const batchSiteOptions = useMemo(() => batchSiteMode === 'remove'
    ? availableSites.filter(domain => selectedRows.some(row => (row.layout_site_domains ?? []).includes(domain)))
    : availableSites, [availableSites, batchSiteMode, selectedRows])
  const canBatchCancel = selectedSite === 'all'
    ? selectedRows.some(row => (row.layout_site_domains ?? []).some(domain => allowedSiteDomains.has(domain)))
    : selectedRows.some(row => (row.layout_site_domains ?? []).includes(selectedSite))
  const selectedCategory = (category === '游戏' || category === '应用') ? category : ''
  const availableSubcategories = selectedCategory === '游戏'
    ? GAME_SUBCATEGORIES
    : selectedCategory === '应用'
      ? APP_SUBCATEGORIES
      : category === ''
        ? Array.from(new Set([...GAME_SUBCATEGORIES, ...APP_SUBCATEGORIES]))
        : []

  function chooseCard(value: string) {
    setPage(0)
    setSubcategory('')
    if (value === '待分类') {
      setClassificationStatus('pending')
      setCategory('')
    } else {
      setClassificationStatus('all')
      setCategory(value)
    }
  }

  function updateDraft(keyword: string, next: Partial<Draft>) {
    setDrafts(current => {
      const previous = current[keyword] ?? { category: '', subcategory: '' }
      const merged = { ...previous, ...next }
      if (next.category && next.category !== '游戏' && next.category !== '应用') merged.subcategory = ''
      if (next.category && next.category !== previous.category) merged.subcategory = ''
      return { ...current, [keyword]: merged }
    })
  }

  function isClassificationChanged(row: Row, draft: Draft) {
    return draft.category !== (row.content_category ?? '') || draft.subcategory !== (row.content_subcategory ?? '')
  }

  async function confirmClassification(row: Row) {
    const draft = drafts[row.keyword]
    if (!draft?.category) { setError('请先选择一级分类'); return }
    if ((draft.category === '游戏' || draft.category === '应用') && !draft.subcategory) {
      setError('游戏或应用必须选择二级分类')
      return
    }
    setSaving(row.keyword)
    setError('')
    try {
      const response = await fetch('/api/keyword-classification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: row.keyword, ...draft }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '分类保存失败')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '分类保存失败')
    } finally {
      setSaving('')
    }
  }

  async function saveSiteAssignments(row: Row, nextAssignments: string[], closeEditor = false) {
    setSaving(row.keyword)
    setError('')
    try {
      const response = await fetch('/api/keyword-classification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-sites', keyword: row.keyword, domains: nextAssignments }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '站点布局保存失败')
      if (closeEditor) setLayoutEditor(null)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '站点布局保存失败')
    } finally {
      setSaving('')
    }
  }

  async function toggleCurrentSiteLayout(row: Row) {
    if (selectedSite === 'all' || !allowedSiteDomains.has(selectedSite)) return
    const accessibleAssignments = (row.layout_site_domains ?? []).filter(domain => allowedSiteDomains.has(domain))
    const nextAssignments = accessibleAssignments.includes(selectedSite)
      ? accessibleAssignments.filter(domain => domain !== selectedSite)
      : [...accessibleAssignments, selectedSite]
    await saveSiteAssignments(row, nextAssignments)
  }

  function openLayoutEditor(row: Row) {
    setLayoutEditor(row)
    setLayoutDraft((row.layout_site_domains ?? []).filter(domain => allowedSiteDomains.has(domain)))
    setError('')
  }

  function toggleLayoutDraft(domain: string) {
    setLayoutDraft(current => current.includes(domain)
      ? current.filter(value => value !== domain)
      : [...current, domain])
  }

  function toggleKeyword(keyword: string) {
    setSelectedKeywords(current => {
      const next = new Set(current)
      if (next.has(keyword)) next.delete(keyword)
      else next.add(keyword)
      return next
    })
  }

  function toggleAllKeywords() {
    setSelectedKeywords(items.length > 0 && items.every(row => selectedKeywords.has(row.keyword))
      ? new Set()
      : new Set(items.map(row => row.keyword)))
  }

  function toggleBatchSiteDraft(domain: string) {
    setBatchSiteDraft(current => current.includes(domain)
      ? current.filter(value => value !== domain)
      : [...current, domain])
  }

  async function runBatchSiteAction(mode: BatchSiteMode, domains: string[]) {
    if (selectedKeywords.size === 0 || domains.length === 0) return
    setBatchSaving(true)
    setError('')
    try {
      const response = await fetch('/api/keyword-classification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch-sites', keywords: [...selectedKeywords], mode, domains }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || (mode === 'add' ? '批量布局失败' : '批量取消失败'))
      setBatchSiteMode(null)
      setBatchSiteDraft([])
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : mode === 'add' ? '批量布局失败' : '批量取消失败')
    } finally {
      setBatchSaving(false)
    }
  }

  function beginBatchSiteAction(mode: BatchSiteMode) {
    if (selectedKeywords.size === 0) return
    if (selectedSite !== 'all') {
      void runBatchSiteAction(mode, [selectedSite])
      return
    }
    setBatchSiteDraft([])
    setBatchSiteMode(mode)
    setError('')
  }

  async function markSelectedAsProblem() {
    if (selectedKeywords.size === 0) return
    setBatchSaving(true)
    setError('')
    try {
      const response = await fetch('/api/keyword-classification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch-issue', keywords: [...selectedKeywords] }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '批量标记问题失败')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '批量标记问题失败')
    } finally {
      setBatchSaving(false)
    }
  }

  async function toggleProblem(row: Row) {
    setSaving(row.keyword)
    setError('')
    try {
      const response = await fetch('/api/keyword-classification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-issue', keyword: row.keyword, problem: row.layout_status !== 'issue' }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '问题状态保存失败')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '问题状态保存失败')
    } finally {
      setSaving('')
    }
  }

  async function removeKeyword(row: Row) {
    if (!canDelete || deleting || row.layout_status !== 'issue') return
    if (!window.confirm(`确定永久删除“${row.keyword}”吗？删除后会加入排除名单，后续抓取也不会重新入库。`)) return
    setDeleting(row.keyword)
    setError('')
    try {
      const response = await fetch('/api/keyword-classification', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: row.keyword }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '删除失败')
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败')
    } finally {
      setDeleting('')
    }
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-950">词库布局</h1>
        <p className="mt-1 text-sm text-slate-500">查看全部站点的布局情况，或切换到单个站点后直接完成该站布局。</p>
      </div>

      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section aria-label="分类总览" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {CARD_ORDER.map(name => {
          const item = primarySummary.get(name)
          const active = name === '待分类' ? classificationStatus === 'pending' && !category : category === name
          return (
            <button key={name} type="button" onClick={() => chooseCard(name)} className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${CARD_STYLE[name]} ${active ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}`}>
              <span className="text-sm font-semibold text-slate-800">{name === '-' ? '未能判断' : name}</span>
              <span className="mt-2 block text-xl font-bold tabular-nums text-slate-950">{formatNumber(item?.keyword_count ?? 0)}</span>
              <span className="mt-1 block text-[11px] text-slate-500">总量 {formatNumber(item?.total_volume ?? 0)} · 上涨 {formatNumber(item?.rising_count ?? 0)}</span>
            </button>
          )
        })}
      </section>

      {secondarySummary.length > 0 && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setSubcategory(''); setPage(0) }} className={`rounded-md border px-2.5 py-1.5 text-xs ${!subcategory ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'}`}>全部二级分类</button>
            {secondarySummary.map(item => <button key={item.subcategory} type="button" onClick={() => { setSubcategory(item.subcategory ?? ''); setPage(0) }} className={`rounded-md border px-2.5 py-1.5 text-xs ${subcategory === item.subcategory ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{item.subcategory} · {formatNumber(item.keyword_count)}词</button>)}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
          <label className="flex h-9 w-[170px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5">
            <span className="shrink-0 text-xs text-slate-500">当前站点</span>
            <select aria-label="当前站点" value={selectedSite} onChange={event => { setSelectedSite(event.target.value); setPage(0) }} style={{ color: selectedSite === 'all' ? '#334155' : siteStyle(selectedSite).text }} className="min-w-0 flex-1 border-0 bg-transparent pr-1 text-sm font-semibold outline-none">
              <option value="all" className="text-slate-700">全部</option>
              {availableSites.map(domain => <option key={domain} value={domain} style={{ color: siteStyle(domain).text }}>{domain}</option>)}
            </select>
          </label>
          <select aria-label="一级分类" value={category} onChange={event => { setClassificationStatus(event.target.value ? 'all' : 'confirmed'); setCategory(event.target.value); setSubcategory(''); setPage(0) }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none">
            <option value="">全部一级分类</option>
            {KEYWORD_PRIMARY_CATEGORIES.map(value => <option key={value} value={value}>{value === '-' ? '未能判断' : value}</option>)}
          </select>
          <select aria-label="二级分类" value={subcategory} disabled={availableSubcategories.length === 0} onChange={event => { setSubcategory(event.target.value); setPage(0) }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400">
            <option value="">{availableSubcategories.length > 0 ? '全部二级分类' : '无二级分类'}</option>
            {availableSubcategories.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="布局状态" value={layoutFilter} onChange={event => { setLayoutFilter(event.target.value as LayoutFilter); setPage(0) }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none">
            {LAYOUT_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(0) }} className="flex h-9 min-w-[240px] basis-[300px] grow items-stretch gap-2 xl:max-w-[420px]">
            <input aria-label="搜索关键词" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入关键词..." className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-green-500" />
            <button type="submit" disabled={loading} className="inline-flex h-9 min-h-0 shrink-0 items-center justify-center rounded-lg bg-green-500 px-4 text-sm font-medium text-white transition-colors hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 disabled:opacity-50">{loading ? '查询中...' : '查询'}</button>
          </form>
          <button type="button" disabled={batchSaving || selectedKeywords.size === 0} onClick={() => beginBatchSiteAction('add')} className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40">批量布局</button>
          <button type="button" disabled={batchSaving || !canBatchCancel} onClick={() => beginBatchSiteAction('remove')} className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40">批量取消</button>
          <button type="button" disabled={batchSaving || selectedKeywords.size === 0} onClick={() => void markSelectedAsProblem()} className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-700 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40">标记问题</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] table-fixed" aria-label="关键词布局列表">
            <colgroup><col className="w-12" /><col className="w-60" /><col className="w-24" /><col className="w-32" /><col className="w-40" /><col /><col className={canDelete ? 'w-64' : 'w-44'} /></colgroup>
            <thead className="bg-slate-50"><tr><th className="table-th"><input type="checkbox" aria-label="全选当前页" checked={items.length > 0 && items.every(row => selectedKeywords.has(row.keyword))} onChange={toggleAllKeywords} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></th><th className="table-th">关键词</th><th className="table-th text-right">搜索量</th><th className="table-th">一级分类</th><th className="table-th">二级分类</th><th className="table-th">布局站点</th><th className="table-th text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-400">正在读取词库布局资料…</td></tr> : items.length === 0 ? <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-400">当前筛选下没有资料</td></tr> : items.map(row => {
                const draft = drafts[row.keyword] ?? { category: '', subcategory: '' }
                const subOptions = subcategoriesFor(draft.category)
                const assignedSites = row.layout_site_domains ?? []
                const currentSiteAssigned = selectedSite !== 'all' && assignedSites.includes(selectedSite)
                const visibleSites = selectedSite === 'all' ? assignedSites : currentSiteAssigned ? [selectedSite] : []
                const classificationChanged = isClassificationChanged(row, draft)
                return <tr key={row.keyword} className={selectedKeywords.has(row.keyword) ? 'bg-emerald-50/60 hover:bg-emerald-50/80' : row.layout_status === 'issue' ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50/70'}>
                  <td className="table-td align-middle"><input type="checkbox" aria-label={`选择 ${row.keyword}`} checked={selectedKeywords.has(row.keyword)} onChange={() => toggleKeyword(row.keyword)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></td>
                  <td className="table-td align-middle"><span className="block truncate font-medium text-slate-900" title={row.keyword}>{row.keyword}</span></td>
                  <td className="table-td align-middle text-right font-semibold tabular-nums text-slate-800">{formatNumber(row.volume)}</td>
                  <td className="table-td align-middle"><select aria-label={`${row.keyword}一级分类`} value={draft.category} onChange={event => updateDraft(row.keyword, { category: event.target.value as KeywordPrimaryCategory | '' })} className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs focus:border-emerald-500 focus:outline-none"><option value="">请选择</option>{KEYWORD_PRIMARY_CATEGORIES.map(value => <option key={value} value={value}>{value === '-' ? '未能判断' : value}</option>)}</select></td>
                  <td className="table-td align-middle">{subOptions.length > 0 ? <select aria-label={`${row.keyword}二级分类`} value={draft.subcategory} onChange={event => updateDraft(row.keyword, { subcategory: event.target.value })} className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs focus:border-emerald-500 focus:outline-none"><option value="">请选择</option>{subOptions.map(value => <option key={value} value={value}>{value}</option>)}</select> : <span className="text-slate-300">—</span>}</td>
                  <td className="table-td align-middle"><div className="flex min-w-0 items-center gap-1 overflow-hidden" title={visibleSites.join('、')}>{visibleSites.length === 0 ? <span className="text-slate-300">—</span> : <>{visibleSites.slice(0, 4).map(domain => <span key={domain} className={`inline-flex max-w-36 shrink-0 truncate rounded-md border px-2 py-1 text-xs font-medium ${siteStyle(domain).chip}`}>{domain}</span>)}{visibleSites.length > 4 && <span className="shrink-0 text-xs text-slate-500">+{visibleSites.length - 4}</span>}</>}</div></td>
                  <td className="table-td align-middle text-right"><span className="inline-flex items-center justify-end gap-1.5">{classificationChanged && <button type="button" disabled={saving === row.keyword || deleting === row.keyword} onClick={() => void confirmClassification(row)} className="inline-flex h-8 min-h-0 items-center justify-center whitespace-nowrap rounded-md bg-green-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50">{saving === row.keyword ? '保存中' : '保存分类'}</button>}{selectedSite === 'all' ? <button type="button" disabled={saving === row.keyword || deleting === row.keyword || availableSites.length === 0} onClick={() => openLayoutEditor(row)} className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 disabled:opacity-50">布局</button> : <button type="button" disabled={saving === row.keyword || deleting === row.keyword} onClick={() => void toggleCurrentSiteLayout(row)} className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md px-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${currentSiteAssigned ? 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>{saving === row.keyword ? '保存中' : currentSiteAssigned ? '取消' : '布局'}</button>}<button type="button" disabled={saving === row.keyword || deleting === row.keyword} onClick={() => void toggleProblem(row)} className={`inline-flex h-8 min-h-0 items-center justify-center whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${row.layout_status === 'issue' ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{row.layout_status === 'issue' ? '取消问题' : '标记问题'}</button>{canDelete && row.layout_status === 'issue' && <button type="button" disabled={Boolean(deleting) || saving === row.keyword} onClick={() => void removeKeyword(row)} className="inline-flex h-8 min-h-0 items-center justify-center whitespace-nowrap rounded-md border border-red-200 bg-white px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50">{deleting === row.keyword ? '删除中' : '永久删除'}</button>}</span></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>

        <SimplePagination page={page} total={total} pageSize={pageSize} disabled={loading} onChange={setPage} />
      </section>

      {layoutEditor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button type="button" aria-label="关闭站点选择" className="absolute inset-0 bg-slate-950/45" onClick={() => { if (!saving) setLayoutEditor(null) }} />
          <section ref={layoutDialogRef} role="dialog" aria-modal="true" aria-labelledby="layout-editor-title" className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id="layout-editor-title" className="text-lg font-semibold text-slate-950">管理布局站点</h2>
                <p className="mt-1 truncate text-sm text-slate-500" title={layoutEditor.keyword}>{layoutEditor.keyword} · 取消勾选即可取消布局</p>
              </div>
              <button type="button" aria-label="关闭站点选择" disabled={Boolean(saving)} onClick={() => setLayoutEditor(null)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50">×</button>
            </div>
            <div className="grid gap-2 overflow-y-auto p-5 sm:grid-cols-2">
              {availableSites.map(domain => <label key={domain} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:brightness-95 ${siteStyle(domain).chip}`}><input type="checkbox" checked={layoutDraft.includes(domain)} onChange={() => toggleLayoutDraft(domain)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span className="min-w-0 truncate" title={domain}>{domain}</span></label>)}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <span className="text-xs text-slate-500">已选择 {layoutDraft.length} 个站点</span>
              <div className="flex gap-2">
                <button type="button" disabled={Boolean(saving)} onClick={() => setLayoutEditor(null)} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">取消</button>
                <button type="button" disabled={Boolean(saving)} onClick={() => void saveSiteAssignments(layoutEditor, layoutDraft, true)} className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 disabled:opacity-50">{saving ? '保存中…' : '保存布局'}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {batchSiteMode && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button type="button" aria-label="关闭批量站点选择" className="absolute inset-0 bg-slate-950/45" onClick={() => { if (!batchSaving) setBatchSiteMode(null) }} />
          <section ref={layoutDialogRef} role="dialog" aria-modal="true" aria-labelledby="batch-site-editor-title" className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id="batch-site-editor-title" className="text-lg font-semibold text-slate-950">{batchSiteMode === 'add' ? '批量布局站点' : '批量取消站点'}</h2>
                <p className="mt-1 text-sm text-slate-500">{batchSiteMode === 'add' ? '勾选要加入布局的站点。' : '勾选要从这些关键词中取消的站点。'}</p>
              </div>
              <button type="button" aria-label="关闭批量站点选择" disabled={batchSaving} onClick={() => setBatchSiteMode(null)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50">×</button>
            </div>
            <div className="grid gap-2 overflow-y-auto p-5 sm:grid-cols-2">
              {batchSiteOptions.map(domain => <label key={domain} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:brightness-95 ${siteStyle(domain).chip}`}><input type="checkbox" checked={batchSiteDraft.includes(domain)} onChange={() => toggleBatchSiteDraft(domain)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span className="min-w-0 truncate" title={domain}>{domain}</span></label>)}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button type="button" disabled={batchSaving} onClick={() => setBatchSiteMode(null)} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">取消</button>
              <button type="button" disabled={batchSaving || batchSiteDraft.length === 0} onClick={() => void runBatchSiteAction(batchSiteMode, batchSiteDraft)} className={`inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${batchSiteMode === 'add' ? 'bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus:ring-slate-400'}`}>{batchSaving ? '处理中…' : batchSiteMode === 'add' ? '确认布局' : '确认取消'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
