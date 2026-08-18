'use client'

import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { buildGroupMaps, groupSortedRows } from '@/lib/company-groups'
import { useUser } from '@/lib/user-context'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { SimplePagination, PAGE_SIZE } from '@/components/simple-pagination'
import { computeIndexStatus } from '@/lib/index-status'

interface SiteRow { id: string; domain: string; name: string; focus_level: number; friend_links?: string[] | null; is_enabled?: boolean }
interface SnapRow { site_id: string; snapshot_date: string; index_count: number }

interface IndexRow {
  site_id: string
  domain: string
  name: string
  focus_level: number
  latest: number
  weeklyChange: number
  trend: { date: string; count: number }[]
  status: 'normal' | 'warning' | 'danger' | 'rising'
}

const statusConfig = {
  normal:  { label: '正常', className: 'text-green-600 bg-green-50 px-2 py-0.5 rounded text-sm font-medium' },
  warning: { label: '下跌', className: 'text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded text-sm font-medium' },
  danger:  { label: '危险', className: 'text-red-600 bg-red-50 px-2 py-0.5 rounded text-sm font-medium' },
  rising:  { label: '涨入', className: 'text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-sm font-medium' },
}


function Sparkline({ data }: { data: { date: string; count: number }[] }) {
  if (data.length < 2) return <span className="text-gray-300 text-sm">暂无趋势</span>
  return (
    <ResponsiveContainer width={120} height={36}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function IndexMonitorPage() {
  const { role, accessibleSiteIds } = useUser()
  const [rows, setRows] = useState<IndexRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSite, setSelectedSite] = useState<IndexRow | null>(null)
  const [crawling, setCrawling] = useState<string | null>(null)
  const [crawlMsg, setCrawlMsg] = useState<{ domain: string; text: string; ok: boolean } | null>(null)
  const [page, setPage] = useState(0)
  const [filterSite, setFilterSite] = useState('')
  const [filterFocus, setFilterFocus] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [groupColorMap, setGroupColorMap] = useState<Map<string, string>>(new Map())
  const [sortCol, setSortCol] = useState<'latest' | 'weeklyChange' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(col: 'latest' | 'weeklyChange', dir: 'asc' | 'desc') {
    if (sortCol === col && sortDir === dir) { setSortCol(null) }
    else { setSortCol(col); setSortDir(dir) }
    setPage(0)
  }

  async function triggerCrawl(domain: string) {
    setCrawling(domain)
    setCrawlMsg(null)
    try {
      const res = await fetch('/api/trigger-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: domain, step: 'weight' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setCrawlMsg({ domain, text: data?.error || `请求失败（${res.status}）`, ok: false })
      } else {
        const siteResult = (data?.results ?? []).find((r: { site: string; error?: string }) => r.site === domain)
        if (siteResult?.error) setCrawlMsg({ domain, text: siteResult.error, ok: false })
        else setCrawlMsg({ domain, text: '抓取成功', ok: true })
      }
      await loadData()
    } catch {
      setCrawlMsg({ domain, text: '请求失败，请检查网络', ok: false })
    } finally {
      setCrawling(null)
    }
  }

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const supabase = getBrowserClient()
      const d30ago = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const d7ago = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

      const [sitesApiRes, { data: snapsRaw }] = await Promise.all([
        fetch('/api/sites').then(r => r.json() as Promise<{ sites: SiteRow[] }>),
        supabase.from('index_snapshots')
          .select('site_id, snapshot_date, index_count')
          .gte('snapshot_date', d30ago)
          .order('snapshot_date', { ascending: true }),
      ])

      const allSites = (sitesApiRes.sites || []) as SiteRow[]
      const sites = accessibleSiteIds
        ? allSites.filter(s => accessibleSiteIds.includes(s.id))
        : allSites
      const snaps = (snapsRaw || []) as SnapRow[]

      const result: IndexRow[] = sites.map((site) => {
        const siteSnaps = snaps.filter((s) => s.site_id === site.id)
        const trend = siteSnaps.map((s) => ({ date: s.snapshot_date.slice(5), count: s.index_count }))

        const latest = siteSnaps.length > 0 ? siteSnaps[siteSnaps.length - 1].index_count : 0
        const snap7 = [...siteSnaps].reverse().find((s) => s.snapshot_date <= d7ago)
        const weekAgo = snap7 ? snap7.index_count : 0
        const weeklyChange = weekAgo > 0 ? latest - weekAgo : 0

        const status = computeIndexStatus(siteSnaps)

        return { site_id: site.id, domain: site.domain, name: site.name, focus_level: site.focus_level ?? 3, latest, weeklyChange, trend, status }
      })

      const statusPriority = (r: IndexRow) => {
        if (r.status === 'danger') return 0
        if (r.status === 'warning') return 1
        if (r.weeklyChange < 0) return 2
        if (r.status === 'rising') return 3
        if (r.weeklyChange > 0) return 4
        return 5
      }
      const { idMap, colorMap } = buildGroupMaps(sites)
      const sorted = result.sort((a, b) => {
        if (a.focus_level !== b.focus_level) return a.focus_level - b.focus_level
        if (a.focus_level >= 3) {
          const pd = statusPriority(a) - statusPriority(b)
          if (pd !== 0) return pd
          if (a.weeklyChange !== b.weeklyChange) {
            return (a.weeklyChange < 0 || b.weeklyChange < 0)
              ? a.weeklyChange - b.weeklyChange
              : b.weeklyChange - a.weeklyChange
          }
        }
        return b.latest - a.latest
      })
      setRows(groupSortedRows(sorted, idMap, r => [r.focus_level]))
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
    if (filterStatus && r.status !== filterStatus) return false
    return true
  })

  const sortedVisible = sortCol === null ? visibleRows : [...visibleRows].sort((a, b) => {
    const va = sortCol === 'latest' ? a.latest : a.weeklyChange
    const vb = sortCol === 'latest' ? b.latest : b.weeklyChange
    return sortDir === 'asc' ? va - vb : vb - va
  })

  const sortIcons = (col: 'latest' | 'weeklyChange') => {
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
        <h1 className="text-2xl font-bold text-gray-900">收录监控</h1>
        <p className="text-gray-400 text-sm mt-0.5">各站点百度收录每日快照，周变化趋势</p>
      </div>

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
              <input
                type="text"
                value={filterSite}
                onChange={(e) => { setFilterSite(e.target.value); setPage(0) }}
                placeholder="输入域名..."
                className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none w-36"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">关注级别</span>
              <select value={filterFocus} onChange={(e) => { setFilterFocus(e.target.value); setPage(0) }} className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                <option value="">全部</option>
                <option value="1">重点</option>
                <option value="2">侧重</option>
                <option value="3">普通</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">状态</span>
              <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0) }} className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                <option value="">全部</option>
                <option value="normal">正常</option>
                <option value="warning">下跌</option>
                <option value="danger">危险</option>
                <option value="rising">涨入</option>
              </select>
            </div>
            <span className="ml-auto text-xs text-gray-400">共 {visibleRows.length} 条</span>
          </div>
          {crawlMsg && (
            <p className={`text-xs px-4 py-2 border-b border-gray-100 ${crawlMsg.ok ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50'}`}>
              {crawlMsg.domain}：{crawlMsg.text}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-th">域名</th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">当前收录{sortIcons('latest')}</div></th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">周变化{sortIcons('weeklyChange')}</div></th>
                  <th className="table-th text-center">30天趋势</th>
                  <th className="table-th text-center">状态</th>
                  <th className="table-th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedVisible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-td text-center text-gray-400 py-10">{rows.length === 0 ? '暂无收录数据' : '没有匹配的站点'}</td>
                  </tr>
                ) : (
                  sortedVisible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row) => {
                    const s = statusConfig[row.status]
                    const isPos = row.weeklyChange >= 0
                    return (
                      <tr key={row.site_id} className="hover:bg-gray-100 transition-colors" style={{ borderLeft: groupColorMap.has(row.domain) ? `4px solid ${groupColorMap.get(row.domain)}` : '4px solid transparent' }}>
                        <td className="table-td">
                          <span className="font-medium text-gray-900">{row.domain}</span>
                          {row.name && <span className="text-gray-400"> · {row.name}</span>}
                        </td>
                        <td className="table-td text-center font-semibold text-gray-900">{row.latest.toLocaleString()}</td>
                        <td className={`table-td text-center font-medium ${row.weeklyChange !== 0 ? (isPos ? 'text-green-600' : 'text-red-600') : 'text-gray-400'}`}>
                          {row.weeklyChange !== 0 ? (isPos ? '+' : '') + row.weeklyChange.toLocaleString() : '-'}
                        </td>
                        <td className="table-td text-center">
                          <Sparkline data={row.trend} />
                        </td>
                        <td className="table-td text-center">
                          <span className={s.className}>{s.label}</span>
                        </td>
                        <td className="table-td text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setSelectedSite(row)}
                              className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors"
                            >
                              查看
                            </button>
                            {role !== 'normal' && (
                              <button
                                onClick={() => crawling !== row.domain && triggerCrawl(row.domain)}
                                disabled={crawling === row.domain}
                                className="text-xs text-gray-400 hover:text-blue-600 border border-gray-200 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors disabled:opacity-40"
                              >
                                {crawling === row.domain ? '抓取中…' : '重抓'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <SimplePagination page={page} total={sortedVisible.length} onChange={setPage} />
          </>
        )}
      </div>

      {/* Detail Chart Modal */}
      {selectedSite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="font-semibold text-gray-900">{selectedSite.domain} · 收录趋势</h3>
                <p className="text-xs text-gray-400 mt-0.5">近30天百度收录变化</p>
              </div>
              <button onClick={() => setSelectedSite(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="flex gap-6 mb-4 text-sm">
                <div><span className="text-gray-400">当前收录</span><p className="text-xl font-bold text-gray-900">{selectedSite.latest.toLocaleString()}</p></div>
                <div><span className="text-gray-400">周变化</span><p className={`text-xl font-bold ${selectedSite.weeklyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>{selectedSite.weeklyChange !== 0 ? (selectedSite.weeklyChange >= 0 ? '+' : '') + selectedSite.weeklyChange.toLocaleString() : '-'}</p></div>
              </div>
              {selectedSite.trend.length >= 2 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={selectedSite.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={60} tickFormatter={(v) => v >= 10000 ? (v / 10000).toFixed(1) + 'w' : v} />
                    <Tooltip formatter={(v) => typeof v === 'number' ? v.toLocaleString() : v} />
                    <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">数据积累中，每天跑 cron 后会有更多数据点</div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
