'use client'

import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { buildGroupMaps, groupSortedRows } from '@/lib/company-groups'
import { useUser } from '@/lib/user-context'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { SimplePagination, PAGE_SIZE } from '@/components/simple-pagination'

interface SiteRow { id: string; domain: string; name: string; focus_level: number; category: string; friend_links?: string[] | null; is_enabled?: boolean }
interface HistoryRow {
  site_id: string
  record_date: string
  pc_weight: number
  mobile_weight: number
  pc_ip: number
  pc_ip_max: number
  mobile_ip: number
  mobile_ip_max: number
}

interface AizhanHistorySummary {
  site_id: string
  pc_current_weight: number
  pc_current_keywords: number
  pc_max_weight: number
  pc_max_keywords: number
  pc_max_date: string | null
  pc_min_weight: number
  pc_min_keywords: number
  pc_min_date: string | null
  mobile_current_weight: number
  mobile_current_keywords: number
  mobile_max_weight: number
  mobile_max_keywords: number
  mobile_max_date: string | null
  mobile_min_weight: number
  mobile_min_keywords: number
  mobile_min_date: string | null
}

interface WeightRow {
  site_id: string
  domain: string
  name: string
  focus_level: number
  category: string
  avgIp: number
  pcWeight: number
  mobileWeight: number
  pcWeightChange: number
  mobileWeightChange: number
  pcIpMin: number
  pcIpMax: number
  pcIpAvgChange: number
  mobileIpMin: number
  mobileIpMax: number
  mobileIpAvgChange: number
  trend: { date: string; pcAvg: number; mobileAvg: number }[]
  historySummary: AizhanHistorySummary | null
}

function fmt(n: number) {
  return n.toLocaleString()
}

function currentMYMonth() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
}

function shiftMonth(month: string, offset: number) {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, value - 1 + offset, 1))
  return date.toISOString().slice(0, 7)
}

function monthBounds(month: string) {
  return { start: `${month}-01`, next: `${shiftMonth(month, 1)}-01` }
}

function shortDate(date: string) {
  return date ? date.slice(5).replace('-', '/') : '—'
}

function fullDate(date: string | null) {
  return date ? date.replaceAll('-', '/') : '—'
}

