'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  APP_SUBCATEGORIES,
  GAME_SUBCATEGORIES,
  KEYWORD_PRIMARY_CATEGORIES,
  subcategoriesFor,
  type KeywordClassificationStatus,
  type KeywordPrimaryCategory,
} from '@/lib/keyword-classification'

type Row = {
  keyword: string
  volume: number
  volume_change: number | null
  net_volume_change: number | null
  stat_date: string | null
  content_category: KeywordPrimaryCategory | null
  content_subcategory: string | null
  classification_status: KeywordClassificationStatus
  classification_source: 'codex' | 'manual' | null
  classification_reason: string | null
  classification_queued_at: string
  classified_at: string | null
  reviewed_at: string | null
}

type SummaryRow = {
  category: string
  subcategory: string | null
  status: KeywordClassificationStatus
  source: 'codex' | 'manual' | null
  keyword_count: number
  total_volume: number
  rising_count: number
}

type Draft = { category: KeywordPrimaryCategory | ''; subcategory: string }

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending', label: '待分类' },
  { value: 'confirmed', label: '已分类' },
  { value: 'all', label: '全部状态' },
]

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

function formatDate(value: string | null) {
  if (!value) return '—'
  return value.slice(0, 10).replaceAll('-', '/')
}

export function KeywordClassificationClient({ canDelete }: { canDelete: boolean }) {
  const [items, setItems] = useState<Row[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('confirmed')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [deleting, setDeleting] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status })
      if (category) params.set('category', category)
      if (subcategory) params.set('subcategory', subcategory)
      if (search) params.set('q', search)
      const response = await fetch(`/api/keyword-classification?${params}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '分类资料读取失败')
      const rows = (body.items ?? []) as Row[]
      setItems(rows)
      setSummary((body.summary ?? []) as SummaryRow[])
      setTotal(Number(body.total) || 0)
      setDrafts(Object.fromEntries(rows.map(row => [row.keyword, {
        category: row.content_category ?? '',
        subcategory: row.content_subcategory ?? '',
      }])))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '分类资料读取失败')
    } finally {
      setLoading(false)
    }
  }, [category, page, search, status, subcategory])

  useEffect(() => { void load() }, [load])

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

  const statusSummary = useMemo(() => {
    const counts: Record<KeywordClassificationStatus, number> = { pending: 0, processing: 0, confirmed: 0 }
    let automatic = 0
    let manual = 0
    for (const row of summary) counts[row.status] += Number(row.keyword_count) || 0
    for (const row of summary) {
      if (row.status !== 'confirmed') continue
      if (row.source === 'manual') manual += Number(row.keyword_count) || 0
      else automatic += Number(row.keyword_count) || 0
    }
    return { ...counts, automatic, manual }
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
    return Array.from(totals.values()).sort((a, b) => Number(b.total_volume) - Number(a.total_volume))
  }, [category, summary])

  const selectedCategory = (category === '游戏' || category === '应用') ? category : ''
  const availableSubcategories = selectedCategory === '游戏' ? GAME_SUBCATEGORIES : selectedCategory === '应用' ? APP_SUBCATEGORIES : []
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function chooseCard(value: string) {
    setPage(0)
    setSubcategory('')
    if (value === '待分类') {
      setStatus('pending')
      setCategory('')
    } else {
      setStatus('all')
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

  async function confirm(row: Row) {
    const draft = drafts[row.keyword]
    if (!draft?.category) { setError('请先选择一级分类'); return }
    if ((draft.category === '游戏' || draft.category === '应用') && !draft.subcategory) {
      setError('游戏或应用必须选择二级分类')
      return
    }
    setSaving(row.keyword)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/keyword-classification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: row.keyword, ...draft }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '保存失败')
      setNotice(`已保存「${row.keyword}」的分类修改`)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setSaving('')
    }
  }

  async function removeKeyword(row: Row) {
    if (!canDelete || deleting) return
    if (!window.confirm(`确定删除“${row.keyword}”吗？删除后会加入排除名单，后续抓取也不会重新入库。`)) return
    setDeleting(row.keyword)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/keyword-classification', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: row.keyword }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '删除失败')
      setNotice(`已删除“${row.keyword}”，并阻止它再次进入词库`)
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败')
    } finally {
      setDeleting('')
    }
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">词库分类</h1>
          <p className="mt-1 text-sm text-slate-500">按内容类型整理词库；发现分类不准确时可以直接修改。</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          处理顺序：高搜索量优先 · 每批完成即保存 · 可随时续跑
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><span className="text-xs text-slate-500">待分类</span><strong className="mt-1 block text-xl tabular-nums text-slate-950">{formatNumber(statusSummary.pending)}</strong></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><span className="text-xs text-slate-500">系统已分类</span><strong className="mt-1 block text-xl tabular-nums text-blue-700">{formatNumber(statusSummary.automatic)}</strong></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><span className="text-xs text-slate-500">已人工修改</span><strong className="mt-1 block text-xl tabular-nums text-emerald-700">{formatNumber(statusSummary.manual)}</strong></div>
      </section>

      <section aria-label="分类总览" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {CARD_ORDER.map(name => {
          const item = primarySummary.get(name)
          const active = name === '待分类' ? status === 'pending' && !category : category === name
          return (
            <button key={name} type="button" onClick={() => chooseCard(name)} className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${CARD_STYLE[name]} ${active ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}`}>
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
            {secondarySummary.map(item => <button key={item.subcategory} type="button" onClick={() => { setSubcategory(item.subcategory ?? ''); setPage(0) }} className={`rounded-md border px-2.5 py-1.5 text-xs ${subcategory === item.subcategory ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{item.subcategory} · {formatNumber(item.keyword_count)}词 · 量{formatNumber(item.total_volume)}</button>)}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
          <select value={status} onChange={event => { setStatus(event.target.value); setPage(0) }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
            {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={category} onChange={event => { setCategory(event.target.value); setSubcategory(''); setPage(0) }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="">全部一级分类</option>
            {KEYWORD_PRIMARY_CATEGORIES.map(value => <option key={value} value={value}>{value === '-' ? '未能判断' : value}</option>)}
          </select>
          {availableSubcategories.length > 0 && <select value={subcategory} onChange={event => { setSubcategory(event.target.value); setPage(0) }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="">全部二级分类</option>
            {availableSubcategories.map(value => <option key={value} value={value}>{value}</option>)}
          </select>}
          <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(0) }} className="flex h-9 min-w-[280px] flex-1 items-stretch gap-2">
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索关键词" className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
            <button type="submit" className="inline-flex h-9 min-h-0 w-16 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1">查询</button>
          </form>
          <span className="ml-auto inline-flex h-9 shrink-0 items-center whitespace-nowrap text-xs text-slate-500">共 {formatNumber(total)} 个词</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] table-fixed" aria-label="关键词分类列表">
            <colgroup><col className="w-64" /><col className="w-24" /><col className="w-36" /><col className="w-44" /><col /><col className="w-44" /><col className={canDelete ? 'w-40' : 'w-24'} /></colgroup>
            <thead className="bg-slate-50"><tr><th className="table-th">关键词</th><th className="table-th text-right">搜索量</th><th className="table-th">一级分类</th><th className="table-th">二级分类</th><th className="table-th">分类依据</th><th className="table-th">状态／日期</th><th className="table-th text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-400">正在读取分类资料…</td></tr> : items.length === 0 ? <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-400">当前筛选下没有资料</td></tr> : items.map(row => {
                const draft = drafts[row.keyword] ?? { category: '', subcategory: '' }
                const subOptions = subcategoriesFor(draft.category)
                return <tr key={row.keyword} className="hover:bg-slate-50/70">
                  <td className="table-td align-middle"><span className="block truncate font-medium text-slate-900" title={row.keyword}>{row.keyword}</span></td>
                  <td className="table-td align-middle text-right font-semibold tabular-nums text-slate-800">{formatNumber(row.volume)}</td>
                  <td className="table-td align-middle"><select aria-label={`${row.keyword}一级分类`} value={draft.category} onChange={event => updateDraft(row.keyword, { category: event.target.value as KeywordPrimaryCategory | '' })} className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="">请选择</option>{KEYWORD_PRIMARY_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}</select></td>
                  <td className="table-td align-middle">{subOptions.length > 0 ? <select aria-label={`${row.keyword}二级分类`} value={draft.subcategory} onChange={event => updateDraft(row.keyword, { subcategory: event.target.value })} className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="">请选择</option>{subOptions.map(value => <option key={value} value={value}>{value}</option>)}</select> : <span className="text-slate-300">—</span>}</td>
                  <td className="table-td align-middle"><span className="block truncate text-xs text-slate-600" title={row.classification_reason ?? ''}>{row.classification_reason || (row.classification_status === 'pending' ? '等待自动分类' : '—')}</span></td>
                  <td className="table-td align-middle"><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`text-xs font-medium ${row.classification_status === 'pending' ? 'text-amber-600' : row.classification_status === 'processing' ? 'text-violet-600' : row.classification_source === 'manual' ? 'text-emerald-600' : 'text-blue-600'}`}>{row.classification_status === 'pending' ? '待分类' : row.classification_status === 'processing' ? '处理中' : row.classification_source === 'manual' ? '已修改' : '系统分类'}</span><span className="text-[11px] text-slate-400">· {formatDate(row.reviewed_at || row.classified_at || row.classification_queued_at)}</span></span></td>
                  <td className="table-td align-middle text-right"><span className="inline-flex items-center justify-end gap-1.5"><button type="button" disabled={saving === row.keyword || deleting === row.keyword} onClick={() => void confirm(row)} className="inline-flex h-8 min-h-0 items-center justify-center whitespace-nowrap rounded-md bg-green-600 px-3 text-xs font-medium text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50">{saving === row.keyword ? '保存中' : '保存修改'}</button>{canDelete && <button type="button" disabled={Boolean(deleting)} onClick={() => void removeKeyword(row)} className="inline-flex h-8 min-h-0 items-center justify-center whitespace-nowrap rounded-md border border-red-200 bg-white px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50">{deleting === row.keyword ? '删除中' : '删除'}</button>}</span></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          <span>第 {page + 1} / {pageCount} 页</span>
          <div className="flex gap-2"><button type="button" disabled={page === 0 || loading} onClick={() => setPage(value => Math.max(0, value - 1))} className="btn-secondary h-8 px-3 disabled:opacity-40">上一页</button><button type="button" disabled={page >= pageCount - 1 || loading} onClick={() => setPage(value => value + 1)} className="btn-secondary h-8 px-3 disabled:opacity-40">下一页</button></div>
        </div>
      </section>
    </div>
  )
}
