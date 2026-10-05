'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

export function KeywordClassificationClient({ canDelete }: { canDelete: boolean }) {
  const [items, setItems] = useState<Row[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [siteGroups, setSiteGroups] = useState<SiteGroup[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [classificationStatus, setClassificationStatus] = useState('confirmed')
  const [selectedSite, setSelectedSite] = useState('')
  const [problemOnly, setProblemOnly] = useState(false)
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [deleting, setDeleting] = useState('')
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
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
      if (problemOnly) params.set('problem', 'true')
      if (category) params.set('category', category)
      if (subcategory) params.set('subcategory', subcategory)
      if (search) params.set('q', search)
      const response = await fetch(`/api/keyword-classification?${params}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '词库布局资料读取失败')
      const rows = (body.items ?? []) as Row[]
      setItems(rows)
      setSummary((body.summary ?? []) as SummaryRow[])
      const nextSiteGroups = (body.siteGroups ?? []) as SiteGroup[]
      setSiteGroups(nextSiteGroups)
      setSelectedSite(current => {
        const availableSites = nextSiteGroups.flatMap(group => group.sites)
        if (current && availableSites.includes(current)) return current
        const remembered = window.localStorage.getItem('keyword-layout-site') || ''
        return availableSites.includes(remembered) ? remembered : availableSites[0] ?? ''
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
  }, [category, classificationStatus, page, problemOnly, search, subcategory])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (selectedSite) window.localStorage.setItem('keyword-layout-site', selectedSite)
  }, [selectedSite])

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
  const selectedCategory = (category === '游戏' || category === '应用') ? category : ''
  const availableSubcategories = selectedCategory === '游戏' ? GAME_SUBCATEGORIES : selectedCategory === '应用' ? APP_SUBCATEGORIES : []

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

  async function toggleCurrentSite(row: Row) {
    if (!selectedSite || !allowedSiteDomains.has(selectedSite)) return
    const accessibleAssignments = (row.layout_site_domains ?? []).filter(domain => allowedSiteDomains.has(domain))
    const alreadyAssigned = accessibleAssignments.includes(selectedSite)
    const nextAssignments = alreadyAssigned
      ? accessibleAssignments.filter(domain => domain !== selectedSite)
      : [...accessibleAssignments, selectedSite]

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
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '站点布局保存失败')
    } finally {
      setSaving('')
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
        <p className="mt-1 text-sm text-slate-500">先选择当前负责的站点，再逐词标记该站是否已经布局；其他站点的记录不会影响你的判断。</p>
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
          <label className="flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5">
            <span className="shrink-0 text-xs font-semibold text-emerald-700">当前站点</span>
            <select aria-label="当前负责站点" value={selectedSite} onChange={event => { setSelectedSite(event.target.value); setPage(0) }} className="min-w-[180px] border-0 bg-transparent pr-2 text-sm font-medium text-slate-800 outline-none">
              {siteGroups.length === 0 && <option value="">暂无可用站点</option>}
              {siteGroups.map(group => <optgroup key={group.id} label={group.name}>{group.sites.map(domain => <option key={domain} value={domain}>{domain}</option>)}</optgroup>)}
            </select>
          </label>
          <select aria-label="一级分类" value={category} onChange={event => { setClassificationStatus(event.target.value ? 'all' : 'confirmed'); setCategory(event.target.value); setSubcategory(''); setPage(0) }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none">
            <option value="">全部一级分类</option>
            {KEYWORD_PRIMARY_CATEGORIES.map(value => <option key={value} value={value}>{value === '-' ? '未能判断' : value}</option>)}
          </select>
          {availableSubcategories.length > 0 && <select aria-label="二级分类" value={subcategory} onChange={event => { setSubcategory(event.target.value); setPage(0) }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none">
            <option value="">全部二级分类</option>
            {availableSubcategories.map(value => <option key={value} value={value}>{value}</option>)}
          </select>}
          <button type="button" aria-pressed={problemOnly} onClick={() => { setProblemOnly(value => !value); setPage(0) }} className={`inline-flex h-9 items-center whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 ${problemOnly ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{problemOnly ? '正在查看问题词' : '只看问题词'}</button>
          <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(0) }} className="flex h-9 min-w-[280px] flex-1 items-stretch gap-2">
            <input aria-label="搜索关键词" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索关键词" className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
            <button type="submit" className="inline-flex h-9 min-h-0 w-16 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1">查询</button>
          </form>
          <span className="ml-auto inline-flex h-9 shrink-0 items-center whitespace-nowrap text-xs text-slate-500">共 {formatNumber(total)} 个词</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] table-fixed" aria-label="关键词布局列表">
            <colgroup><col className="w-60" /><col className="w-24" /><col className="w-32" /><col className="w-40" /><col /><col className={canDelete ? 'w-64' : 'w-44'} /></colgroup>
            <thead className="bg-slate-50"><tr><th className="table-th">关键词</th><th className="table-th text-right">搜索量</th><th className="table-th">一级分类</th><th className="table-th">二级分类</th><th className="table-th">布局站点</th><th className="table-th text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-slate-400">正在读取词库布局资料…</td></tr> : items.length === 0 ? <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-slate-400">当前筛选下没有资料</td></tr> : items.map(row => {
                const draft = drafts[row.keyword] ?? { category: '', subcategory: '' }
                const subOptions = subcategoriesFor(draft.category)
                const assignedSites = row.layout_site_domains ?? []
                const currentSiteAssigned = Boolean(selectedSite) && assignedSites.includes(selectedSite)
                const classificationChanged = isClassificationChanged(row, draft)
                return <tr key={row.keyword} className={row.layout_status === 'issue' ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50/70'}>
                  <td className="table-td align-middle"><span className="block truncate font-medium text-slate-900" title={row.keyword}>{row.keyword}</span></td>
                  <td className="table-td align-middle text-right font-semibold tabular-nums text-slate-800">{formatNumber(row.volume)}</td>
                  <td className="table-td align-middle"><select aria-label={`${row.keyword}一级分类`} value={draft.category} onChange={event => updateDraft(row.keyword, { category: event.target.value as KeywordPrimaryCategory | '' })} className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs focus:border-emerald-500 focus:outline-none"><option value="">请选择</option>{KEYWORD_PRIMARY_CATEGORIES.map(value => <option key={value} value={value}>{value === '-' ? '未能判断' : value}</option>)}</select></td>
                  <td className="table-td align-middle">{subOptions.length > 0 ? <select aria-label={`${row.keyword}二级分类`} value={draft.subcategory} onChange={event => updateDraft(row.keyword, { subcategory: event.target.value })} className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs focus:border-emerald-500 focus:outline-none"><option value="">请选择</option>{subOptions.map(value => <option key={value} value={value}>{value}</option>)}</select> : <span className="text-slate-300">—</span>}</td>
                  <td className="table-td align-middle"><button type="button" disabled={!selectedSite || saving === row.keyword} onClick={() => void toggleCurrentSite(row)} title={!selectedSite ? '请先选择当前站点' : currentSiteAssigned ? `点击取消 ${selectedSite} 的已布局标记` : `点击标记 ${selectedSite} 已布局`} className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${currentSiteAssigned ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50'}`}>{currentSiteAssigned && <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 5.296a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.296-7.29a1 1 0 0 1 1.408 0Z" clipRule="evenodd" /></svg>}<span className="truncate">{!selectedSite ? '请先选择站点' : currentSiteAssigned ? `${selectedSite} 已布局` : '标记本站已布局'}</span></button></td>
                  <td className="table-td align-middle text-right"><span className="inline-flex items-center justify-end gap-1.5">{classificationChanged && <button type="button" disabled={saving === row.keyword || deleting === row.keyword} onClick={() => void confirmClassification(row)} className="inline-flex h-8 min-h-0 items-center justify-center whitespace-nowrap rounded-md bg-green-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50">{saving === row.keyword ? '保存中' : '保存分类'}</button>}<button type="button" disabled={saving === row.keyword || deleting === row.keyword} onClick={() => void toggleProblem(row)} className={`inline-flex h-8 min-h-0 items-center justify-center whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${row.layout_status === 'issue' ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{row.layout_status === 'issue' ? '取消问题' : '标记问题'}</button>{canDelete && row.layout_status === 'issue' && <button type="button" disabled={Boolean(deleting) || saving === row.keyword} onClick={() => void removeKeyword(row)} className="inline-flex h-8 min-h-0 items-center justify-center whitespace-nowrap rounded-md border border-red-200 bg-white px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50">{deleting === row.keyword ? '删除中' : '永久删除'}</button>}</span></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>

        <SimplePagination page={page} total={total} pageSize={pageSize} disabled={loading} onChange={setPage} />
      </section>
    </div>
  )
}