function WeightCell({ value, change }: { value: number; change: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span className="text-sm tabular-nums font-semibold text-gray-900">{value}</span>
      {change !== 0 && (
        <span className={`text-sm font-medium ${change > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {change > 0 ? `+${change}` : change}
        </span>
      )}
    </div>
  )
}

function IpRangeCell({ min, max }: { min: number; max: number }) {
  if (min === 0 && max === 0) return <span className="text-gray-300 text-sm">-</span>
  return <span className="text-sm text-gray-700 tabular-nums">{fmt(min)} ~ {fmt(max)}</span>
}

function IpChangeCell({ change }: { change: number }) {
  if (change === 0) return <span className="text-gray-300 text-sm">-</span>
  return (
    <span className={`text-sm font-medium ${change > 0 ? 'text-green-600' : 'text-red-500'}`}>
      {change > 0 ? `+${fmt(change)}` : fmt(change)}
    </span>
  )
}

function ChangeText({ value }: { value: number }) {
  return <strong className={value > 0 ? 'text-green-600' : value < 0 ? 'text-red-500' : 'text-gray-500'}>{value > 0 ? '+' : ''}{fmt(value)}</strong>
}

function Sparkline({ data }: { data: { date: string; pcAvg: number; mobileAvg: number }[] }) {
  if (data.length < 2) return <span className="text-gray-300 text-sm">暂无趋势</span>
  return (
    <ResponsiveContainer width={140} height={36}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="pcAvg" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="mobileAvg" stroke="#f97316" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function WeightMonitorPage() {
  const { accessibleSiteIds } = useUser()
  const [rows, setRows] = useState<WeightRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<WeightRow | null>(null)
  const [detailMonth, setDetailMonth] = useState(currentMYMonth())
  const [detailHistory, setDetailHistory] = useState<HistoryRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [page, setPage] = useState(0)
  const [filterSite, setFilterSite] = useState('')
  const [filterFocus, setFilterFocus] = useState('')
  const [groupColorMap, setGroupColorMap] = useState<Map<string, string>>(new Map())
  type WSort = 'pcWeight' | 'mobileWeight' | 'pcIp' | 'mobileIp' | 'pcChange' | 'mobileChange'
  const [sortCol, setSortCol] = useState<WSort | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(col: WSort, dir: 'asc' | 'desc') {
    if (sortCol === col && sortDir === dir) { setSortCol(null) }
    else { setSortCol(col); setSortDir(dir) }
    setPage(0)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return
    let active = true
    const { start, next } = monthBounds(detailMonth)
    setDetailLoading(true)
    setDetailError('')
    getBrowserClient().from('weight_history')
      .select('site_id, record_date, pc_weight, mobile_weight, pc_ip, pc_ip_max, mobile_ip, mobile_ip_max')
      .eq('site_id', selected.site_id)
      .gte('record_date', start)
      .lt('record_date', next)
      .order('record_date', { ascending: true })
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) {
          setDetailHistory([])
          setDetailError('读取该月历史失败，请重试')
        } else {
          setDetailHistory((data || []) as HistoryRow[])
        }
        setDetailLoading(false)
      })
    return () => { active = false }
  }, [detailMonth, selected])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const supabase = getBrowserClient()
      const d30ago = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

      const [sitesApiRes, { data: historyRaw }, summariesApiRes] = await Promise.all([
        fetch('/api/sites').then(r => r.json() as Promise<{ sites: SiteRow[] }>),
        supabase.from('weight_history')
          .select('site_id, record_date, pc_weight, mobile_weight, pc_ip, pc_ip_max, mobile_ip, mobile_ip_max')
          .gte('record_date', d30ago)
          .order('record_date', { ascending: true }),
        fetch('/api/sites/history-summary').then(r => r.ok ? r.json() as Promise<{ summaries: AizhanHistorySummary[] }> : { summaries: [] as AizhanHistorySummary[] }),
      ])

      const allSites = (sitesApiRes.sites || []) as SiteRow[]
      const sites = accessibleSiteIds
        ? allSites.filter(s => accessibleSiteIds.includes(s.id))
        : allSites
      const history = (historyRaw || []) as HistoryRow[]
      const summaryMap = new Map((summariesApiRes.summaries || []).map(summary => [summary.site_id, summary]))

      const result: WeightRow[] = sites.map((site) => {
        // history is ascending by date
        const siteHistory = history.filter((h) => h.site_id === site.id)
        const latest = siteHistory.length > 0 ? siteHistory[siteHistory.length - 1] : null
        const prev = siteHistory.length > 1 ? siteHistory[siteHistory.length - 2] : null

        const latestAvgPc = latest ? Math.round((latest.pc_ip + latest.pc_ip_max) / 2) : 0
        const latestAvgMobile = latest ? Math.round((latest.mobile_ip + latest.mobile_ip_max) / 2) : 0
        const prevAvgPc = prev ? Math.round((prev.pc_ip + prev.pc_ip_max) / 2) : 0
        const prevAvgMobile = prev ? Math.round((prev.mobile_ip + prev.mobile_ip_max) / 2) : 0

        const avgIp = Math.round((latestAvgPc + latestAvgMobile) / 2)

        return {
          site_id: site.id,
          domain: site.domain,
          name: site.name,
          focus_level: site.focus_level ?? 3,
          category: site.category ?? 'small',
          avgIp,
          pcWeight: latest?.pc_weight ?? 0,
          mobileWeight: latest?.mobile_weight ?? 0,
          pcWeightChange: prev ? (latest?.pc_weight ?? 0) - prev.pc_weight : 0,
          mobileWeightChange: prev ? (latest?.mobile_weight ?? 0) - prev.mobile_weight : 0,
          pcIpMin: latest?.pc_ip ?? 0,
          pcIpMax: latest?.pc_ip_max ?? 0,
          pcIpAvgChange: prev ? latestAvgPc - prevAvgPc : 0,
          mobileIpMin: latest?.mobile_ip ?? 0,
          mobileIpMax: latest?.mobile_ip_max ?? 0,
          mobileIpAvgChange: prev ? latestAvgMobile - prevAvgMobile : 0,
          trend: siteHistory.map((h) => ({
            date: h.record_date,
            pcAvg: Math.round((h.pc_ip + h.pc_ip_max) / 2),
            mobileAvg: Math.round((h.mobile_ip + h.mobile_ip_max) / 2),
          })),
          historySummary: summaryMap.get(site.id) ?? null,
        }
      })

      const { idMap, colorMap } = buildGroupMaps(sites)
      const catOrder: Record<string, number> = { large: 1, medium: 2, small: 3 }
      const sorted = result.sort((a, b) => {
        if (a.focus_level !== b.focus_level) return a.focus_level - b.focus_level
        const ca = catOrder[a.category] ?? 3
        const cb = catOrder[b.category] ?? 3
        if (ca !== cb) return ca - cb
        return b.avgIp - a.avgIp
      })
      setRows(groupSortedRows(sorted, idMap, r => [r.focus_level, catOrder[r.category] ?? 3]))
      setGroupColorMap(colorMap)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const visibleRows = rows.filter(r => {
    if (filterSite && !r.domain.toLowerCase().includes(filterSite.toLowerCase()) && !r.name?.toLowerCase().includes(filterSite.toLowerCase())) return false
    if (filterFocus && String(r.focus_level) !== filterFocus) return false
    return true
  })

  const sortedVisible = sortCol === null ? visibleRows : [...visibleRows].sort((a, b) => {
    let va = 0, vb = 0
    if (sortCol === 'pcWeight') { va = a.pcWeight; vb = b.pcWeight }
    else if (sortCol === 'mobileWeight') { va = a.mobileWeight; vb = b.mobileWeight }
    else if (sortCol === 'pcIp') { va = (a.pcIpMin + a.pcIpMax) / 2; vb = (b.pcIpMin + b.pcIpMax) / 2 }
    else if (sortCol === 'mobileIp') { va = (a.mobileIpMin + a.mobileIpMax) / 2; vb = (b.mobileIpMin + b.mobileIpMax) / 2 }
    else if (sortCol === 'pcChange') { va = a.pcIpAvgChange; vb = b.pcIpAvgChange }
    else if (sortCol === 'mobileChange') { va = a.mobileIpAvgChange; vb = b.mobileIpAvgChange }
    return sortDir === 'asc' ? va - vb : vb - va
  })

  const sortIcons = (col: WSort) => {
    const isAsc = sortCol === col && sortDir === 'asc'
    const isDesc = sortCol === col && sortDir === 'desc'
    return (
      <span className="flex flex-col items-center gap-px select-none">
        <svg onClick={() => handleSort(col, 'asc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor" className={`cursor-pointer ${isAsc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 0L8 5H0Z"/></svg>
        <svg onClick={() => handleSort(col, 'desc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor" className={`cursor-pointer ${isDesc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 5L0 0H8Z"/></svg>
      </span>
    )
  }

  const detailTrend = detailHistory.map(row => ({
    date: row.record_date,
    pcAvg: Math.round((row.pc_ip + row.pc_ip_max) / 2),
    mobileAvg: Math.round((row.mobile_ip + row.mobile_ip_max) / 2),
  }))
  const validPc = detailTrend.filter(row => row.pcAvg > 0)
  const validMobile = detailTrend.filter(row => row.mobileAvg > 0)
  const pcHighest = validPc.reduce<(typeof detailTrend)[number] | null>((best, row) => !best || row.pcAvg > best.pcAvg ? row : best, null)
  const pcLowest = validPc.reduce<(typeof detailTrend)[number] | null>((best, row) => !best || row.pcAvg < best.pcAvg ? row : best, null)
  const mobileHighest = validMobile.reduce<(typeof detailTrend)[number] | null>((best, row) => !best || row.mobileAvg > best.mobileAvg ? row : best, null)
  const mobileLowest = validMobile.reduce<(typeof detailTrend)[number] | null>((best, row) => !best || row.mobileAvg < best.mobileAvg ? row : best, null)
  const firstDetail = detailTrend[0]
  const latestDetail = detailTrend[detailTrend.length - 1]
  const historical = selected?.historySummary
  const detailCards = historical ? [
    { label: 'PC历史最高', value: `权重 ${historical.pc_max_weight}`, detail: `${fmt(historical.pc_max_keywords)}词 · ${fullDate(historical.pc_max_date)}`, color: 'text-blue-600' },
    { label: 'PC历史最低', value: `权重 ${historical.pc_min_weight}`, detail: `${fmt(historical.pc_min_keywords)}词 · ${fullDate(historical.pc_min_date)}`, color: 'text-blue-600' },
    { label: '移动历史最高', value: `权重 ${historical.mobile_max_weight}`, detail: `${fmt(historical.mobile_max_keywords)}词 · ${fullDate(historical.mobile_max_date)}`, color: 'text-orange-500' },
    { label: '移动历史最低', value: `权重 ${historical.mobile_min_weight}`, detail: `${fmt(historical.mobile_min_keywords)}词 · ${fullDate(historical.mobile_min_date)}`, color: 'text-orange-500' },
  ] : [
    { label: 'PC月内最高均值', value: pcHighest ? fmt(pcHighest.pcAvg) : '—', detail: pcHighest ? shortDate(pcHighest.date) : '', color: 'text-blue-600' },
    { label: 'PC月内最低均值', value: pcLowest ? fmt(pcLowest.pcAvg) : '—', detail: pcLowest ? shortDate(pcLowest.date) : '', color: 'text-blue-600' },
    { label: '移动月内最高均值', value: mobileHighest ? fmt(mobileHighest.mobileAvg) : '—', detail: mobileHighest ? shortDate(mobileHighest.date) : '', color: 'text-orange-500' },
    { label: '移动月内最低均值', value: mobileLowest ? fmt(mobileLowest.mobileAvg) : '—', detail: mobileLowest ? shortDate(mobileLowest.date) : '', color: 'text-orange-500' },
  ]

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">权重监控</h1>
        <p className="text-gray-400 text-sm mt-0.5">各站点PC/移动端权重及来路IP区间，均值变化为与上次记录对比</p>
      </div>

      {/* Detail modal */}
      {selected && (
        <div role="dialog" aria-modal="true" aria-label="权重详情" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.domain} · 来路IP趋势</h2>
                <p className="text-sm text-gray-400">按月查看PC／移动来路IP均值变化</p>
              </div>
              <div className="flex items-center gap-2">
                <button aria-label="上一个月" onClick={() => setDetailMonth(month => shiftMonth(month, -1))} className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50">上一月</button>
                <input aria-label="选择月份" type="month" value={detailMonth} max={currentMYMonth()} onChange={event => setDetailMonth(event.target.value)} className="h-9 rounded-lg border border-gray-200 px-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none" />
                <button aria-label="下一个月" disabled={detailMonth >= currentMYMonth()} onClick={() => setDetailMonth(month => shiftMonth(month, 1))} className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">下一月</button>
                <button aria-label="关闭" onClick={() => setSelected(null)} className="ml-1 h-9 w-9 rounded-lg text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600">×</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4 sm:grid-cols-4">
              {detailCards.map(card => (
                <div key={card.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                  <p className="text-xs text-gray-500">{card.label}</p>
                  <strong className={`mt-1 block text-lg tabular-nums ${card.color}`}>{card.value}</strong>
                  <span className="mt-0.5 block whitespace-nowrap text-xs text-gray-400">{card.detail}</span>
                </div>
              ))}
            </div>
            {detailLoading ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-gray-400">读取该月资料中…</div>
            ) : detailError ? (
              <div role="alert" className="flex h-[220px] items-center justify-center text-sm text-red-500">{detailError}</div>
            ) : detailTrend.length >= 2 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={detailTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v: number) => v >= 10000 ? (v / 10000).toFixed(1) + 'w' : v.toLocaleString()} />
                  <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v)} />
                  <Line type="monotone" dataKey="pcAvg" name="PC均值" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="mobileAvg" name="移动均值" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[220px] items-center justify-center text-sm text-gray-400">这个月份暂无足够的历史资料</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 bg-blue-500" />PC均值</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 bg-orange-500" />移动均值</span>
              {firstDetail && latestDetail && <>
                <span>PC月变化：<ChangeText value={latestDetail.pcAvg - firstDetail.pcAvg} /></span>
                <span>移动月变化：<ChangeText value={latestDetail.mobileAvg - firstDetail.mobileAvg} /></span>
              </>}
              {historical && <span>当前爱站词数：PC {fmt(historical.pc_current_keywords)}／移动 {fmt(historical.mobile_current_keywords)}</span>}
              <span className="ml-auto text-gray-400">{detailHistory.length} 个记录日</span>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-3">
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 text-sm">{error}</div>
          </div>
        ) : (
          <>
          <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">站点</span>
              <input aria-label="输入内容"
                type="text"
                value={filterSite}
                onChange={(e) => { setFilterSite(e.target.value); setPage(0) }}
                placeholder="输入域名..."
                className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none w-36"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">关注级别</span>
              <select aria-label="选择选项" value={filterFocus} onChange={(e) => { setFilterFocus(e.target.value); setPage(0) }} className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                <option value="">全部</option>
                <option value="1">重点</option>
                <option value="2">侧重</option>
                <option value="3">普通</option>
              </select>
            </div>
            <span className="ml-auto text-xs text-gray-400">共 {visibleRows.length} 条</span>
          </div>
          <div className="overflow-x-auto">
            <table aria-label="数据表格" className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-th">域名</th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">PC权重{sortIcons('pcWeight')}</div></th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">移动权重{sortIcons('mobileWeight')}</div></th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">PC来路IP{sortIcons('pcIp')}</div></th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">移动来路IP{sortIcons('mobileIp')}</div></th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">PC均值变化{sortIcons('pcChange')}</div></th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">移动均值变化{sortIcons('mobileChange')}</div></th>
                  <th className="table-th text-center">30天趋势</th>
                  <th className="table-th text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedVisible.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="table-td text-sm text-center text-gray-400 py-10">{rows.length === 0 ? '暂无权重数据' : '没有匹配的站点'}</td>
                  </tr>
                ) : (
                  sortedVisible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row) => (
                    <tr key={row.site_id} className="hover:bg-gray-100 transition-colors" style={{ borderLeft: groupColorMap.has(row.domain) ? `4px solid ${groupColorMap.get(row.domain)}` : '4px solid transparent' }}>
                      <td className="table-td text-sm">
                        <span className="font-medium text-gray-900">{row.domain}</span>
                        {row.name && <span className="text-gray-400"> · {row.name}</span>}
                      </td>
                      <td className="table-td text-sm text-center">
                        <WeightCell value={row.pcWeight} change={row.pcWeightChange} />
                      </td>
                      <td className="table-td text-sm text-center">
                        <WeightCell value={row.mobileWeight} change={row.mobileWeightChange} />
                      </td>
                      <td className="table-td text-sm text-center">
                        <IpRangeCell min={row.pcIpMin} max={row.pcIpMax} />
                      </td>
                      <td className="table-td text-sm text-center">
                        <IpRangeCell min={row.mobileIpMin} max={row.mobileIpMax} />
                      </td>
                      <td className="table-td text-sm text-center">
                        <IpChangeCell change={row.pcIpAvgChange} />
                      </td>
                      <td className="table-td text-sm text-center">
                        <IpChangeCell change={row.mobileIpAvgChange} />
                      </td>
                      <td className="table-td text-sm text-center">
                        <Sparkline data={row.trend} />
                      </td>
                      <td className="table-td text-sm text-center">
                        <button
                          onClick={() => {
                            setDetailHistory([])
                            setDetailMonth(row.trend[row.trend.length - 1]?.date.slice(0, 7) || currentMYMonth())
                            setSelected(row)
                          }}
                          className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors"
                        >
                          查看
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <SimplePagination page={page} total={sortedVisible.length} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}
