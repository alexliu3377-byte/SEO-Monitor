'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import SiteAZPicker, { type AZPickerSite } from '@/components/site-az-picker'
import { SimplePagination, PAGE_SIZE } from '@/components/simple-pagination'

// ─── Shared ──────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

type TabKey = 'competitors' | 'diagnostic' | 'commercial' | 'week' | 'month' | 'quarter' | 'year'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'competitors', label: '竞品成效' },
  { key: 'diagnostic', label: '站点诊断' },
  { key: 'commercial', label: '商业词' },
  { key: 'week', label: '研究周报' },
  { key: 'month', label: '研究月报' },
  { key: 'quarter', label: '研究季报' },
  { key: 'year', label: '研究年报' },
]

// 2026-08-26 起研究中心对普通组员开放，但只开周报/月报——竞品成效、站点诊断、
// 季报、年报信息量更大/更偏管理决策，继续只给 super/admin。对应的后端接口
// （/api/research/reports 及 [id]）也要跟着放宽+按 period_type 二次校验，不能
// 只在前端藏tab，不然普通组员直接改URL参数还是能拿到季报/年报数据。
const NORMAL_ALLOWED_TABS: TabKey[] = ['week', 'month']

export default function ResearchPage() {
  const { role } = useUser()
  const isNormal = role === 'normal'
  const visibleTabs = isNormal ? TABS.filter(t => NORMAL_ALLOWED_TABS.includes(t.key)) : TABS

  const [activeTab, setActiveTab] = useState<TabKey>(isNormal ? 'week' : 'competitors')

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">研究中心</h1>
        <p className="text-sm text-gray-400 mt-0.5">竞品成效追踪 + 每周/月/年自动生成的AI研究报告</p>
      </div>

      <div className="flex border-b border-gray-100 mb-6">
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === t.key ? 'text-green-600 border-green-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'competitors' && <CompetitorsTab />}
      {activeTab === 'diagnostic' && <SiteDiagnosticTab />}
      {activeTab === 'commercial' && <CommercialKeywordsTab />}
      {activeTab === 'week' && <ReportTab key="week" periodType="week" />}
      {activeTab === 'month' && <ReportTab key="month" periodType="month" />}
      {activeTab === 'quarter' && <ReportTab key="quarter" periodType="quarter" />}
      {activeTab === 'year' && <ReportTab key="year" periodType="year" />}
    </div>
  )
}

// ══════════════════════════════ 竞品成效 ══════════════════════════════

type CompetitorSite = AZPickerSite

// effectiveness 字段2026-08-10起不再从接口返回——竞品追踪明细现在只拉
// effectiveness='有效'的记录（见 tracking/route.ts 注释），这张表里每一行
// 一定是"有效"，字段本身变成常量、没有展示价值，索性从响应里去掉。
interface TrackingRow {
  operation_type: string | null
  keyword: string
  search_volume: number
  content_type: string | null
  rank_position: number | null
  rank_volume: number
  score: number | null
  content_date: string | null
  discovery_date: string
}

type SortableCol = 'search_volume' | 'rank_position' | 'rank_volume' | 'score' | 'content_date' | 'discovery_date'

