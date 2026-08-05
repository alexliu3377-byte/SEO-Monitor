'use client'

import { useEffect, useState, useMemo } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Group {
  id: string; name: string; type: string
  site_domains: string[]; competitor_domains: string[]
  members: { user_id: string; username: string; member_type: string }[]
}

interface SiteFull { id: string; domain: string; name: string; category: string; has_rank_title: boolean; is_enabled: boolean }

interface CompetitorKw {
  keyword: string; search_volume: number; title: string | null
  operation_type: '新增' | '更新'; source: string; content_type: string | null
  content_date: string; source_url?: string | null
}

interface CompetitorOutcomeRow {
  keyword: string; content_type: string | null; content_date: string | null; discovery_date: string
  search_volume: number; rank_volume: number; rank_position: number | null; rank_type: string | null
  operation_type: string; source_url: string | null; index_first_seen: string | null; effectiveness: string
}
interface CompetitorOutcomeSummary { total: number; effective: number; tracking: number; invalid: number }

interface CompetitorData {
  site: { id: string; domain: string; has_rank_title: boolean } | null
  date: string; keywords: CompetitorKw[]
  outcomes: CompetitorOutcomeRow[]; outcomeSummary: CompetitorOutcomeSummary | null
}

interface CompetitorProfileData {
  domain: string; post_start_hour: number | null; post_end_hour: number | null
  post_interval_minutes: number | null
  same_base_diff_sub_is_update: boolean; same_name_diff_date_is_update: boolean
}

type Period = 'yesterday' | 'week' | 'month' | 'custom'
type InnerTab = 'keywords' | 'outcomes'

const PERIOD_LABELS: Record<Period, string> = { yesterday: '昨日', week: '本周', month: '本月', custom: '自定义' }
const KW_PAGE_SIZE = 50

