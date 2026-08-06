'use client'

import React, { useState, useEffect } from 'react'

// ── Helper components ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const colors =
    rank === 1 ? 'bg-yellow-400 text-yellow-900' :
    rank === 2 ? 'bg-gray-300 text-gray-700' :
    rank === 3 ? 'bg-orange-400 text-white' :
    'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold flex-shrink-0 ${colors}`}>
      {rank}
    </span>
  )
}

function SectionHeader({ title, color, updatedAt }: { title: string; color: string; updatedAt: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`w-1 h-5 rounded-full ${color}`} />
      <h2 className="text-base font-bold text-gray-800">{title}</h2>
      <span className="text-xs text-gray-400 ml-auto">{updatedAt} 更新</span>
    </div>
  )
}

function Card({ title, subtitle, icon, list, footer, accent }: {
  title: string; subtitle?: string; icon: string
  list: React.ReactNode; footer?: React.ReactNode; accent?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className={`px-4 py-3 border-b border-gray-100 ${accent || 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
          </div>
        </div>
      </div>
      <div className="px-4 py-2">
        {list}
      </div>
      <div className="px-4 pb-3 min-h-[36px]">
        {footer}
      </div>
    </div>
  )
}

function MoreModal({ title, items, onClose }: { title: string; items: React.ReactNode[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-1">
          <ul>{items}</ul>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 flex-shrink-0 text-center">
          <span className="text-xs text-gray-400">共 {items.length} 条</span>
        </div>
      </div>
    </div>
  )
}

function MoreButton({ total, shown, onClick }: { total: number; shown: number; onClick: () => void }) {
  if (total <= shown) return null
  return (
    <button
      onClick={onClick}
      className="w-full mt-2 py-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors border border-dashed border-gray-200 rounded-lg"
    >
      查看全部 {total} 条
    </button>
  )
}

// ── 月度趋势（2026-08-06 从规则中心移过来——本质是跨站点趋势发现，放"近期
// 榜单"更贴切，不是规则中心那种单站点研究逻辑）────────────────────────────

interface MonthlyTrendPoint { month: string; app: number; game: number }
interface MonthlyDrillItem { keyword: string; contentType: string; volume: number; domains: string[] }
interface MonthlyRankChangeItem { keyword: string; type: string; volume: number; domains: string[] }
interface MonthlyStreakItem { keyword: string; domain: string; type: string; volume: number; streak: number; dates: string[] }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
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

function MonthlyTrendTab() {
  const [months, setMonths] = useState<MonthlyTrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [chartYear, setChartYear] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [drillMonth, setDrillMonth] = useState<string | null>(null)
  const [drillData, setDrillData] = useState<MonthlyDrillData | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)
  const [domainModal, setDomainModal] = useState<{ title: string; domains: string[] } | null>(null)

  useEffect(() => {
    fetch('/api/charts/monthly-trend').then(r => r.json()).then(d => setMonths(d.months ?? [])).finally(() => setLoading(false))
  }, [])

  // 数据一到手默认选最新年份+自动打开最新月份，不用用户手动点
  useEffect(() => {
    if (months.length === 0) return
    const latestYear = months[months.length - 1].month.slice(0, 4)
    setChartYear(latestYear)
    setFilterYear(latestYear)
    openDrill(months[months.length - 1].month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months])

  function openDrill(month: string) {
    setDrillMonth(month)
    setDrillLoading(true)
    setDrillData(null)
    fetch(`/api/charts/monthly-trend?month=${month}`).then(r => r.json()).then(d => setDrillData({
      app: d.app ?? [], game: d.game ?? [], rankup: d.rankup ?? [], rankdown: d.rankdown ?? [], continuousTrend: d.continuousTrend ?? [],
      volumeRising: d.volumeRising ?? [], volumeFalling: d.volumeFalling ?? [], domainWeights: d.domainWeights ?? {},
    })).finally(() => setDrillLoading(false))
  }

  function openDomainModal(title: string, domains: string[]) {
    setDomainModal({ title, domains })
  }

  if (loading) return <Spinner />

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
              <select value={chartYear} onChange={e => setChartYear(e.target.value)}
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
              <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
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

      {drillMonth && (drillLoading || !drillData ? <Spinner /> : (
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
              <span className="text-sm font-semibold text-gray-700">{drillMonth} 排名连续涨跌（同一个词在同一个站，这个月连续多天同向变化）</span>
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
                        <button onClick={() => openDomainModal(`${i.keyword} · 连续${i.streak}天（${i.dates.join('、')}）`, [i.domain])}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">查看</button>
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
                        <button onClick={() => openDomainModal(`${i.keyword} · 连续${i.streak}天（${i.dates.join('、')}）`, [i.domain])}
                          className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      {domainModal && <DomainListModal title={domainModal.title} domains={domainModal.domains} weights={drillData?.domainWeights ?? {}} onClose={() => setDomainModal(null)} />}
    </div>
  )
}

// ── 新游榜单（TapTap + 好游快爆，原来这个页面唯一的内容）───────────────────

interface HotItem { rank: number; name: string; labels: string[] }
interface TodayGame { title: string; tag: string; startDate: string; startTime: string; endDate: string; rating: number | null; labels: string[]; icon: string }
interface HaoyouItem { name: string; tags: string[]; score: string; status: string; url: string; btnText: string; date: string }
interface HaoyouHotItem { rank: number; name: string; tags: string[] }
interface ModalState { title: string; items: React.ReactNode[] }

const haoyouTagColors: Record<string, string> = {
  '限量测试': 'bg-purple-100 text-purple-700',
  '公测': 'bg-teal-100 text-teal-700',
  '测试招募': 'bg-orange-100 text-orange-700',
  '测试': 'bg-orange-100 text-orange-600',
  '预下载': 'bg-blue-100 text-blue-600',
  '首发': 'bg-green-100 text-green-700',
  '上线': 'bg-green-100 text-green-700',
  '预约': 'bg-blue-100 text-blue-600',
  '下载': 'bg-gray-100 text-gray-600',
  '更新': 'bg-gray-100 text-gray-600',
}

function deriveHaoyouTag(status: string, btnText: string): string {
  if (status.includes('限量测试') || status.includes('限测')) return '限量测试'
  if (status.includes('公测') || status.includes('不限量')) return '公测'
  if (status.includes('测试招募')) return '测试招募'
  if (status.includes('测试')) return '测试'
  if (status.includes('预下载')) return '预下载'
  if (status.includes('正式上线') || status.includes('首发')) return '首发'
  if (status.includes('上线')) return '上线'
  if (status.includes('更新')) return '更新'
  return btnText || ''
}

function HaoyouGameItem({ g, hideDownload }: { g: HaoyouItem; hideDownload?: boolean }) {
  const rawTag = deriveHaoyouTag(g.status, g.btnText)
  const tag = hideDownload ? (rawTag === '下载' || !rawTag ? '更新' : rawTag) : rawTag
  return (
    <li className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <p className="flex-1 text-xs text-gray-900 truncate min-w-0">
        {g.date && <span className="text-gray-400 font-normal">{g.date} · </span>}
        {g.name}
        {g.status && <span className="text-gray-400 font-normal"> · {g.status}</span>}
      </p>
      {tag && (
        <span className={`text-xs px-1.5 h-5 inline-flex items-center rounded-full font-medium flex-shrink-0 ${haoyouTagColors[tag] || 'bg-gray-100 text-gray-500'}`}>
          {tag}
        </span>
      )}
    </li>
  )
}

const tagColors2: Record<string, string> = {
  '首发': 'bg-green-100 text-green-700',
  '新游预约': 'bg-blue-100 text-blue-700',
  '限量测试': 'bg-purple-100 text-purple-700',
  '测试招募': 'bg-orange-100 text-orange-700',
  '付费测试': 'bg-orange-100 text-orange-700',
  '公测': 'bg-teal-100 text-teal-700',
  '更新': 'bg-gray-100 text-gray-600',
  '活动': 'bg-pink-100 text-pink-700',
}

function GameItem({ g, showDate }: { g: TodayGame; showDate?: boolean }) {
  const timeStr = showDate && g.startDate ? g.startDate : g.startTime || g.startDate
  return (
    <li className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <p className="flex-1 text-xs text-gray-900 truncate min-w-0">
        {timeStr && <span className="text-gray-400 font-normal">{timeStr} · </span>}
        {g.title}
        {g.labels.length > 0 && <span className="text-gray-400 font-normal"> · {g.labels[0]}</span>}
      </p>
      <span className={`text-xs px-1.5 h-5 inline-flex items-center rounded-full font-medium flex-shrink-0 ${tagColors2[g.tag] || 'bg-gray-100 text-gray-500'}`}>{g.tag}</span>
    </li>
  )
}

function NewGamesTab() {
  const [hotItems, setHotItems] = useState<HotItem[]>([])
  const [hotLoading, setHotLoading] = useState(true)
  const [todayGames, setTodayGames] = useState<TodayGame[]>([])
  const [upcomingGames, setUpcomingGames] = useState<TodayGame[]>([])
  const [topEvents, setTopEvents] = useState<TodayGame[]>([])
  const [todayLoading, setTodayLoading] = useState(true)
  const [hotUpdatedAt, setHotUpdatedAt] = useState('')

  const [haoyouUpcomingToday, setHaoyouUpcomingToday] = useState<HaoyouItem[]>([])
  const [haoyouUpcoming, setHaoyouUpcoming] = useState<HaoyouItem[]>([])
  const [haoyouBaoliao, setHaoyouBaoliao] = useState<HaoyouItem[]>([])
  const [haoyouUpdates, setHaoyouUpdates] = useState<HaoyouItem[]>([])
  const [haoyouHotItems, setHaoyouHotItems] = useState<HaoyouHotItem[]>([])
  const [haoyouLoading, setHaoyouLoading] = useState(true)
  const [haoyouUpdatedAt, setHaoyouUpdatedAt] = useState('')

  const [modal, setModal] = useState<ModalState | null>(null)

  useEffect(() => {
    const now = new Date()
    const ts = `${String(now.getMonth() + 1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    fetch('/api/charts/taptap-hot')
      .then((r) => r.json())
      .then((d) => { setHotItems(d.items ?? []); setHotUpdatedAt(ts) })
      .catch(() => {})
      .finally(() => setHotLoading(false))

    fetch('/api/charts/taptap-today')
      .then((r) => r.json())
      .then((d) => {
        setTodayGames(d.todayGames ?? [])
        setUpcomingGames(d.upcomingGames ?? [])
        setTopEvents(d.topEvents ?? [])
      })
      .catch(() => {})
      .finally(() => setTodayLoading(false))

    fetch('/api/charts/haoyou')
      .then((r) => r.json())
      .then((d) => {
        setHaoyouUpcomingToday(d.upcomingToday ?? [])
        setHaoyouUpcoming(d.upcoming ?? [])
        setHaoyouBaoliao(d.baoliao ?? [])
        setHaoyouUpdates(d.updates ?? [])
        setHaoyouHotItems(d.hotItems ?? [])
        setHaoyouUpdatedAt(ts)
      })
      .catch(() => {})
      .finally(() => setHaoyouLoading(false))
  }, [])

  function openModal(title: string, items: React.ReactNode[]) {
    setModal({ title, items })
  }

  const PREVIEW = 10

  // Pre-build ranked list items for reuse
  const hotItemNodes = hotItems.map((g) => (
    <li key={g.rank} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <RankBadge rank={g.rank} />
      <p className="flex-1 text-xs font-medium text-gray-800 truncate">{g.name}</p>
      {g.labels.length > 0 && (
        <span className={`text-xs px-1.5 rounded-full flex-shrink-0 ${
          g.labels[0] === '上升' ? 'bg-orange-100 text-orange-600' :
          g.labels[0] === '首发' ? 'bg-green-100 text-green-700' :
          'bg-purple-100 text-purple-700'
        }`}>{g.labels[0]}</span>
      )}
    </li>
  ))

  const haoyouHotNodes = haoyouHotItems.map((g) => (
    <li key={g.rank} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <RankBadge rank={g.rank} />
      <p className="flex-1 text-xs font-medium text-gray-800 truncate">{g.name}</p>
      {g.tags[0] && (
        <span className="text-xs px-1.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">{g.tags[0]}</span>
      )}
    </li>
  ))

  return (
    <div className="space-y-10">
      {/* ── TapTap ── */}
      <div>
        <SectionHeader title="TapTap" color="bg-teal-500" updatedAt={hotUpdatedAt || '加载中…'} />
        <div className="grid grid-cols-3 gap-5">

          {/* 今日游戏 */}
          <Card
            title={`今日游戏${todayGames.length ? ` · ${todayGames.length} 款` : ''}`}
            subtitle="首发 / 新游预约 / 测试" icon="🎮" accent="bg-teal-50"
            list={todayLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p> : (
              <>
                {topEvents.length > 0 && (
                  <button
                    onClick={() => openModal('近期焦点', topEvents.map((g, i) => <GameItem key={i} g={g} showDate />))}
                    className="w-full h-8 flex items-center justify-between px-3 mb-0.5 bg-teal-50 hover:bg-teal-100 border border-teal-100 rounded-lg transition-colors"
                  >
                    <span className="text-xs font-semibold text-teal-700">近期焦点 · {topEvents.length} 条</span>
                    <span className="text-xs text-teal-500">查看 ›</span>
                  </button>
                )}
                {todayGames.length === 0
                  ? <p className="text-xs text-gray-400 py-3 text-center">暂无数据</p>
                  : <ul>{todayGames.slice(0, topEvents.length > 0 ? PREVIEW - 1 : PREVIEW).map((g, i) => <GameItem key={i} g={g} />)}</ul>}
              </>
            )}
            footer={!todayLoading && todayGames.length > (topEvents.length > 0 ? PREVIEW - 1 : PREVIEW)
              ? <MoreButton total={todayGames.length} shown={topEvents.length > 0 ? PREVIEW - 1 : PREVIEW} onClick={() => openModal(`今日游戏 · ${todayGames.length} 款`, todayGames.map((g, i) => <GameItem key={i} g={g} />))} />
              : undefined}
          />

          {/* 即将上线 */}
          <Card
            title={`即将上线${upcomingGames.length ? ` · ${upcomingGames.length} 款` : ''}`}
            subtitle="未来 30 天预约 / 首发" icon="📅" accent="bg-teal-50"
            list={todayLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p>
              : upcomingGames.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
              : <ul>{upcomingGames.slice(0, PREVIEW).map((g, i) => <GameItem key={i} g={g} showDate />)}</ul>}
            footer={!todayLoading && upcomingGames.length > PREVIEW
              ? <MoreButton total={upcomingGames.length} shown={PREVIEW} onClick={() => openModal(`即将上线 · ${upcomingGames.length} 款`, upcomingGames.map((g, i) => <GameItem key={i} g={g} showDate />))} />
              : undefined}
          />

          {/* 热搜榜 */}
          <Card
            title="热搜榜 TOP 20" subtitle="每 20 分钟更新" icon="🔥" accent="bg-teal-50"
            list={hotLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p>
              : hotItems.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
              : <ul>{hotItemNodes.slice(0, PREVIEW)}</ul>}
            footer={!hotLoading && hotItemNodes.length > PREVIEW
              ? <MoreButton total={hotItemNodes.length} shown={PREVIEW} onClick={() => openModal('TapTap 热搜榜', hotItemNodes)} />
              : undefined}
          />

        </div>
      </div>

      {/* ── 好游快爆 ── */}
      <div>
        <SectionHeader title="好游快爆" color="bg-green-500" updatedAt={haoyouUpdatedAt || '加载中…'} />
        <div className="grid grid-cols-3 gap-5">

          {/* 即将上线 */}
          {(() => {
            const allUpcoming = [...haoyouUpcomingToday, ...haoyouUpcoming]
            const hasBaoliao = haoyouBaoliao.length > 0
            const preview = hasBaoliao ? PREVIEW - 1 : PREVIEW
            return (
              <Card
                title={`即将上线${allUpcoming.length ? ` · ${allUpcoming.length} 款` : ''}`}
                subtitle="手机游戏 / 免费" icon="🚀" accent="bg-green-50"
                list={haoyouLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p> : (
                  <>
                    {hasBaoliao && (
                      <button
                        onClick={() => openModal('好游快爆 抢先爆料', haoyouBaoliao.map((g, i) => <HaoyouGameItem key={i} g={g} />))}
                        className="w-full h-8 flex items-center justify-between px-3 mb-0.5 bg-green-50 hover:bg-green-100 border border-green-100 rounded-lg transition-colors"
                      >
                        <span className="text-xs font-semibold text-green-700">抢先爆料 · {haoyouBaoliao.length} 条</span>
                        <span className="text-xs text-green-500">查看 ›</span>
                      </button>
                    )}
                    {allUpcoming.length === 0
                      ? <p className="text-xs text-gray-400 py-3 text-center">暂无数据</p>
                      : <ul>{allUpcoming.slice(0, preview).map((g, i) => <HaoyouGameItem key={i} g={g} />)}</ul>}
                  </>
                )}
                footer={!haoyouLoading && allUpcoming.length > preview
                  ? <MoreButton total={allUpcoming.length} shown={preview} onClick={() => openModal(`好游快爆 即将上线 · ${allUpcoming.length} 款`, allUpcoming.map((g, i) => <HaoyouGameItem key={i} g={g} />))} />
                  : undefined}
              />
            )
          })()}

          {/* 即将更新 */}
          <Card
            title={`即将更新${haoyouUpdates.length ? ` · ${haoyouUpdates.length} 款` : ''}`}
            subtitle="手机游戏 / 免费" icon="🔄" accent="bg-green-50"
            list={haoyouLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p>
              : haoyouUpdates.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
              : <ul>{haoyouUpdates.slice(0, PREVIEW).map((g, i) => <HaoyouGameItem key={i} g={g} hideDownload />)}</ul>}
            footer={!haoyouLoading && haoyouUpdates.length > PREVIEW
              ? <MoreButton total={haoyouUpdates.length} shown={PREVIEW} onClick={() => openModal(`好游快爆 即将更新 · ${haoyouUpdates.length} 款`, haoyouUpdates.map((g, i) => <HaoyouGameItem key={i} g={g} hideDownload />))} />
              : undefined}
          />

          {/* 热门榜 */}
          <Card
            title="热门榜 TOP 20" subtitle="实时热门游戏" icon="🔥" accent="bg-green-50"
            list={haoyouLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p>
              : haoyouHotItems.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
              : <ul>{haoyouHotNodes.slice(0, PREVIEW)}</ul>}
            footer={!haoyouLoading && haoyouHotNodes.length > PREVIEW
              ? <MoreButton total={haoyouHotNodes.length} shown={PREVIEW} onClick={() => openModal('好游快爆 热门榜', haoyouHotNodes)} />
              : undefined}
          />

        </div>
      </div>

      {modal && <MoreModal title={modal.title} items={modal.items} onClose={() => setModal(null)} />}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const [activeTab, setActiveTab] = useState<'monthlyTrend' | 'newGames'>('monthlyTrend')

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900">近期榜单</h1>
        <p className="text-gray-500 text-sm mt-1">TapTap · 好游快爆 榜单汇总 · 月度趋势</p>
      </div>

      <div className="flex border-b border-gray-100 my-6">
        <button onClick={() => setActiveTab('monthlyTrend')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'monthlyTrend' ? 'text-rose-600 border-rose-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
          月度趋势
        </button>
        <button onClick={() => setActiveTab('newGames')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'newGames' ? 'text-teal-600 border-teal-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
          新游榜单
        </button>
      </div>

      <div>
        {activeTab === 'monthlyTrend' ? <MonthlyTrendTab /> : <NewGamesTab />}
      </div>
    </div>
  )
}