function CompetitorsTab() {
  const [sites, setSites] = useState<CompetitorSite[]>([])
  const [loadingSites, setLoadingSites] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showManageModal, setShowManageModal] = useState(false)

  const [rows, setRows] = useState<TrackingRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [kwFilter, setKwFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'app' | 'game'>('')
  const [sortCol, setSortCol] = useState<SortableCol | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)

  function loadSites() {
    setLoadingSites(true)
    fetch('/api/research/competitor-sites').then(r => r.json()).then(d => setSites(d.sites ?? [])).finally(() => setLoadingSites(false))
  }
  useEffect(loadSites, [])

  useEffect(() => {
    if (!selectedId) { setRows([]); return }
    setLoadingRows(true)
    fetch(`/api/research/competitor-sites/${selectedId}/tracking`).then(r => r.json()).then(d => setRows(d.rows ?? [])).finally(() => setLoadingRows(false))
  }, [selectedId])

  const filteredRows = rows.filter(r => {
    if (kwFilter && !r.keyword.toLowerCase().includes(kwFilter.toLowerCase())) return false
    if (typeFilter && r.content_type !== typeFilter) return false
    return true
  })

  // 升降序排序——参考分组报告"成效追踪"的三角图标交互，但这边数据本来就是
  // 一次性全量拉到客户端的（不像分组报告那边分页从服务端拉），直接客户端排序。
  // null 值（没有排名/搜索量等）不管升序降序都排在最后，不然升序时会跑到最前面。
  const sortedRows = sortCol === null ? filteredRows : [...filteredRows].sort((a, b) => {
    const av = a[sortCol]; const bv = b[sortCol]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string' || typeof bv === 'string') {
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    }
    return sortDir === 'asc' ? av - bv : bv - av
  })

  // 页码钳到当前结果的合法范围内（切换站点/筛选/排序都会让结果变短，不然
  // 会重现网站管理那边"页码指向结果范围外，表格空白"的同一个坑，见
  // components/site-table.tsx 的同款修法）。
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pagedRows = sortedRows.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)

  function sortIcons(col: SortableCol) {
    const isAsc = sortCol === col && sortDir === 'asc'
    const isDesc = sortCol === col && sortDir === 'desc'
    return (
      <span className="inline-flex flex-col items-center gap-px select-none ml-0.5">
        <svg onClick={() => { setSortCol(col); setSortDir('asc') }} viewBox="0 0 8 5" width="8" height="5" fill="currentColor"
          className={`cursor-pointer ${isAsc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 0L8 5H0Z" /></svg>
        <svg onClick={() => { setSortCol(col); setSortDir('desc') }} viewBox="0 0 8 5" width="8" height="5" fill="currentColor"
          className={`cursor-pointer ${isDesc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 5L0 0H8Z" /></svg>
      </span>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400 min-w-0">选一个竞品站点查看成效明细（只展示已确认"有效"的词——追踪中/无效对这个页面没有参考价值，不再拉取；只有开启"排名"追踪的站点才会出现在这里，不含你自己的站点）</p>
        <button onClick={() => setShowManageModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors flex-shrink-0 whitespace-nowrap">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          管理竞品站点
        </button>
      </div>

      {loadingSites ? <Spinner /> : sites.length === 0 ? (
        <p className="text-sm text-gray-300 text-center py-8">还没有竞品站点，点右上角"管理竞品站点"开启追踪</p>
      ) : (
        <SiteAZPicker sites={sites} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {selectedId && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center gap-2">
            <input type="text" value={kwFilter} onChange={e => setKwFilter(e.target.value)} placeholder="搜索关键词…"
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as '' | 'app' | 'game')}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700">
              <option value="">全部类型</option>
              <option value="app">应用</option>
              <option value="game">游戏</option>
            </select>
            <span className="text-xs text-gray-400 ml-auto">{filteredRows.length} 条</span>
          </div>
          {loadingRows ? <Spinner /> : sortedRows.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">没有匹配的记录</p>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100 whitespace-nowrap">
                    <th className="text-left px-4 py-2 font-medium">操作</th>
                    <th className="text-left px-4 py-2 font-medium">关键词</th>
                    <th className="text-right px-4 py-2 font-medium"><span className="inline-flex items-center justify-end">搜索量{sortIcons('search_volume')}</span></th>
                    <th className="text-left px-4 py-2 font-medium">类型</th>
                    <th className="text-right px-4 py-2 font-medium"><span className="inline-flex items-center justify-end">排名{sortIcons('rank_position')}</span></th>
                    <th className="text-left px-4 py-2 font-medium">排名词</th>
                    <th className="text-right px-4 py-2 font-medium"><span className="inline-flex items-center justify-end">排名量{sortIcons('rank_volume')}</span></th>
                    <th className="text-right px-4 py-2 font-medium"><span className="inline-flex items-center justify-end">得分{sortIcons('score')}</span></th>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">提交日期{sortIcons('content_date')}</span></th>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">记录日期{sortIcons('discovery_date')}</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pagedRows.map((r, i) => (
                    <tr key={i} className="text-gray-700">
                      <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{r.operation_type ?? '—'}</td>
                      <td className="px-4 py-2 max-w-[200px]"><span className="block truncate" title={r.keyword}>{r.keyword}</span></td>
                      <td className="px-4 py-2 text-right text-xs whitespace-nowrap">{r.search_volume?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{r.content_type === 'game' ? '游戏' : r.content_type === 'app' ? '应用' : '—'}</td>
                      <td className="px-4 py-2 text-right text-xs whitespace-nowrap">{r.rank_position ?? '—'}</td>
                      <td className="px-4 py-2 max-w-[200px]"><span className="block truncate" title={r.keyword}>{r.keyword}</span></td>
                      <td className="px-4 py-2 text-right text-xs whitespace-nowrap">{r.rank_volume?.toLocaleString() ?? '—'}</td>
                      <td className={`px-4 py-2 text-right text-xs font-semibold whitespace-nowrap ${r.score == null ? 'text-gray-300' : r.score > 0 ? 'text-green-600' : 'text-red-400'}`}>
                        {r.score == null ? '—' : r.score.toFixed(1)}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">{r.content_date ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">{r.discovery_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SimplePagination page={clampedPage} total={sortedRows.length} onChange={setPage} />
            </>
          )}
        </div>
      )}

      {showManageModal && (
        <ManageCompetitorSitesModal
          onClose={() => setShowManageModal(false)}
          onSaved={() => { setShowManageModal(false); loadSites() }}
        />
      )}
    </div>
  )
}

// ══════════════════════════════ 站点诊断 ══════════════════════════════

interface DiagnosticHistoryItem { id: string; question: string | null; result: string; created_at: string; domains: string[] }
interface MatchedSite { id: string; domain: string; name: string; isOwnSite: boolean }
interface DiagnosticResult {
  id: string; question: string; result: string; created_at: string
  matched_sites: MatchedSite[]; unmatched_domains: string[]; truncated: boolean
}

// 2026-08-27 从"先选一个站点才能问"改成直接自由提问——用户反馈发现异常时
// 经常一次想问好几个站点（甚至纯粹问"大环境怎么样"），不想一个个点选。
// AI自己从问题文本里识别提到了哪些站点（0个=纯大环境、1个=单站、多个=
// 跨站点找规律），历史记录也从"必须先选站点才能看"改成默认展示+分页。
function SiteDiagnosticTab() {
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [history, setHistory] = useState<DiagnosticHistoryItem[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)

  function loadHistory() {
    setLoadingHistory(true)
    fetch(`/api/research/site-diagnostics?page=${historyPage}&pageSize=${PAGE_SIZE}`)
      .then(r => r.json())
      .then(d => { setHistory(d.diagnostics ?? []); setHistoryTotal(d.total ?? 0) })
      .finally(() => setLoadingHistory(false))
  }
  useEffect(loadHistory, [historyPage])

  async function runDiagnostic() {
    if (!question.trim() || running) return
    setRunning(true); setErrorMsg(''); setResult(null)
    try {
      const res = await fetch('/api/research/site-diagnostics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMsg(data.error || '诊断失败'); return }
      setResult(data)
      setQuestion('')
      if (historyPage === 0) loadHistory()
      else setHistoryPage(0)
    } catch {
      setErrorMsg('诊断失败（网络异常），请重试')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm text-gray-400">直接问问题，可以提到一个站点、好几个站点、或者不提站点纯问大环境——AI会自动识别问题里的域名，读相关站点近90天完整历史数据+大环境对比给出分析。提到多个站点时，除了逐站分析还会帮你找跨站点的共同规律。数据量大时可能要1-3分钟，请耐心等待。</p>
        <textarea value={question} onChange={e => setQuestion(e.target.value)}
          placeholder={'例如：\n这两个大站点ip下滑\nsj.zol.com.cn\nuzzf.com\n小站ip下滑\npc768.com\n\n或者直接问："最近整体大环境怎么样"'}
          rows={5}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 resize-none" />
        <button onClick={runDiagnostic} disabled={running || !question.trim()}
          className="px-4 py-2 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
          {running ? 'AI正在读取历史数据，可能需要1-3分钟…' : '开始诊断'}
        </button>
        {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
      </div>

      {result && (
        <div className="bg-white rounded-xl border border-green-200 p-5">
          <p className="text-sm font-semibold text-green-700 mb-2">诊断结果</p>
          <p className="text-xs text-gray-400 mb-2">问题：{result.question}</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {result.matched_sites.length === 0 && result.unmatched_domains.length === 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 text-sky-600 border border-sky-200">大环境（未提及具体站点）</span>
            )}
            {result.matched_sites.map(s => (
              <span key={s.id} className={`text-xs px-2 py-0.5 rounded-full border ${s.isOwnSite ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                {s.domain}{s.isOwnSite ? '（自己站点）' : '（参考）'}
              </span>
            ))}
            {result.unmatched_domains.map(d => (
              <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200" title="系统里没有追踪这个域名，如需要请先去网站管理添加">
                {d}（未追踪）
              </span>
            ))}
          </div>
          {result.truncated && <p className="text-xs text-amber-600 mb-2">⚠ 问题里提到的站点超过15个，只分析了前15个</p>}
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{result.result}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 pt-4 pb-1">
          <p className="text-sm font-semibold text-gray-700">历史诊断记录</p>
        </div>
        {loadingHistory ? <Spinner /> : history.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-8">还没有诊断记录，去上面问点什么吧</p>
        ) : (
          <>
            <div className="px-5 pb-3 space-y-2">
              {history.map(h => (
                <div key={h.id} className="border-b border-gray-50 pb-2 last:border-0">
                  <button onClick={() => setExpandedHistoryId(prev => prev === h.id ? null : h.id)}
                    className="w-full text-left text-xs text-gray-500 hover:text-gray-700">
                    <span className="text-gray-400">{h.created_at.slice(0, 16).replace('T', ' ')}</span>
                    {' · '}
                    <span className="text-gray-600">{h.domains.length > 0 ? h.domains.join('、') : '大环境'}</span>
                    {h.question && <span> · {h.question.length > 40 ? `${h.question.slice(0, 40)}…` : h.question}</span>}
                  </button>
                  {expandedHistoryId === h.id && (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed mt-2">{h.result}</p>
                  )}
                </div>
              ))}
            </div>
            <SimplePagination page={historyPage} total={historyTotal} onChange={setHistoryPage} />
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════ 商业词 ══════════════════════════════

interface CommercialKeyword { id: string; keyword: string; group_name: string | null; created_at: string }
interface GroupResult { groupName: string; members: string[]; expansions: string[] }
interface CoverageRow {
  keyword: string; isExpansion: boolean; groupName: string
  domain: string; siteName: string; isOwnSite: boolean
  rankPosition: number | null; title: string | null; url: string | null
  platform: string; statDate: string
}
interface CoverageResult {
  groupResults: GroupResult[]; coverage: CoverageRow[]; noDataKeywords: string[]; totalKeywordsChecked: number
}
interface Discovery {
  id: string; source_keyword: string; group_name: string; matched_alias: string
  domain: string | null; title: string | null; url: string | null
  platform: string | null; rank_position: number | null; best_rank_position: number | null
  site_domains: string[] | null; seen_count: number
  first_seen_at: string; last_seen_at: string; status: string
}

type CommercialSubView = 'list' | 'coverage' | 'discoveries'
const SUB_VIEWS: { key: CommercialSubView; label: string }[] = [
  { key: 'list', label: '词组库' },
  { key: 'coverage', label: '排名覆盖' },
  { key: 'discoveries', label: '新词发现' },
]

// 维护一份"商业词"清单 + 挖下拉词变体 + 查这批词（含变体）现在谁拿到了排名，
// 外加从每天真实抓取的排名标题里被动积累"新词发现"证据。2026-08-28 新增，
// 用户想找"这批有商业价值的词，别人网站做得怎么样、多少排名、什么标题"，
// 同时想发现同一个商业概念的不同说法。同一天补了"概念分组"——同一行贴多个
// 别名（比如"纸飞机、telegram、telegreat"）算同一组，查覆盖时按组归拢展示。
// 又同一天加了"新词发现"：百度下拉词对敏感话题词经常返回空/文不对题（实测
// 验证过），改成从 rank-title 抓取的真实标题里找"已知别名+未知词共现"的证据
// （scripts/crawl-rank.ts 的 upsertDiscovery），人工审核后决定要不要收编进清单。
function CommercialKeywordsTab() {
  const [subView, setSubView] = useState<CommercialSubView>('list')

  const [keywords, setKeywords] = useState<CommercialKeyword[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [pasteText, setPasteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [result, setResult] = useState<CoverageResult | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const [discoveries, setDiscoveries] = useState<Discovery[]>([])
  const [loadingDiscoveries, setLoadingDiscoveries] = useState(false)
  const [discoveryStatus, setDiscoveryStatus] = useState<'pending' | 'accepted' | 'ignored'>('pending')
  const [discoveryError, setDiscoveryError] = useState('')
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [acceptAlias, setAcceptAlias] = useState('')
  const [acceptGroup, setAcceptGroup] = useState('')

  function loadList() {
    setLoadingList(true)
    fetch('/api/research/commercial-keywords').then(r => r.json()).then(d => setKeywords(d.keywords ?? [])).finally(() => setLoadingList(false))
  }
  useEffect(loadList, [])

  // 按 group_name 归拢展示（没有 group_name 的老数据兜底成自己是自己的组）
  const groupedList = (() => {
    const map = new Map<string, CommercialKeyword[]>()
    for (const k of keywords) {
      const g = k.group_name || k.keyword
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(k)
    }
    return Array.from(map.entries())
  })()

  async function saveKeywords() {
    if (!pasteText.trim() || saving) return
    setSaving(true); setSaveError('')
    try {
      const res = await fetch('/api/research/commercial-keywords', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: pasteText }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveError(data.error || '保存失败'); return }
      setPasteText('')
      loadList()
    } catch {
      setSaveError('保存失败（网络异常）')
    } finally {
      setSaving(false)
    }
  }

  async function removeKeyword(id: string) {
    await fetch('/api/research/commercial-keywords', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    })
    setKeywords(prev => prev.filter(k => k.id !== id))
  }

  async function removeGroup(groupName: string) {
    await fetch('/api/research/commercial-keywords', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupName }),
    })
    setKeywords(prev => prev.filter(k => (k.group_name || k.keyword) !== groupName))
  }

  async function clearAll() {
    if (!window.confirm(`确定要清空全部 ${keywords.length} 个商业词吗？此操作不可撤销。`)) return
    await fetch('/api/research/commercial-keywords', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }),
    })
    setKeywords([])
  }

  async function runCoverage() {
    if (running || keywords.length === 0) return
    setRunning(true); setRunError(''); setResult(null)
    try {
      const res = await fetch('/api/research/commercial-keywords/coverage', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setRunError(data.error || '查询失败'); return }
      setResult(data)
    } catch {
      setRunError('查询失败（网络异常），请重试')
    } finally {
      setRunning(false)
    }
  }

  function loadDiscoveries(status: 'pending' | 'accepted' | 'ignored') {
    setLoadingDiscoveries(true); setDiscoveryError('')
    fetch(`/api/research/commercial-keywords/discoveries?status=${status}`)
      .then(r => r.json())
      .then(d => setDiscoveries(d.discoveries ?? []))
      .catch(() => setDiscoveryError('加载失败（网络异常）'))
      .finally(() => setLoadingDiscoveries(false))
  }
  useEffect(() => { if (subView === 'discoveries') loadDiscoveries(discoveryStatus) }, [subView, discoveryStatus])

  function openAcceptForm(d: Discovery) {
    setAcceptingId(d.id)
    setAcceptAlias(d.source_keyword)
    setAcceptGroup(d.group_name)
  }

  async function confirmAccept(id: string) {
    if (!acceptAlias.trim() || !acceptGroup.trim()) return
    setDiscoveryError('')
    try {
      const res = await fetch('/api/research/commercial-keywords/discoveries', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'accept', alias: acceptAlias.trim(), groupName: acceptGroup.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setDiscoveryError(data.error || '操作失败'); return }
      setAcceptingId(null)
      setDiscoveries(prev => prev.filter(d => d.id !== id))
      loadList()
    } catch {
      setDiscoveryError('操作失败（网络异常）')
    }
  }

  async function ignoreDiscovery(id: string) {
    setDiscoveryError('')
    try {
      const res = await fetch('/api/research/commercial-keywords/discoveries', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'ignore' }),
      })
      const data = await res.json()
      if (!res.ok) { setDiscoveryError(data.error || '操作失败'); return }
      setDiscoveries(prev => prev.filter(d => d.id !== id))
    } catch {
      setDiscoveryError('操作失败（网络异常）')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-1.5">
        {SUB_VIEWS.map(v => (
          <button key={v.key} onClick={() => setSubView(v.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${subView === v.key ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {subView === 'list' && (
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm text-gray-400">维护一份有商业价值、想重点盯的关键词清单。同一行可以贴多个别名（同一个概念的不同叫法），用顿号或逗号隔开——查覆盖时会先给每个别名各挖一遍百度下拉词（发现更多说法），再把整组词一起拿去查现有排名数据里谁拿到了、第几名、标题是什么。只统计"排名"模式站点（网站管理里"排名"开关开着的那批）——"涨跌"模式站点没有具体排名/标题数据，查不到。</p>
        <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
          placeholder={'一行一组，同一组内用顿号/逗号隔开多个别名，例如：\n纸飞机、telegram、telegreat、telegraph\nLetstalk'} rows={4}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 resize-none" />
        <div className="flex items-center gap-2">
          <button onClick={saveKeywords} disabled={saving || !pasteText.trim()}
            className="px-4 py-2 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
            {saving ? '保存中…' : '保存到清单'}
          </button>
          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        </div>

        {loadingList ? <Spinner /> : keywords.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-4">清单是空的，先贴几个商业词</p>
        ) : (
          <div className="pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">已保存 {keywords.length} 个（{groupedList.length} 组）</span>
              <button onClick={clearAll} className="text-xs text-gray-400 hover:text-red-500">清空全部</button>
            </div>
            <div className="space-y-1.5">
              {groupedList.map(([groupName, members]) => (
                <div key={groupName} className="flex items-center gap-1.5 flex-wrap px-2 py-1.5 rounded-lg bg-gray-50/60 border border-gray-100">
                  {members.length > 1 && (
                    <button onClick={() => removeGroup(groupName)} title="删除整组"
                      className="text-[10px] text-gray-400 hover:text-red-500 px-1.5 py-0.5 rounded border border-gray-200 flex-shrink-0">删除组</button>
                  )}
                  {members.map(k => (
                    <span key={k.id} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-white text-gray-600 border border-gray-200">
                      {k.keyword}
                      <button onClick={() => removeKeyword(k.id)} className="text-gray-400 hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {subView === 'coverage' && (
      <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm text-gray-400">对词组库里的每个别名挖一遍百度下拉词，再把整批词（含下拉词变体）拿去查现有排名数据里谁拿到了、第几名、标题是什么。只统计"排名"模式站点——"涨跌"模式站点没有具体排名/标题数据，查不到。</p>
        <button onClick={runCoverage} disabled={running || keywords.length === 0}
          className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors">
          {running ? '正在挖下拉词+查排名，可能需要几十秒到几分钟…' : '查覆盖'}
        </button>
        {keywords.length === 0 && <p className="text-xs text-gray-300">词组库是空的，先去"词组库"贴几个商业词</p>}
        {runError && <p className="text-xs text-red-600">{runError}</p>}
      </div>

      {result && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3">下拉词挖掘结果（共检查 {result.totalKeywordsChecked} 个词，含清单里的别名本身）</p>
            <div className="space-y-1.5">
              {result.groupResults.map(g => (
                <div key={g.groupName} className="border-b border-gray-50 pb-1.5 last:border-0">
                  <button onClick={() => setExpandedGroup(prev => prev === g.groupName ? null : g.groupName)}
                    className="w-full text-left text-xs text-gray-600 hover:text-gray-800">
                    <span className="font-medium">{g.groupName}</span>
                    <span className="text-gray-400"> · 别名 {g.members.length} 个 · 挖到 {g.expansions.length} 个下拉词</span>
                  </button>
                  {expandedGroup === g.groupName && (
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed space-y-0.5">
                      <p>别名：{g.members.join('、')}</p>
                      <p>下拉词：{g.expansions.length > 0 ? g.expansions.join('、') : '没有挖到下拉词'}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">覆盖明细</span>
              <span className="text-xs text-gray-400">{result.coverage.length} 条，按排名从好到差</span>
            </div>
            {result.coverage.length === 0 ? (
              <p className="text-sm text-gray-300 text-center py-8">这批词现在没有任何"排名"模式站点拿到排名</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100 whitespace-nowrap">
                      <th className="text-left px-4 py-2 font-medium">关键词</th>
                      <th className="text-left px-4 py-2 font-medium">所属概念</th>
                      <th className="text-left px-4 py-2 font-medium">站点</th>
                      <th className="text-right px-4 py-2 font-medium">排名</th>
                      <th className="text-left px-4 py-2 font-medium">标题</th>
                      <th className="text-left px-4 py-2 font-medium">平台</th>
                      <th className="text-left px-4 py-2 font-medium">数据日期</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {result.coverage.map((c, i) => (
                      <tr key={i} className="text-gray-700">
                        <td className="px-4 py-2 max-w-[160px]"><span className="block truncate" title={c.keyword}>{c.keyword}</span>{c.isExpansion && <span className="text-[10px] text-blue-500 ml-1">下拉</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-400 max-w-[140px]"><span className="block truncate">{c.groupName}</span></td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap">
                          {c.domain}
                          <span className={`ml-1 px-1 py-0.5 rounded text-[10px] ${c.isOwnSite ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400'}`}>{c.isOwnSite ? '自己' : '竞品'}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-xs whitespace-nowrap">{c.rankPosition ?? '—'}</td>
                        <td className="px-4 py-2 max-w-[220px]"><span className="block truncate" title={c.title ?? ''}>{c.title ?? '—'}</span></td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap">{c.platform}</td>
                        <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">{c.statDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.noDataKeywords.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
                没查到任何排名数据（{result.noDataKeywords.length}个）：{result.noDataKeywords.join('、')}
              </div>
            )}
          </div>
        </>
      )}
      </div>
      )}

      {subView === 'discoveries' && (
      <div className="space-y-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <p className="text-sm text-gray-400">抓排名标题时（rank-title步骤，16个"排名"模式站点），顺手检查标题里有没有出现词组库里已知的别名文字；命中了但这条关键词本身还不是已知别名，就是一个新词候选，累积在这里等你审核——不是一次性挖干净，是每天抓取慢慢攒出来的。</p>
          <div className="flex items-center gap-1.5">
            {(['pending', 'accepted', 'ignored'] as const).map(s => (
              <button key={s} onClick={() => setDiscoveryStatus(s)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${discoveryStatus === s ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700'}`}>
                {s === 'pending' ? '待审核' : s === 'accepted' ? '已加入' : '已忽略'}
              </button>
            ))}
          </div>
          {discoveryError && <p className="text-xs text-red-600">{discoveryError}</p>}
        </div>

        {loadingDiscoveries ? <Spinner /> : discoveries.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-8">
            {discoveryStatus === 'pending' ? '暂无待审核的新词，等下一轮抓取再来看看' : discoveryStatus === 'accepted' ? '还没有已加入的新词' : '还没有已忽略的新词'}
          </p>
        ) : (
          <div className="space-y-2">
            {discoveries.map(d => (
              <div key={d.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">{d.source_keyword}</span>
                      <span className="text-xs text-gray-400">→ 命中概念组「{d.group_name}」（标题含"{d.matched_alias}"）</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      站点数 {d.site_domains?.length ?? 0} · 出现 {d.seen_count} 次 · 最佳排名 {d.best_rank_position ?? '—'} · 最新命中 {d.domain ?? '—'}（{d.last_seen_at.slice(0, 10)}）
                    </p>
                    {d.title && (
                      <p className="text-xs text-gray-500 mt-1 truncate" title={d.title}>
                        标题：{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">{d.title}</a> : d.title}
                      </p>
                    )}
                  </div>
                  {discoveryStatus !== 'accepted' && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => openAcceptForm(d)}
                        className="px-2.5 py-1 text-xs font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">加入词组</button>
                      {discoveryStatus === 'pending' && (
                        <button onClick={() => ignoreDiscovery(d.id)}
                          className="px-2.5 py-1 text-xs text-gray-400 border border-gray-200 rounded-lg hover:text-red-500 hover:border-red-200 transition-colors">忽略</button>
                      )}
                    </div>
                  )}
                </div>

                {acceptingId === d.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                    <input value={acceptAlias} onChange={e => setAcceptAlias(e.target.value)}
                      placeholder="要加入的别名文字"
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 w-40" />
                    <span className="text-xs text-gray-400">归到组</span>
                    <input value={acceptGroup} onChange={e => setAcceptGroup(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 w-32" />
                    <button onClick={() => confirmAccept(d.id)} disabled={!acceptAlias.trim() || !acceptGroup.trim()}
                      className="px-2.5 py-1 text-xs font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">确认</button>
                    <button onClick={() => setAcceptingId(null)}
                      className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">取消</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  )
}

interface ManageSite { id: string; domain: string; name: string; has_rank_title: boolean }

// 列出全部站点（不含自己的站点，自己的站点由 task_groups.site_domains 自动
// 识别，见 fetchOwnSiteDomains）让用户勾选哪些要当竞品追踪排名——用户明确说
// 不需要重新填站点资料（域名/CSS选择器那些在"网站管理"里已经配过了），这里
// 只是批量开关 has_rank_title，不是新建站点。
function ManageCompetitorSitesModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [sites, setSites] = useState<ManageSite[]>([])
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/research/competitor-sites?all=true').then(r => r.json()).then(d => {
      const list = (d.sites ?? []) as ManageSite[]
      setSites(list)
      setChecked(new Set(list.filter(s => s.has_rank_title).map(s => s.id)))
    }).finally(() => setLoading(false))
  }, [])

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const changed = sites.filter(s => s.has_rank_title !== checked.has(s.id))
      await Promise.all(changed.map(s =>
        fetch('/api/sites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, has_rank_title: checked.has(s.id) }) })
      ))
      onSaved()
    } finally { setSaving(false) }
  }

  const filtered = query.trim()
    ? sites.filter(s => s.domain.toLowerCase().includes(query.toLowerCase()) || s.name.toLowerCase().includes(query.toLowerCase()))
    : sites

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">管理竞品站点</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-3 border-b border-gray-100">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索域名或站点名…" autoFocus
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
          <p className="text-xs text-gray-400 mt-1.5">勾选的站点会开启"排名"追踪，每天自动统计新增内容的成效</p>
        </div>
        <div className="px-6 py-3 overflow-y-auto flex-1">
          {loading ? <Spinner /> : filtered.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">没有匹配的站点</p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map(s => (
                <label key={s.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="truncate">{s.domain}</span>
                  <span className="text-xs text-gray-400 truncate">{s.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════ 研究周/月/年报 ══════════════════════════════

interface ReportListItem {
  id: string
  period_type: 'week' | 'month' | 'quarter' | 'year'
  period_start: string
  period_end: string
  status: 'running' | 'completed' | 'failed'
  sites_considered: number
  sites_analyzed: number
  sites_skipped: number
  gemini_call_count: number
  gemini_fail_count: number
  error: string | null
}

interface MomentumKeyword {
  keyword: string; cluster: string; category: string
  rankPosition: number | null; rankChange: number | null; volume: number; volumeChange: number
}
interface SiteFinding { observation: string; interpretation: string; confidence: 'high' | 'medium' | 'low' }

interface SiteAnalysisEntry {
  site_id: string
  domain: string
  name: string
  skipped: boolean
  skip_reason: string | null
  analysis: string | null
  error: string | null
  pc_weight?: number | null
  mobile_weight?: number | null
  avg_index_count?: number | null
  avg_mobile_ip?: number | null
  momentum_keywords?: MomentumKeyword[] | null
  findings?: SiteFinding[] | null
}

interface CompetitorEffectivenessClaim {
  site_id: string
  domain: string
  keyword: string
  content_type: string
  rank_position: number | null
  volume: number
  score: number
}

interface CompetitorEffectivenessSummary {
  effective: number
  tracking: number
  invalid: number
  topClaims: CompetitorEffectivenessClaim[]
  contentBreakdown?: { 游戏: number; 应用: number }
}

interface OwnEffectivenessClaim {
  keyword: string
  url: string | null
  rank_position: number | null
  volume: number
  score: number
}

interface OwnEffectivenessGroup {
  group_id: string
  group_name: string
  ranked: number
  indexed: number
  tracking: number
  invalid: number
  topClaims: OwnEffectivenessClaim[]
  contentBreakdown?: { 游戏: number; 应用: number; 专题: number; 资讯: number }
}

interface EnvironmentTierStats {
  siteCount: number
  pcWeight: number | null
  mobileWeight: number | null
  indexCount: number | null
}

interface EnvironmentStats {
  asOfDate: string
  overall: EnvironmentTierStats
  tiers: { 大站: EnvironmentTierStats; 中站: EnvironmentTierStats; 小站: EnvironmentTierStats }
}

// report_sections 2026-08-10 起改成短字段+按组说明（environmentNote/ownGroupNotes/
// competitorNote），旧报告还是老的四个长字段（environment/ownEffectiveness/
// competitorEffectiveness）——两套字段都保留在类型里，渲染时优先取新字段、
// 没有再退回旧字段，老报告不会显示空白。conclusion 两版字段名一直相同不用兼容。
interface OpportunityGap {
  cluster: string; category: string; keywordCount: number; totalVolume: number
  priority: 'high' | 'medium' | 'low'; recommendation: string
}

interface ReportDetail extends ReportListItem {
  site_analyses: SiteAnalysisEntry[]
  competitor_effectiveness: CompetitorEffectivenessSummary | null
  own_effectiveness: OwnEffectivenessGroup[] | null
  environment_stats: EnvironmentStats | null
  report_sections: {
    environmentNote?: string; ownGroupNotes?: Record<string, string>; competitorNote?: string
    environment?: string; ownEffectiveness?: string; competitorEffectiveness?: string
    opportunityGaps?: OpportunityGap[]
    conclusion: string
  } | null
}

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  running:   { label: '生成中', bg: 'bg-amber-50', text: 'text-amber-600' },
  completed: { label: '已完成', bg: 'bg-green-50', text: 'text-green-600' },
  failed:    { label: '失败',   bg: 'bg-red-50',   text: 'text-red-600' },
}

const PRIORITY_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  high:   { label: '高优先级', bg: 'bg-red-50',   text: 'text-red-600' },
  medium: { label: '中优先级', bg: 'bg-amber-50', text: 'text-amber-600' },
  low:    { label: '低优先级', bg: 'bg-gray-100',  text: 'text-gray-500' },
}

const CONFIDENCE_LABELS: Record<string, string> = { high: '高置信度', medium: '中置信度', low: '低置信度' }

function ReportTab({ periodType }: { periodType: 'week' | 'month' | 'quarter' | 'year' }) {
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterYear, setFilterYear] = useState('')
  const [filterMonth, setFilterMonth] = useState('') // 只有 week tab 用——月报的pill本身就是"月"，不用再筛一层

  useEffect(() => {
    setLoading(true)
    fetch(`/api/research/reports?type=${periodType}`).then(r => r.json()).then(d => {
      const list = (d.reports ?? []) as ReportListItem[]
      setReports(list)
      setSelectedId(list.length > 0 ? list[0].id : null)
      setFilterYear(list.length > 0 ? list[0].period_start.slice(0, 4) : '')
      setFilterMonth(list.length > 0 ? list[0].period_start.slice(5, 7) : '')
    }).finally(() => setLoading(false))
  }, [periodType])

  if (loading) return <Spinner />
  if (reports.length === 0) return <p className="text-sm text-gray-300 text-center py-12">还没有报告</p>

  // 周报/月报会越积越多，参照近期榜单"月度趋势"的做法先选年份（周报再多选一层
  // 月份，因为一年52周直接铺一排还是太长）再看卡片，卡片行不会随时间无限变长；
  // 年报本身一年只多一张，不需要这层筛选。年份/月份下拉一直显示——不要因为
  // "目前数据只有一个年份/月份"就隐藏掉，隐藏会让人以为这个筛选功能没做。
  const years = Array.from(new Set(reports.map(r => r.period_start.slice(0, 4)))).sort((a, b) => b.localeCompare(a))
  const monthsInYear = Array.from(new Set(
    reports.filter(r => r.period_start.startsWith(filterYear)).map(r => r.period_start.slice(5, 7))
  )).sort((a, b) => b.localeCompare(a))

  const visibleReports = periodType === 'year'
    ? reports
    : periodType === 'week'
      ? reports.filter(r => r.period_start.startsWith(`${filterYear}-${filterMonth}`))
      : reports.filter(r => r.period_start.startsWith(filterYear))

  function changeYear(y: string) {
    setFilterYear(y)
    const monthsForY = Array.from(new Set(reports.filter(r => r.period_start.startsWith(y)).map(r => r.period_start.slice(5, 7)))).sort((a, b) => b.localeCompare(a))
    const m = monthsForY[0] ?? ''
    setFilterMonth(m)
    const first = reports.find(r => r.period_start.startsWith(periodType === 'week' ? `${y}-${m}` : y))
    setSelectedId(first ? first.id : null)
  }

  function changeMonth(m: string) {
    setFilterMonth(m)
    const first = reports.find(r => r.period_start.startsWith(`${filterYear}-${m}`))
    setSelectedId(first ? first.id : null)
  }

  return (
    <div className="space-y-5">
      {periodType !== 'year' && (
        <div className="flex items-center gap-2">
          <select value={filterYear} onChange={e => changeYear(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg pl-2.5 pr-1.5 py-1 bg-white text-gray-700">
            {years.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          {periodType === 'week' && (
            <select value={filterMonth} onChange={e => changeMonth(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg pl-2.5 pr-1.5 py-1 bg-white text-gray-700">
              {monthsInYear.map(m => <option key={m} value={m}>{parseInt(m, 10)}月</option>)}
            </select>
          )}
        </div>
      )}

      {visibleReports.length === 0 ? (
        <p className="text-sm text-gray-300 py-4">这段时间没有报告</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visibleReports.map(r => {
            const st = STATUS_LABELS[r.status]
            return (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-colors ${selectedId === r.id ? 'border-green-400 bg-green-50 text-green-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                {r.period_start} ~ {r.period_end}
                <span className={`px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {selectedId && <ReportDetailView reportId={selectedId} />}
    </div>
  )
}

function ReportDetailView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [siteWeights, setSiteWeights] = useState<Record<string, { pc: number; mobile: number }>>({})
  const [loading, setLoading] = useState(true)
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setExpandedSiteId(null)
    fetch(`/api/research/reports/${reportId}`).then(r => r.json()).then(d => {
      setReport(d.report)
      setSiteWeights(d.siteWeights ?? {})
    }).finally(() => setLoading(false))
  }, [reportId])

  if (loading || !report) return <Spinner />

  const analyzedSites = report.site_analyses.filter(s => !s.skipped && s.analysis)
  const skippedSites = report.site_analyses.filter(s => s.skipped)
  const failedSites = report.site_analyses.filter(s => !s.skipped && !s.analysis)
  const azSites: AZPickerSite[] = analyzedSites.map(s => ({
    id: s.site_id, domain: s.domain, name: s.name,
    pcWeight: s.pc_weight ?? siteWeights[s.site_id]?.pc ?? null,
    mobileWeight: s.mobile_weight ?? siteWeights[s.site_id]?.mobile ?? null,
    highlighted: (s.momentum_keywords?.length ?? 0) > 0,
  }))
  const expandedSite = analyzedSites.find(s => s.site_id === expandedSiteId) ?? null

  const sections = report.report_sections
  const envNote = sections?.environmentNote ?? sections?.environment ?? null
  const competitorNote = sections?.competitorNote ?? sections?.competitorEffectiveness ?? null
  // 老报告只有一段不分组的 ownEffectiveness 文字——只有一个组时可以直接当那个组的说明用；
  // 多个组时没法知道旧文字对应哪个组，宁可不显示也不要显示错组。
  const ownNoteFor = (groupName: string) =>
    sections?.ownGroupNotes?.[groupName] ??
    (report.own_effectiveness?.length === 1 ? sections?.ownEffectiveness : undefined) ?? null

  return (
    <div className="space-y-5">
      {report.status === 'failed' && report.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{report.error}</p>
      )}

      {envNote && (
        <div className="bg-white rounded-xl border border-sky-200 p-5">
          <p className="text-sm font-semibold mb-3 text-sky-700">大环境</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{envNote}</p>
        </div>
      )}

      {report.own_effectiveness && report.own_effectiveness.length > 0 && (
        <div className="bg-white rounded-xl border border-blue-200 p-5">
          <p className="text-sm font-semibold mb-3 text-blue-700">自己站点成效</p>
          <div className="space-y-4">
            {report.own_effectiveness.map((g, i) => {
              const note = ownNoteFor(g.group_name)
              return (
                <div key={g.group_id} className={i > 0 ? 'pt-4 border-t border-gray-100' : ''}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-800">{g.group_name}</span>
                    <span className="text-xs text-gray-400">获取排名{g.ranked} · 获取收录{g.indexed} · 追踪中{g.tracking}</span>
                  </div>
                  {note && <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed mb-1.5">{note}</p>}
                  {g.topClaims.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">本周发力最多的词（按评分，非搜索量）</p>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        {g.topClaims.slice(0, 5).map(c => `${c.keyword}(第${c.rank_position ?? '未排名'}名/量${c.volume}/分${c.score})`).join('、')}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {report.competitor_effectiveness && (
        <div className="bg-white rounded-xl border border-green-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-green-700">竞品成效</span>
            <span className="text-xs text-gray-400">
              有效{report.competitor_effectiveness.effective} · 追踪中{report.competitor_effectiveness.tracking} · 无效{report.competitor_effectiveness.invalid}
            </span>
          </div>
          {report.competitor_effectiveness.contentBreakdown && (
            <p className="text-xs text-gray-400 mb-2">
              游戏{report.competitor_effectiveness.contentBreakdown.游戏} · 应用{report.competitor_effectiveness.contentBreakdown.应用}
            </p>
          )}
          {competitorNote && <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed mb-2">{competitorNote}</p>}
          {report.competitor_effectiveness.topClaims.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">本周发力最多的词（按评分，非搜索量）</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                {report.competitor_effectiveness.topClaims.slice(0, 5).map(c => `${c.domain}·${c.keyword}(第${c.rank_position}名/量${c.volume}/分${c.score})`).join('、')}
              </p>
            </div>
          )}
        </div>
      )}

      {sections?.opportunityGaps && sections.opportunityGaps.length > 0 && (
        <div className="bg-white rounded-xl border border-rose-200 p-5">
          <p className="text-sm font-semibold mb-1 text-rose-700">机会缺口</p>
          <p className="text-xs text-gray-400 mb-3">竞品这期真正拿到效果、但我方历史上完全没做过的词，已按词群聚合</p>
          <div className="space-y-3">
            {sections.opportunityGaps.map((g, i) => {
              const p = PRIORITY_LABELS[g.priority] ?? PRIORITY_LABELS.low
              return (
                <div key={i} className="flex items-start gap-2">
                  <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 mt-0.5 ${p.bg} ${p.text}`}>{p.label}</span>
                  <div className="min-w-0">
                    <span className="text-sm text-gray-800 font-medium">{g.cluster}</span>
                    <span className="text-xs text-gray-400">　{g.category}·{g.keywordCount}词·量{g.totalVolume.toLocaleString()}</span>
                    <p className="text-xs text-gray-600 mt-0.5">{g.recommendation}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {sections?.conclusion && <ReportSectionCard title="综合结论" color="violet" text={sections.conclusion} />}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-700">各站点分析</span>
          <span className="text-xs text-gray-400">{analyzedSites.length} 个</span>
        </div>
        {analyzedSites.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-8">这段时间没有站点产出有效分析</p>
        ) : (
          <>
            <SiteAZPicker sites={azSites} selectedId={expandedSiteId} onSelect={id => setExpandedSiteId(prev => prev === id ? null : id)} />
            {expandedSite && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-sm font-medium text-gray-800 mb-1.5">{expandedSite.domain}（{expandedSite.name}）</p>
                {(expandedSite.pc_weight != null || expandedSite.mobile_weight != null || expandedSite.avg_index_count != null || expandedSite.avg_mobile_ip != null) && (
                  <p className="text-xs text-gray-400 mb-2">
                    权重 PC{expandedSite.pc_weight ?? '—'} · M{expandedSite.mobile_weight ?? '—'}
                    　收录均值{expandedSite.avg_index_count != null ? Math.round(expandedSite.avg_index_count).toLocaleString() : '—'}
                    　移动IP均值{expandedSite.avg_mobile_ip != null ? Math.round(expandedSite.avg_mobile_ip).toLocaleString() : '—'}
                  </p>
                )}
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{expandedSite.analysis}</p>

                {expandedSite.momentum_keywords && expandedSite.momentum_keywords.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-50">
                    <p className="text-xs font-medium text-gray-500 mb-1.5">本期发力词群</p>
                    {Array.from(new Set(expandedSite.momentum_keywords.map(k => k.cluster))).map(cluster => {
                      const kws = expandedSite.momentum_keywords!.filter(k => k.cluster === cluster)
                      return (
                        <div key={cluster} className="mb-1.5 last:mb-0">
                          <span className="text-xs text-gray-500">【{cluster}】</span>
                          <span className="text-xs text-gray-600">
                            {kws.map(k => `${k.keyword}(第${k.rankPosition ?? '未排名'}名${k.rankChange != null ? `/${k.rankChange > 0 ? '升' : k.rankChange < 0 ? '降' : '不变'}${Math.abs(k.rankChange)}` : '/新进榜'}/量${k.volume})`).join('、')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {expandedSite.findings && expandedSite.findings.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-50">
                    <p className="text-xs font-medium text-gray-500 mb-1.5">关键发现</p>
                    <div className="space-y-1.5">
                      {expandedSite.findings.map((f, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1 flex-shrink-0 mt-0.5">{CONFIDENCE_LABELS[f.confidence] ?? f.confidence}</span>
                          <p className="text-xs text-gray-600 leading-relaxed">{f.observation}——{f.interpretation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {(skippedSites.length > 0 || failedSites.length > 0) && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer hover:text-gray-600">跳过/失败的站点（{skippedSites.length + failedSites.length}个）</summary>
          <div className="mt-2 space-y-1 pl-2">
            {skippedSites.map(s => <p key={s.site_id}>{s.domain}：{s.skip_reason}</p>)}
            {failedSites.map(s => <p key={s.site_id} className="text-red-400">{s.domain}：{s.error}</p>)}
          </div>
        </details>
      )}
    </div>
  )
}

function ReportSectionCard({ title, color, text }: { title: string; color: 'sky' | 'blue' | 'green' | 'violet'; text: string }) {
  const borderMap = { sky: 'border-sky-200', blue: 'border-blue-200', green: 'border-green-200', violet: 'border-violet-200' }
  const textMap = { sky: 'text-sky-700', blue: 'text-blue-700', green: 'text-green-700', violet: 'text-violet-700' }
  return (
    <div className={`bg-white rounded-xl border ${borderMap[color]} p-5`}>
      <p className={`text-sm font-semibold mb-2 ${textMap[color]}`}>{title}</p>
      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{text || '（无内容）'}</p>
    </div>
  )
}