function fmtDate(d: string) { return d ? d.slice(5).replace('-', '/') : '' }
function fmtVol(v: number) {
  if (!v || v <= 0) return '—'
  return v.toLocaleString()
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ── ManageCompetitorsModal ─────────────────────────────────────────────────────

const CAT_LABELS: Record<string, string> = { large: '大站', medium: '中站', small: '小站' }

function ManageCompetitorsModal({ groupName, initialDomains, allSites, onSave, onClose }: {
  groupName: string; initialDomains: string[]; allSites: SiteFull[]
  onSave: (domains: string[]) => Promise<void>; onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialDomains))
  const [search, setSearch] = useState('')
  const [manualInput, setManualInput] = useState('')
  const [saving, setSaving] = useState(false)

  const competitorSites = allSites.filter(s => s.has_rank_title)
  const cats = ['large', 'medium', 'small'] as const

  function toggleDomain(domain: string) {
    setSelected(prev => { const next = new Set(prev); next.has(domain) ? next.delete(domain) : next.add(domain); return next })
  }

  function addManual() {
    const d = manualInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
    if (!d) return
    setSelected(prev => new Set([...Array.from(prev), d]))
    setManualInput('')
  }

  function removeExtra(d: string) {
    setSelected(prev => { const next = new Set(prev); next.delete(d); return next })
  }

  async function handleSave() {
    setSaving(true)
    try { await onSave(Array.from(selected)) } finally { setSaving(false) }
  }

  const knownDomains = new Set(competitorSites.map(s => s.domain))
  const extraDomains = Array.from(selected).filter(d => !knownDomains.has(d))
  const filtered = search ? competitorSites.filter(s => s.domain.includes(search) || (s.name || '').includes(search)) : competitorSites

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-900">管理竞品追踪</h3>
            <p className="text-xs text-gray-400 mt-0.5">{groupName} · 已选 {selected.size} 个站点</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 pt-4 flex-shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索竞品站点…"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700" />
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-3 space-y-4">
          {competitorSites.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              网站管理中暂无开启「排名」的站点<br />
              <span className="text-xs">请先在网站管理中为对应站点开启橙色排名开关</span>
            </p>
          ) : (
            cats.map(cat => {
              const catSites = filtered.filter(s => s.category === cat)
              if (catSites.length === 0) return null
              const allSel = catSites.every(s => selected.has(s.domain))
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{CAT_LABELS[cat]}</span>
                    <button onClick={() => {
                      const next = new Set(selected)
                      allSel ? catSites.forEach(s => next.delete(s.domain)) : catSites.forEach(s => next.add(s.domain))
                      setSelected(next)
                    }} className="text-[11px] text-orange-500 hover:text-orange-600 font-medium">{allSel ? '全取消' : '全选'}</button>
                  </div>
                  <div className="space-y-1">
                    {catSites.map(s => (
                      <button key={s.id} onClick={() => toggleDomain(s.domain)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${selected.has(s.domain) ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-100 hover:bg-gray-50'}`}>
                        <span className={`w-5 h-5 flex-shrink-0 rounded-md flex items-center justify-center transition-all ${selected.has(s.domain) ? 'bg-orange-500 border-2 border-orange-500' : 'border-2 border-gray-200 bg-white'}`}>
                          {selected.has(s.domain) && <svg viewBox="0 0 10 8" className="w-3 h-2.5"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </span>
                        <span className="text-sm text-gray-800 font-medium">{s.domain}</span>
                        {s.name && <span className="text-xs text-gray-400">{s.name}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })
          )}
          {extraDomains.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">手动添加</span>
              <div className="mt-2 space-y-1">
                {extraDomains.map(d => (
                  <div key={d} className="flex items-center gap-3 px-3 py-2 bg-orange-50 border border-orange-100 rounded-lg">
                    <span className="text-sm text-gray-700 font-mono flex-1">{d}</span>
                    <button onClick={() => removeExtra(d)} className="text-gray-400 hover:text-red-500 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 pb-3 flex-shrink-0 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-400 mb-2">添加不在网站管理中的域名（可选）</p>
          <div className="flex gap-2">
            <input value={manualInput} onChange={e => setManualInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManual()}
              placeholder="example.com"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700" />
            <button onClick={addManual} className="px-4 py-2 text-sm font-medium bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors flex-shrink-0">添加</button>
          </div>
        </div>
        <div className="px-6 pb-5 flex justify-end gap-2 border-t border-gray-100 pt-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── CompetitorKeywordsTable ────────────────────────────────────────────────────

function CompetitorKeywordsTable({ keywords }: { keywords: CompetitorKw[] }) {
  const [openDates, setOpenDates] = useState<Set<string>>(new Set())
  const [dateKwPage, setDateKwPage] = useState<Record<string, number>>({})

  if (keywords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-gray-300">
        <svg className="w-9 h-9 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
        <span className="text-sm">当日暂无关键词数据</span>
      </div>
    )
  }

  const byDate = new Map<string, CompetitorKw[]>()
  for (const kw of keywords) {
    const d = kw.content_date || '未知日期'
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(kw)
  }
  const dates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a))

  function toggle(d: string) {
    setOpenDates(prev => { const s = new Set(prev); s.has(d) ? s.delete(d) : s.add(d); return s })
    setDateKwPage(prev => ({ ...prev, [d]: 0 }))
  }

  return (
    <div className="divide-y divide-gray-50">
      {dates.map(date => {
        const kws = byDate.get(date)!
        const isOpen = openDates.has(date)
        const kwPg = dateKwPage[date] ?? 0
        const kwPages = Math.ceil(kws.length / KW_PAGE_SIZE)
        const kwSlice = kws.slice(kwPg * KW_PAGE_SIZE, (kwPg + 1) * KW_PAGE_SIZE)
        const totalVol = kws.reduce((s, k) => s + (k.search_volume || 0), 0)
        return (
          <div key={date}>
            <button className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left" onClick={() => toggle(date)}>
              <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-sm font-medium text-gray-700 w-14 flex-shrink-0">{fmtDate(date)}</span>
              <span className="flex-1" />
              <span className="text-xs text-gray-400 flex-shrink-0">{kws.length} 词</span>
              {totalVol > 0 && <span className="text-xs text-gray-500 font-medium flex-shrink-0 ml-3 w-20 text-right">{fmtVol(totalVol)} 搜索量</span>}
            </button>
            {isOpen && (
              <div className="border-t border-gray-50">
                <div className="grid grid-cols-[1fr_120px_80px_auto] gap-x-3 px-5 py-1.5 bg-gray-50/50 text-[11px] font-medium text-gray-400">
                  <span>关键词</span><span>内容链接</span><span className="text-right">搜索量</span><span className="text-center">类型</span>
                </div>
                {kwSlice.map((kw, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_80px_auto] gap-x-3 items-start px-5 py-2 border-t border-gray-50 hover:bg-gray-50/60 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-gray-800 truncate" title={kw.keyword}>{kw.keyword}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium ${kw.operation_type === '新增' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>{kw.operation_type ?? '新增'}</span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      {kw.source_url
                        ? <a href={kw.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline font-mono truncate block" title={kw.source_url}>
                            {kw.source_url.replace(/^https?:\/\//, '').slice(0, 28)}{kw.source_url.replace(/^https?:\/\//, '').length > 28 ? '…' : ''}
                          </a>
                        : <span className="text-xs text-gray-300">—</span>}
                    </div>
                    <span className="text-sm text-gray-500 text-right tabular-nums">{kw.search_volume ? fmtVol(kw.search_volume) : '—'}</span>
                    <div className="flex justify-center">
                      {kw.content_type
                        ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${kw.content_type === 'app' ? 'bg-blue-50 text-blue-600' : kw.content_type === 'game' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>{kw.content_type}</span>
                        : <span className="text-xs text-gray-300">—</span>}
                    </div>
                  </div>
                ))}
                {kwPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-2 border-t border-gray-100 bg-gray-50/40">
                    <span className="text-xs text-gray-400">{kws.length} 词 · {kwPg + 1}/{kwPages} 页</span>
                    <div className="flex items-center gap-1">
                      <button disabled={kwPg === 0} onClick={() => setDateKwPage(p => ({ ...p, [date]: kwPg - 1 }))}
                        className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors">上 {KW_PAGE_SIZE} 条</button>
                      <button disabled={kwPg >= kwPages - 1} onClick={() => setDateKwPage(p => ({ ...p, [date]: kwPg + 1 }))}
                        className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors">下 {KW_PAGE_SIZE} 条</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── CompetitorOutcomesPanel ────────────────────────────────────────────────────

function CompetitorOutcomesPanel({ site, outcomes, summary, loading }: {
  site: { id: string; domain: string; has_rank_title: boolean } | null
  outcomes: CompetitorOutcomeRow[]; summary: CompetitorOutcomeSummary | null; loading: boolean
}) {
  const [filterType, setFilterType] = useState<'all' | 'app' | 'game'>('all')
  const [filterRank, setFilterRank] = useState<'all' | 'has' | 'top10' | 'none'>('all')
  const [filterKw, setFilterKw] = useState('')
  const [oPage, setOPage] = useState(0)
  const O_PAGE = 50

  if (!site) return <div className="flex justify-center py-14 text-sm text-gray-400">该域名未在网站管理中找到</div>
  if (!site.has_rank_title) return (
    <div className="flex flex-col items-center justify-center py-14 gap-1">
      <span className="text-sm text-gray-400">该竞品未开启排名抓取</span>
      <span className="text-xs text-gray-300">请前往网站管理为 {site.domain} 开启橙色「排名」开关</span>
    </div>
  )

  const filtered = outcomes.filter(r => {
    if (filterType === 'app'  && r.content_type === 'game') return false
    if (filterType === 'game' && r.content_type !== 'game') return false
    if (filterRank === 'has'   && r.rank_position == null) return false
    if (filterRank === 'top10' && (r.rank_position == null || r.rank_position > 10)) return false
    if (filterRank === 'none'  && r.rank_position != null) return false
    if (filterKw && !r.keyword.toLowerCase().includes(filterKw.toLowerCase())) return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / O_PAGE))
  const paged = filtered.slice(oPage * O_PAGE, (oPage + 1) * O_PAGE)

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '追踪记录', value: summary.total, sub: '期间内发现的信号词', color: '' },
            { label: '有效', value: summary.effective, sub: summary.total ? `${Math.round(summary.effective / summary.total * 100)}% 已见效` : '—', color: 'text-green-600' },
            { label: '追踪中', value: summary.tracking, sub: '等待后续信号', color: 'text-orange-500' },
            { label: '无效', value: summary.invalid, sub: '60天内未见效', color: 'text-gray-400' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className={`text-2xl font-bold ${s.color || 'text-gray-800'}`}>{s.value}</div>
              <div className="text-xs font-medium text-gray-600 mt-0.5">{s.label}</div>
              <div className="text-[11px] text-gray-400">{s.sub}</div>
            </div>
          ))}
        </div>
      )}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={filterType} onChange={e => { setFilterType(e.target.value as typeof filterType); setOPage(0) }}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 text-gray-700 bg-white">
            <option value="all">全部类型</option><option value="app">应用</option><option value="game">游戏</option>
          </select>
          <select value={filterRank} onChange={e => { setFilterRank(e.target.value as typeof filterRank); setOPage(0) }}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 text-gray-700 bg-white">
            <option value="all">全部排名</option><option value="has">有排名</option><option value="top10">前10名</option><option value="none">无排名</option>
          </select>
          <input value={filterKw} onChange={e => { setFilterKw(e.target.value); setOPage(0) }}
            placeholder="搜索关键词…"
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 text-gray-700 w-44" />
          <span className="ml-auto text-xs text-gray-400">{filtered.length} 条</span>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          <span className="text-sm font-semibold text-gray-700">动作成效明细</span>
          <span className="text-xs text-gray-400 ml-2">期间内发现词的当前排名情况</span>
        </div>
        {loading ? <Spinner /> : outcomes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-300">
            <span className="text-sm">暂无数据</span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[70px_70px_70px_48px_2fr_60px_70px_88px_1.5fr_60px_58px] gap-x-2 px-4 py-2 bg-gray-50/40 border-b border-gray-100 min-w-[860px]">
                <span className="text-[11px] font-medium text-gray-400 text-center">发布日期</span>
                <span className="text-[11px] font-medium text-gray-400 text-center">发现日期</span>
                <span className="text-[11px] font-medium text-gray-400 text-center">类型</span>
                <span className="text-[11px] font-medium text-gray-400 text-center">操作</span>
                <span className="text-[11px] font-medium text-gray-400">关键词</span>
                <span className="text-[11px] font-medium text-gray-400 text-center">搜索量</span>
                <span className="text-[11px] font-medium text-gray-400 text-center">收录</span>
                <span className="text-[11px] font-medium text-gray-400 text-center">排名</span>
                <span className="text-[11px] font-medium text-gray-400">排名词</span>
                <span className="text-[11px] font-medium text-gray-400 text-center">排名量</span>
                <span className="text-[11px] font-medium text-gray-400 text-center">成效</span>
              </div>
              <div className="divide-y divide-gray-50 min-w-[860px]">
                {paged.map((r, i) => (
                  <div key={i} className="grid grid-cols-[70px_70px_70px_48px_2fr_60px_70px_88px_1.5fr_60px_58px] gap-x-2 px-4 py-2.5 hover:bg-gray-50/60 transition-colors items-center">
                    <span className="text-sm text-gray-500 text-center">{r.content_date ? r.content_date.slice(5).replace('-', '/') : '—'}</span>
                    <span className="text-sm text-gray-500 text-center">{r.discovery_date ? r.discovery_date.slice(5).replace('-', '/') : '—'}</span>
                    <div className="flex justify-center">
                      {r.content_type
                        ? <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${r.content_type === 'game' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>{r.content_type === 'game' ? '游戏' : '应用'}</span>
                        : <span className="text-sm text-gray-300">—</span>}
                    </div>
                    <div className="flex justify-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${r.operation_type === '更新' ? 'bg-orange-50 text-orange-500' : 'bg-green-50 text-green-600'}`}>{r.operation_type}</span>
                    </div>
                    <div className="min-w-0">
                      {r.source_url
                        ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate block" title={r.keyword}>{r.keyword}</a>
                        : <div className="text-sm text-gray-800 truncate" title={r.keyword}>{r.keyword}</div>}
                    </div>
                    <div className="text-sm text-gray-600 tabular-nums text-center">{r.search_volume ? fmtVol(r.search_volume) : '—'}</div>
                    <div className="text-center">
                      {r.index_first_seen
                        ? <span className="text-xs text-teal-600 font-medium">✓</span>
                        : <span className="text-sm text-gray-300">—</span>}
                    </div>
                    <div className="flex items-center justify-center gap-1.5">
                      {r.rank_position != null
                        ? <span className="text-sm text-gray-700">第{r.rank_position}名</span>
                        : <span className="text-sm text-gray-300">—</span>}
                      {r.rank_type === 'rankup' && <span className="text-xs font-semibold text-green-600">↑</span>}
                      {r.rank_type === 'rankdown' && <span className="text-xs font-semibold text-red-400">↓</span>}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-gray-700 truncate" title={r.keyword}>{r.keyword}</div>
                    </div>
                    <div className="text-sm tabular-nums text-center">{r.rank_volume ? fmtVol(r.rank_volume) : <span className="text-gray-300">—</span>}</div>
                    <div className="flex justify-center">
                      {r.effectiveness === '有效'   && <span className="text-xs bg-green-50 text-green-600 border border-green-200 px-1.5 py-0.5 rounded-full">有效</span>}
                      {r.effectiveness === '无效'   && <span className="text-xs bg-gray-100 text-gray-400 border border-gray-200 px-1.5 py-0.5 rounded-full">无效</span>}
                      {r.effectiveness === '追踪中' && <span className="text-xs bg-orange-50 text-orange-500 border border-orange-200 px-1.5 py-0.5 rounded-full">追踪中</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/40 text-xs text-gray-400">
                <span>第 {oPage * O_PAGE + 1}–{Math.min((oPage + 1) * O_PAGE, filtered.length)} 条，共 {filtered.length} 条</span>
                <div className="flex items-center gap-1">
                  <button disabled={oPage === 0} onClick={() => setOPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-40 transition-colors">上一页</button>
                  <span className="px-2">{oPage + 1} / {totalPages}</span>
                  <button disabled={oPage >= totalPages - 1} onClick={() => setOPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-40 transition-colors">下一页</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── CompetitorAnalysis (main export) ──────────────────────────────────────────

export function CompetitorAnalysis({ canEdit }: { canEdit: boolean }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupId, setGroupId] = useState('')
  const [activeDomain, setActiveDomain] = useState('')
  const [innerTab, setInnerTab] = useState<InnerTab>('keywords')
  const [period, setPeriod] = useState<Period>('yesterday')
  const [customDate, setCustomDate] = useState('')
  const [customDateEnd, setCustomDateEnd] = useState('')
  const [data, setData] = useState<CompetitorData | null>(null)
  const [loading, setLoading] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)
  const [allSites, setAllSites] = useState<SiteFull[]>([])
  const [compProfile, setCompProfile] = useState<Record<string, CompetitorProfileData | null>>({})
  const [compProfileLoading, setCompProfileLoading] = useState<Record<string, boolean>>({})
  const [compRuleModalOpen, setCompRuleModalOpen] = useState(false)
  const [compProfileForm, setCompProfileForm] = useState({ post_start_hour: '', post_end_hour: '', post_interval_minutes: '', same_base_diff_sub_is_update: false, same_name_diff_date_is_update: false })
  const [compProfileSaving, setCompProfileSaving] = useState(false)

  const today = useMemo(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), [])
  const yesterday = useMemo(() => new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10), [])

  useEffect(() => { setCustomDate(yesterday) }, [yesterday])

  const dateRange = useMemo(() => {
    if (period === 'yesterday') return { start: yesterday, end: yesterday }
    if (period === 'week') {
      const d = new Date(Date.now() + 8 * 3600000)
      const dow = d.getDay() || 7
      const monday = new Date(d.getTime() - (dow - 1) * 86400000)
      return { start: monday.toISOString().slice(0, 10), end: yesterday }
    }
    if (period === 'month') {
      const d = new Date(Date.now() + 8 * 3600000)
      return { start: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, end: yesterday }
    }
    const s = customDate || yesterday
    const e = customDateEnd || s
    return { start: s, end: e }
  }, [period, customDate, customDateEnd, yesterday])

  // Load groups
  useEffect(() => {
    fetch('/api/task-groups').then(r => r.json()).then(d => {
      const g: Group[] = (d.groups || []).map((grp: Group) => ({
        ...grp, site_domains: grp.site_domains || [], competitor_domains: grp.competitor_domains || [],
      }))
      setGroups(g)
      if (g.length > 0) setGroupId(g[0].id)
    }).finally(() => setGroupsLoading(false))
  }, [])

  // Reset active domain when group changes
  useEffect(() => {
    const g = groups.find(gr => gr.id === groupId)
    const domains = g?.competitor_domains || []
    setActiveDomain(domains.length > 0 ? domains[0] : '')
    setData(null)
  }, [groupId, groups])

  // Load competitor data
  useEffect(() => {
    if (!activeDomain) return
    const { start, end } = dateRange
    if (!start) return
    setLoading(true)
    setData(null)
    const apiTab = innerTab === 'outcomes' ? 'outcomes' : 'keywords'
    const url = `/api/competitor-site?domain=${encodeURIComponent(activeDomain)}&date=${start}&date_start=${start}&date_end=${end}&tab=${apiTab}`
    fetch(url).then(r => r.json()).then(d => setData(d)).finally(() => setLoading(false))
  }, [activeDomain, dateRange, innerTab])

  // Load competitor profile when on keywords tab
  useEffect(() => {
    if (innerTab !== 'keywords' || !activeDomain) return
    if (compProfile[activeDomain] !== undefined) return
    setCompProfileLoading(prev => ({ ...prev, [activeDomain]: true }))
    fetch(`/api/competitor-profiles/${encodeURIComponent(activeDomain)}`)
      .then(r => r.json())
      .then(d => setCompProfile(prev => ({ ...prev, [activeDomain]: d.profile ?? null })))
      .finally(() => setCompProfileLoading(prev => ({ ...prev, [activeDomain]: false })))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [innerTab, activeDomain])

  async function openManageModal() {
    if (allSites.length === 0) {
      const d = await fetch('/api/sites').then(r => r.json())
      setAllSites(d.sites ?? [])
    }
    setShowManageModal(true)
  }

  async function saveCompetitorDomains(domains: string[]) {
    const res = await fetch(`/api/task-groups/${groupId}/competitor-domains`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitor_domains: domains }),
    })
    if (!res.ok) return
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, competitor_domains: domains } : g))
    if (domains.length > 0) {
      if (!domains.includes(activeDomain)) setActiveDomain(domains[0])
    } else {
      setActiveDomain('')
    }
    setShowManageModal(false)
  }

  async function saveCompRule(domain: string) {
    setCompProfileSaving(true)
    try {
      const body = {
        post_start_hour: compProfileForm.post_start_hour !== '' ? Number(compProfileForm.post_start_hour) : null,
        post_end_hour: compProfileForm.post_end_hour !== '' ? Number(compProfileForm.post_end_hour) : null,
        post_interval_minutes: compProfileForm.post_interval_minutes !== '' ? Number(compProfileForm.post_interval_minutes) : null,
        same_base_diff_sub_is_update: compProfileForm.same_base_diff_sub_is_update,
        same_name_diff_date_is_update: compProfileForm.same_name_diff_date_is_update,
      }
      const res = await fetch(`/api/competitor-profiles/${encodeURIComponent(domain)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json()
      setCompProfile(prev => ({ ...prev, [domain]: d.profile }))
      setCompRuleModalOpen(false)
    } finally { setCompProfileSaving(false) }
  }

  const activeGroup = groups.find(g => g.id === groupId)
  const competitorDomains = activeGroup?.competitor_domains || []

  if (groupsLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (groups.length === 0) return (
    <div className="flex items-center justify-center py-20 text-gray-400 text-sm">暂无分组</div>
  )

  return (
    <div className="space-y-4">
      {/* Group selector + manage button */}
      <div className="flex items-center gap-3 flex-wrap">
        {groups.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">分组：</span>
            <select value={groupId} onChange={e => setGroupId(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700 bg-white">
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}
        {groups.length === 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">{groups[0].name}</span>
            {competitorDomains.length > 0 && <span className="text-xs text-gray-400">{competitorDomains.length} 个竞品站</span>}
          </div>
        )}
        {canEdit && (
          <button onClick={openManageModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-600 border border-orange-200 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors ml-auto">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            管理竞品
          </button>
        )}
      </div>

      {competitorDomains.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300 gap-3">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          <span className="text-sm">尚未配置竞品站</span>
          {canEdit && (
            <button onClick={openManageModal} className="text-sm text-orange-500 hover:text-orange-600 font-medium">点击"管理竞品"添加追踪域名 →</button>
          )}
        </div>
      ) : (
        <>
          {/* Competitor domain pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 flex-wrap">
            {competitorDomains.map(domain => (
              <button key={domain} onClick={() => setActiveDomain(domain)}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${activeDomain === domain ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600'}`}>
                {domain}
              </button>
            ))}
          </div>

          {activeDomain && (
            <div className="space-y-3">
              {/* Inner tabs */}
              <div className="flex gap-0 border-b border-gray-100">
                {([['keywords', '提交记录'], ['outcomes', '成效追踪']] as [InnerTab, string][]).map(([t, label]) => (
                  <button key={t} onClick={() => setInnerTab(t)}
                    className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${innerTab === t ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Period selector */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500 mr-1">时间范围：</span>
                <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                  {(['yesterday', 'week', 'month', 'custom'] as Period[]).map(p => (
                    <button key={p} onClick={() => setPeriod(p)}
                      className={`px-4 py-1.5 text-sm font-medium transition-colors ${period === p ? 'bg-orange-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                      {PERIOD_LABELS[p]}
                    </button>
                  ))}
                </div>
                {period === 'custom' ? (
                  <div className="flex items-center gap-2">
                    <input type="date" value={customDate} max={customDateEnd || today}
                      onChange={e => setCustomDate(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700" />
                    <span className="text-gray-400 text-sm">~</span>
                    <input type="date" value={customDateEnd} min={customDate} max={today}
                      onChange={e => setCustomDateEnd(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700" />
                  </div>
                ) : data && !loading ? (
                  <span className="text-xs text-gray-400">
                    {dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} ~ ${dateRange.end}`}
                    {innerTab === 'keywords' ? ` · ${data.keywords.length} 词` : ` · ${data.outcomeSummary?.total ?? 0} 词`}
                  </span>
                ) : null}
              </div>

              {/* Content */}
              {innerTab === 'keywords' ? (
                <div className="space-y-3">
                  {/* 发布规则条 */}
                  {(() => {
                    const p = compProfile[activeDomain]
                    const hasRule = p && (p.post_start_hour != null || p.post_end_hour != null || p.same_base_diff_sub_is_update || p.same_name_diff_date_is_update)
                    return (
                      <div className="bg-white rounded-xl border border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-wrap min-h-[44px]">
                        <div className="flex-1 flex items-center gap-2 flex-wrap text-xs">
                          {compProfileLoading[activeDomain] ? (
                            <span className="text-gray-300">加载中…</span>
                          ) : !hasRule ? (
                            <span className="text-gray-300">暂无发布规则</span>
                          ) : (
                            <>
                              {(p!.post_start_hour != null || p!.post_end_hour != null) && (
                                <span className="bg-orange-50 text-orange-600 px-2 py-1 rounded font-medium">
                                  发布时间 {p!.post_start_hour ?? '?'}:00 — {p!.post_end_hour ?? '?'}:00{p!.post_interval_minutes ? ` · 每${p!.post_interval_minutes}min` : ''}
                                </span>
                              )}
                              {p!.same_base_diff_sub_is_update && <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded">同词不同下拉词 = 更新</span>}
                              {p!.same_name_diff_date_is_update && <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded">同名不同日期 = 更新</span>}
                            </>
                          )}
                        </div>
                        {canEdit && (
                          <button onClick={() => {
                            const pr = compProfile[activeDomain]
                            setCompProfileForm({
                              post_start_hour: pr?.post_start_hour?.toString() ?? '',
                              post_end_hour: pr?.post_end_hour?.toString() ?? '',
                              post_interval_minutes: pr?.post_interval_minutes?.toString() ?? '',
                              same_base_diff_sub_is_update: pr?.same_base_diff_sub_is_update ?? false,
                              same_name_diff_date_is_update: pr?.same_name_diff_date_is_update ?? false,
                            })
                            setCompRuleModalOpen(true)
                          }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors flex-shrink-0">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                            新增规则
                          </button>
                        )}
                      </div>
                    )
                  })()}
                  {!loading && data && (
                    <div className="flex gap-4 overflow-x-auto pb-1">
                      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex-shrink-0 min-w-[140px]">
                        <div className="text-2xl font-bold text-gray-800">{data.keywords.length}</div>
                        <div className="text-xs font-medium text-gray-600 mt-0.5">{activeDomain}</div>
                        <div className="text-[11px] text-gray-400">期间新增词</div>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex-shrink-0 min-w-[140px]">
                        <div className="text-2xl font-bold text-blue-600">{fmtVol(data.keywords.reduce((s, k) => s + (k.search_volume || 0), 0))}</div>
                        <div className="text-xs font-medium text-gray-600 mt-0.5">搜索量合计</div>
                        <div className="text-[11px] text-gray-400">期间新词总量</div>
                      </div>
                    </div>
                  )}
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold text-gray-700">日期明细</span>
                      <span className="text-xs text-gray-400">{activeDomain} 期间新增词</span>
                    </div>
                    {loading ? <Spinner /> : <CompetitorKeywordsTable keywords={data?.keywords || []} />}
                  </div>
                </div>
              ) : (
                <CompetitorOutcomesPanel
                  site={data?.site ?? null}
                  outcomes={data?.outcomes ?? []}
                  summary={data?.outcomeSummary ?? null}
                  loading={loading}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Manage competitors modal */}
      {showManageModal && activeGroup && (
        <ManageCompetitorsModal
          groupName={activeGroup.name}
          initialDomains={competitorDomains}
          allSites={allSites}
          onSave={saveCompetitorDomains}
          onClose={() => setShowManageModal(false)}
        />
      )}

      {/* Competitor publish rule modal */}
      {compRuleModalOpen && activeDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCompRuleModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">新增规则</h3>
                <p className="text-xs text-gray-400 mt-0.5">{activeDomain}</p>
              </div>
              <button onClick={() => setCompRuleModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-5">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">发布时间段</p>
                <div className="grid grid-cols-3 gap-3">
                  {([['post_start_hour', '开始（时）'], ['post_end_hour', '结束（时）'], ['post_interval_minutes', '间隔（分钟）']] as [keyof typeof compProfileForm, string][]).map(([key, label]) => (
                    <div key={key}>
                      <label className="text-xs text-gray-400 block mb-1">{label}</label>
                      <input type="number" min={key === 'post_interval_minutes' ? 1 : 0} max={key === 'post_interval_minutes' ? undefined : 23}
                        value={String(compProfileForm[key])}
                        onChange={e => setCompProfileForm(p => ({ ...p, [key]: e.target.value }))}
                        placeholder="—"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300 text-gray-700" />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">判断新增还是更新</p>
                <div className="space-y-2.5">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={compProfileForm.same_base_diff_sub_is_update}
                      onChange={e => setCompProfileForm(p => ({ ...p, same_base_diff_sub_is_update: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400" />
                    <span className="text-sm text-gray-700 leading-snug">多个相同词但不同下拉词同时新增，默认为<span className="text-orange-600 font-medium">更新</span></span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={compProfileForm.same_name_diff_date_is_update}
                      onChange={e => setCompProfileForm(p => ({ ...p, same_name_diff_date_is_update: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400" />
                    <span className="text-sm text-gray-700 leading-snug">完全相同名称在不同日期出现，视为<span className="text-orange-600 font-medium">更新</span></span>
                  </label>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setCompRuleModalOpen(false)} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={() => saveCompRule(activeDomain)} disabled={compProfileSaving}
                className="text-sm px-5 py-2 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50">
                {compProfileSaving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
