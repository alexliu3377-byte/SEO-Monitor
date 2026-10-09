'use client'

import { useEffect, useRef, useState } from 'react'

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
    </div>
  )
}

// 跨站点月度趋势，可嵌入趋势发现等工作区。

interface MonthlyTrendPoint { month: string; app: number; game: number }
interface MonthlyDrillItem { keyword: string; contentType: string; volume: number; domains: string[] }
interface MonthlyRankChangeItem { keyword: string; type: string; volume: number; domains: string[] }
interface StreakSite { domain: string; streak: number; volume: number; dates: string[] }
interface MonthlyStreakItem { keyword: string; type: string; volume: number; streak: number; siteCount: number; sites: StreakSite[] }
interface MonthlyVolumeChangeItem { keyword: string; volume: number; volumeChange: number; domains: string[] }
interface MonthlyDrillData {
  app: MonthlyDrillItem[]; game: MonthlyDrillItem[]
  rankup: MonthlyRankChangeItem[]; rankdown: MonthlyRankChangeItem[]
  continuousTrend: MonthlyStreakItem[]
  volumeRising: MonthlyVolumeChangeItem[]; volumeFalling: MonthlyVolumeChangeItem[]
  domainWeights: Record<string, { pc: number; mobile: number }>
}

// 跟分组任务详情弹窗（app/(dashboard)/task-groups/page.tsx 的"共新增词"/"竞品涨
// 排名"面板）同一个展示方式——域名下面带一行 PC/M权重，不是单纯罗列域名。
function DomainListModal({ title, domains, weights, onClose }: { title: string; domains: string[]; weights: Record<string, { pc: number; mobile: number }>; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800 truncate">{title}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-5 py-3 max-h-64 overflow-y-auto flex flex-wrap gap-1.5">
          {domains.map(d => {
            const w = weights[d]
            return (
              <span key={d} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-2 py-1 text-gray-700">
                <span className="flex flex-col leading-tight">
                  <span>{d}</span>
                  {w && <span className="text-[10px] text-gray-400">PC{w.pc} · M{w.mobile}</span>}
                </span>
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// 排名连续涨跌"查看"——同一个词可能跨多个站点都在连续涨/跌，展示全部
// 站点各自连续了多少天，而不是像 DomainListModal 那样只罗列域名。
function StreakSitesModal({ title, siteCount, sites, onClose }: { title: string; siteCount: number; sites: StreakSite[]; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800 truncate">{title}</span>
          <span className="text-xs text-gray-400 flex-shrink-0 ml-2">共{siteCount}站</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-5 py-3 max-h-72 overflow-y-auto divide-y divide-gray-50">
          {sites.map(s => (
            <div key={s.domain} className="py-2 flex items-center justify-between text-sm">
              <span className="text-gray-700 truncate">{s.domain}</span>
              <span className="text-xs text-gray-400 flex-shrink-0 ml-2">连续{s.streak}天 · {s.volume.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function MonthlyTrendTab() {
  const [months, setMonths] = useState<MonthlyTrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [chartYear, setChartYear] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [drillMonth, setDrillMonth] = useState<string | null>(null)
  const [drillData, setDrillData] = useState<MonthlyDrillData | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState('')
  const [domainModal, setDomainModal] = useState<{ title: string; domains: string[] } | null>(null)
  const [streakModal, setStreakModal] = useState<{ title: string; siteCount: number; sites: StreakSite[] } | null>(null)
  const drillController = useRef<AbortController | null>(null)
  const defaultMonthRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch('/api/charts/monthly-trend', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '月度趋势读取失败')
        defaultMonthRef.current = typeof data.defaultMonth === 'string' ? data.defaultMonth : null
        setMonths(data.months ?? [])
      })
      .catch(loadError => {
        if ((loadError as Error).name !== 'AbortError') setError((loadError as Error).message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reloadKey])

  useEffect(() => () => drillController.current?.abort(), [])

  // 最新月明细已经由定时任务预热时才自动打开。缓存还没准备好时只展示轻量
  // 概览，避免组员打开页面就触发六个串行聚合查询。
  useEffect(() => {
    if (months.length === 0) return
    const latestYear = months[months.length - 1].month.slice(0, 4)
    setChartYear(latestYear)
    setFilterYear(latestYear)
    if (defaultMonthRef.current) openDrill(defaultMonthRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months])

  function openDrill(month: string) {
    drillController.current?.abort()
    const controller = new AbortController()
    drillController.current = controller
    setDrillMonth(month)
    setDrillLoading(true)
    setDrillError('')
    setDrillData(null)
    fetch(`/api/charts/monthly-trend?month=${month}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '该月趋势明细读取失败')
        setDrillData({
          app: data.app ?? [], game: data.game ?? [], rankup: data.rankup ?? [], rankdown: data.rankdown ?? [], continuousTrend: data.continuousTrend ?? [],
          volumeRising: data.volumeRising ?? [], volumeFalling: data.volumeFalling ?? [], domainWeights: data.domainWeights ?? {},
        })
      })
      .catch(loadError => {
        if ((loadError as Error).name !== 'AbortError') setDrillError((loadError as Error).message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setDrillLoading(false)
      })
  }

  function openDomainModal(title: string, domains: string[]) {
    setDomainModal({ title, domains })
  }

  if (loading) return <Spinner />

  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
        <span>{error}</span>
        <button type="button" onClick={() => setReloadKey(value => value + 1)} className="h-8 flex-none rounded-md border border-red-200 bg-white px-3 text-xs font-medium hover:bg-red-50">重试</button>
      </div>
    )
  }

  const years = Array.from(new Set(months.map(m => m.month.slice(0, 4))))
  const chartMonths = months.filter(m => m.month.startsWith(chartYear))
  const filterMonths = months.filter(m => m.month.startsWith(filterYear))

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">全部监控站点按月汇总新增关键词数量（应用/游戏），用来发现"哪个月哪个类目在涨"这种跨站点规律。</p>
      {months.length === 0 ? (
        <p className="text-sm text-gray-300 text-center py-10">暂无数据</p>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
            <div className="flex items-center justify-between mb-5">
              <span className="text-sm font-semibold text-gray-700">类目占比</span>
              <select aria-label="选择选项" value={chartYear} onChange={e => setChartYear(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg pl-2.5 pr-1.5 py-1 bg-white text-gray-700">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {chartMonths.length === 0 ? (
              <p className="text-sm text-gray-300 text-center py-10">{chartYear}年暂无数据</p>
            ) : (
              <div className="flex items-end gap-6 overflow-x-auto px-1">
                {chartMonths.map(m => {
                  const total = m.app + m.game
                  const appPct = total === 0 ? 0 : Math.round(m.app / total * 100)
                  const gamePct = total === 0 ? 0 : 100 - appPct
                  return (
                    <div key={m.month} className="flex flex-col items-center gap-2 flex-shrink-0">
                      <div className="flex items-end gap-1.5 h-32">
                        <div className="flex flex-col items-center justify-end h-full">
                          {appPct > 0 && <span className="text-[11px] text-sky-600 font-medium mb-1">{appPct}%</span>}
                          <div className="w-6 bg-sky-500 rounded-t transition-all" style={{ height: `${appPct}%` }} />
                        </div>
                        <div className="flex flex-col items-center justify-end h-full">
                          {gamePct > 0 && <span className="text-[11px] text-violet-600 font-medium mb-1">{gamePct}%</span>}
                          <div className="w-6 bg-violet-500 rounded-t transition-all" style={{ height: `${gamePct}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-gray-500">{parseInt(m.month.slice(5), 10)}月</span>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-50">
              <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" />应用</span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" />游戏</span>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2.5">
              <select aria-label="选择选项" value={filterYear} onChange={e => setFilterYear(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg pl-2.5 pr-1.5 py-1 bg-white text-gray-700">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {filterMonths.length === 0 ? (
              <p className="text-sm text-gray-300 py-4">{filterYear}年暂无数据</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {filterMonths.map(m => (
                  <button key={m.month} onClick={() => openDrill(m.month)}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${drillMonth === m.month ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                    {parseInt(m.month.slice(5), 10)}月
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {drillMonth && (drillError ? (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{drillError}</span>
          <button type="button" onClick={() => openDrill(drillMonth)} className="h-8 flex-none rounded-md border border-red-200 bg-white px-3 text-xs font-medium hover:bg-red-50">重试本月</button>
        </div>
      ) : drillLoading || !drillData ? <Spinner /> : (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
              <span className="text-sm font-semibold text-gray-700">{drillMonth} 热门新增词（按搜索量排序）</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div>
                <p className="text-xs font-medium text-blue-600 px-4 py-2 bg-blue-50/40">应用</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                  {drillData.app.length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.app.map(i => (
                    <div key={i.keyword} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-gray-400">{i.volume.toLocaleString()}</span>
                        <button onClick={() => openDomainModal(`${i.keyword} · 新增`, i.domains)}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">{i.domains.length}站 查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-purple-600 px-4 py-2 bg-purple-50/40">游戏</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                  {drillData.game.length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.game.map(i => (
                    <div key={i.keyword} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-gray-400">{i.volume.toLocaleString()}</span>
                        <button onClick={() => openDomainModal(`${i.keyword} · 新增`, i.domains)}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">{i.domains.length}站 查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
              <span className="text-sm font-semibold text-gray-700">{drillMonth} 涨跌词（按搜索量排序，不分站点汇总）</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div>
                <p className="text-xs font-medium text-green-600 px-4 py-2 bg-green-50/40">涨入</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                  {drillData.rankup.length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.rankup.map(i => (
                    <div key={i.keyword} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-gray-400">{i.volume.toLocaleString()}</span>
                        <button onClick={() => openDomainModal(`${i.keyword} · 涨入`, i.domains)}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">{i.domains.length}站 查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-red-500 px-4 py-2 bg-red-50/40">跌出</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                  {drillData.rankdown.length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.rankdown.map(i => (
                    <div key={i.keyword} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-gray-400">{i.volume.toLocaleString()}</span>
                        <button onClick={() => openDomainModal(`${i.keyword} · 跌出`, i.domains)}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">{i.domains.length}站 查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
              <span className="text-sm font-semibold text-gray-700">{drillMonth} 搜索量变动（跟这个月涨跌词有关联的关键词，现在的搜索需求走势）</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div>
                <p className="text-xs font-medium text-green-600 px-4 py-2 bg-green-50/40">上涨</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                  {drillData.volumeRising.length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.volumeRising.map(i => (
                    <div key={i.keyword} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-gray-400">{i.volume.toLocaleString()}<span className="text-green-600 ml-1">+{i.volumeChange.toLocaleString()}</span></span>
                        <button onClick={() => openDomainModal(`${i.keyword} · 搜索量上涨`, i.domains)}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">{i.domains.length}站 查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-red-500 px-4 py-2 bg-red-50/40">下跌</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                  {drillData.volumeFalling.length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.volumeFalling.map(i => (
                    <div key={i.keyword} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-gray-400">{i.volume.toLocaleString()}<span className="text-red-500 ml-1">{i.volumeChange.toLocaleString()}</span></span>
                        <button onClick={() => openDomainModal(`${i.keyword} · 搜索量下跌`, i.domains)}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">{i.domains.length}站 查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
              <span className="text-sm font-semibold text-gray-700">{drillMonth} 排名连续涨跌（同一个词，这个月连续多天同向变化；多个站点都有的话，只展示连续天数最高的一个，"查看"里看各站明细）</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div>
                <p className="text-xs font-medium text-green-600 px-4 py-2 bg-green-50/40">连续上涨</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                  {drillData.continuousTrend.filter(i => i.type === 'rankup').length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.continuousTrend.filter(i => i.type === 'rankup').map((i, idx) => (
                    <div key={idx} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-gray-400">连续{i.streak}天 · {i.volume.toLocaleString()}</span>
                        <button onClick={() => setStreakModal({ title: `${i.keyword} · 连续上涨`, siteCount: i.siteCount, sites: i.sites })}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">{i.siteCount}站 查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-red-500 px-4 py-2 bg-red-50/40">连续下跌</p>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                  {drillData.continuousTrend.filter(i => i.type === 'rankdown').length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.continuousTrend.filter(i => i.type === 'rankdown').map((i, idx) => (
                    <div key={idx} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-gray-400">连续{i.streak}天 · {i.volume.toLocaleString()}</span>
                        <button onClick={() => setStreakModal({ title: `${i.keyword} · 连续下跌`, siteCount: i.siteCount, sites: i.sites })}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">{i.siteCount}站 查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      {!drillMonth && months.length > 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
          选择上方月份查看趋势明细
        </div>
      )}

      {domainModal && <DomainListModal title={domainModal.title} domains={domainModal.domains} weights={drillData?.domainWeights ?? {}} onClose={() => setDomainModal(null)} />}
      {streakModal && <StreakSitesModal title={streakModal.title} siteCount={streakModal.siteCount} sites={streakModal.sites} onClose={() => setStreakModal(null)} />}
    </div>
  )
}
