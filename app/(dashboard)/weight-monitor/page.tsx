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
}

function fmt(n: number) {
  return n.toLocaleString()
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

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const supabase = getBrowserClient()
      const d30ago = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

      const [sitesApiRes, { data: historyRaw }] = await Promise.all([
        fetch('/api/sites').then(r => r.json() as Promise<{ sites: SiteRow[] }>),
        supabase.from('weight_history')
          .select('site_id, record_date, pc_weight, mobile_weight, pc_ip, pc_ip_max, mobile_ip, mobile_ip_max')
          .gte('record_date', d30ago)
          .order('record_date', { ascending: true }),
      ])

      const allSites = (sitesApiRes.sites || []) as SiteRow[]
      const sites = accessibleSiteIds
        ? allSites.filter(s => accessibleSiteIds.includes(s.id))
        : allSites
      const history = (historyRaw || []) as HistoryRow[]

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

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">权重监控</h1>
        <p className="text-gray-400 text-sm mt-0.5">各站点PC/移动端权重及来路IP区间，均值变化为与上次记录对比</p>
      </div>

      {/* Detail modal */}
      {selected && (
        <div role="dialog" aria-modal="true" aria-label="权重详情" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.domain} · 来路IP趋势</h2>
                <p className="text-sm text-gray-400">近30天PC/移动来路IP均值变化</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="flex gap-8 mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">PC当前均值</p>
                <p className="text-2xl font-bold text-blue-600">{fmt(selected.pcIpAvgChange !== 0 || selected.pcIpMin > 0 ? Math.round((selected.pcIpMin + selected.pcIpMax) / 2) : 0)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">移动当前均值</p>
                <p className="text-2xl font-bold text-orange-500">{fmt(Math.round((selected.mobileIpMin + selected.mobileIpMax) / 2))}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">PC均值变化</p>
                <p className={`text-xl font-bold ${selected.pcIpAvgChange > 0 ? 'text-green-600' : selected.pcIpAvgChange < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                  {selected.pcIpAvgChange === 0 ? '-' : (selected.pcIpAvgChange > 0 ? '+' : '') + fmt(selected.pcIpAvgChange)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">移动均值变化</p>
                <p className={`text-xl font-bold ${selected.mobileIpAvgChange > 0 ? 'text-green-600' : selected.mobileIpAvgChange < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                  {selected.mobileIpAvgChange === 0 ? '-' : (selected.mobileIpAvgChange > 0 ? '+' : '') + fmt(selected.mobileIpAvgChange)}
                </p>
              </div>
            </div>
            {selected.trend.length >= 2 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={selected.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v: number) => v >= 10000 ? (v / 10000).toFixed(1) + 'w' : v.toLocaleString()} />
                  <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v)} />
                  <Line type="monotone" dataKey="pcAvg" name="PC均值" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="mobileAvg" name="移动均值" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">数据积累中，每天跑 cron 后会有更多数据点</div>
            )}
            <div className="flex gap-4 mt-3 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block"></span>PC均值</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-orange-500 inline-block"></span>移动均值</span>
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
                          onClick={() => setSelected(row)}
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
