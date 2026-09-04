'use client'

import Link from 'next/link'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { explainOutcomeScore, type UpdateEffectBreakdown } from '@/lib/outcome-score'

const SUBMISSION_PAGE_SIZE = 20
const DETAIL_PAGE_SIZE = 50
const SHOW_SUBMISSION_DETAILS = false

// ── Types ──────────────────────────────────────────────────────────────────────

interface Group {
  id: string; name: string; type: string
  site_domains: string[]; competitor_domains: string[]
  members: { user_id: string; username: string; member_type: string }[]
}

interface BySourceItem { source: string; count: number; volume: number }
interface DayEntry { date: string; count: number; volume: number }
interface MemberReport {
  userId: string; username: string; memberType: string
  total: { count: number; volume: number }
  bySource: BySourceItem[]; byDate: DayEntry[]
}
interface ReportData {
  period: string; startDate: string; endDate: string
  groupTotal: { total: { count: number; volume: number }; bySource: BySourceItem[] } | null
  members: MemberReport[]
}
interface OverviewGroup {
  id: string; name: string
  groupTotal: { total: { count: number; volume: number }; bySource: BySourceItem[] } | null
  members: Omit<MemberReport, 'byDate'>[]
}

interface DetailKw {
  id: string; keyword: string; source: string; search_volume: number
  operation_type: string | null; final_keyword: string | null; page_url: string | null
}

interface OutcomeRow {
  id: string; claim_id: string; user_id: string; username: string
  keyword: string; final_keyword: string | null
  page_url: string | null; operation_type: string | null
  search_volume: number
  submit_date: string; record_date: string
  is_indexed: boolean; index_first_seen: string | null; index_disappeared: string | null
  rank_keyword: string | null; rank_position: number | null; prev_rank_position: number | null
  rank_change: number | null; rank_volume: number; rank_date: string | null
  effectiveness: string
  env_excluded?: boolean
  source?: string | null
  rank_matches?: { keyword: string; rank_position: number | null; prev_rank_position: number | null; volume: number; isNewRank?: boolean }[]
  // 服务端算好的得分——'更新'类型走增量公式（需要历史查询判断"真新排名"，
  // 前端算不出来），'新增'类型走关键词价值公式；直接用这个而不是前端重算，
  // 保证跟排序（sortBy=score用的也是这个）显示的是同一个数字。
  score: number
  updateEffectBreakdown: UpdateEffectBreakdown | null
}
interface OutcomeSummary { total: number; rankedCount: number; indexedCount: number; trackingCount: number; invalidCount: number }
type OutcomeSortBy = 'submit_date' | 'record_date' | 'search_volume' | 'rank_position' | 'rank_volume' | 'score'
// 认领来源短标签，跟 task-groups 页面的 SourceTag 保持同一套映射，
// 2026-07-29 加入替代原来的"试点"C/T列。
const SOURCE_LABEL: Record<string, string> = { '竞品涨排名': '竞品涨排', '连续上涨词': '连续上涨', '共新增词': '共新增词', '搜索量查询': '搜索查询', '交叉词': '交叉词', '更新词库': '更新词库', '手动添加': '手动添加', '跌词更新': '跌词更新', '跌排更新': '跌排更新', '涨排更新': '涨排更新', '搜索上涨': '搜索上涨', '分发词': '分发词' }

type Period = 'yesterday' | 'week' | 'month' | 'custom'
type ReportTab = 'outcomes' | 'trackingSummary'

// ── Constants ──────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = { yesterday: '昨日', week: '本周', month: '本月', custom: '自定义' }

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  '竞品涨排名':  { bg: 'bg-purple-50',  text: 'text-purple-700' },
  '共新增词':    { bg: 'bg-blue-50',    text: 'text-blue-700' },
  '交叉词':      { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  '连续上涨词':  { bg: 'bg-orange-50',  text: 'text-orange-700' },
  '更新词库':    { bg: 'bg-teal-50',    text: 'text-teal-700' },
  '搜索量查询':  { bg: 'bg-gray-100',   text: 'text-gray-600' },
  '分发词':      { bg: 'bg-indigo-50',  text: 'text-indigo-700' },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtVol(v: number) {
  if (!v || v <= 0) return '—'
  return v.toLocaleString()
}
function fmtDate(d: string) { return d ? d.slice(5).replace('-', '/') : '' }

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || fallback)
  return body
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SourceTag({ source }: { source: string }) {
  const c = SOURCE_COLORS[source] ?? { bg: 'bg-gray-100', text: 'text-gray-500' }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${c.bg} ${c.text}`}>
      {source}
    </span>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <svg className="animate-spin h-6 w-6 text-green-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

function ReportCard({ title, memberType, total, bySource, isTotal }: {
  title: string; memberType?: string
  total: { count: number; volume: number }; bySource: BySourceItem[]; isTotal?: boolean
}) {
  return (
    <div className={`flex-shrink-0 w-56 rounded-xl border overflow-hidden ${isTotal ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-white'}`}>
      <div className={`px-4 py-3 flex items-center gap-2 border-b ${isTotal ? 'border-green-100 bg-green-50/60' : 'border-gray-100 bg-gray-50/60'}`}>
        <span className="text-sm font-semibold text-gray-800 truncate flex-1">{title}</span>
        {memberType && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${memberType === 'game' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
            {memberType === 'game' ? '游戏' : '应用'}
          </span>
        )}
      </div>
      <div className="divide-y divide-gray-50">
        <div className="grid grid-cols-[1fr_40px_56px] px-4 py-2.5 bg-gray-50/40">
          <span className="text-xs font-semibold text-gray-700">汇总</span>
          <span className="text-xs font-semibold text-gray-800 text-right">{total.count || '—'}</span>
          <span className="text-xs font-semibold text-gray-800 text-right">{fmtVol(total.volume)}</span>
        </div>
        {bySource.length === 0
          ? <div className="px-4 py-3 text-xs text-gray-300 text-center">暂无数据</div>
          : bySource.map(s => (
            <div key={s.source} className="grid grid-cols-[1fr_40px_56px] px-4 py-2">
              <span className="text-xs text-gray-500 truncate">{s.source}</span>
              <span className="text-xs text-gray-700 text-right">{s.count}</span>
              <span className="text-xs text-gray-700 text-right">{fmtVol(s.volume)}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function GroupReportPage({ groupId, initialTab = 'outcomes' }: {
  groupId?: string
  initialTab?: 'outcomes' | 'trackingSummary'
}) {
  const { role, id: currentUserId } = useUser()
  const router = useRouter()
  const canSeeAll = role === 'super' || role === 'admin'

  const [groups, setGroups] = useState<Group[]>([])
  const [activeTabId, setActiveTabId] = useState<string>(groupId ?? '')
  const [reportTab, setReportTab] = useState<ReportTab>(initialTab)
  const [period, setPeriod] = useState<Period>('yesterday')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterUserId, setFilterUserId] = useState('all')
  const [subPage, setSubPage] = useState(0)
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [overviewGroups, setOverviewGroups] = useState<OverviewGroup[]>([])
  const [overviewLoading, setOverviewLoading] = useState(!groupId)
  const [loadError, setLoadError] = useState<{ scope: string; message: string } | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // Detail modal state
  const [detailModal, setDetailModal] = useState<{ date: string; userId: string; username: string } | null>(null)
  const [detailKws, setDetailKws] = useState<DetailKw[]>([])
  const [detailTotal, setDetailTotal] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailPage, setDetailPage] = useState(0)

  // Outcomes tab state
  const [scoreDetailRow, setScoreDetailRow] = useState<OutcomeRow | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([])
  const [outcomeSummary, setOutcomeSummary] = useState<OutcomeSummary | null>(null)
  const [outcomeGroupSummary, setOutcomeGroupSummary] = useState<OutcomeSummary | null>(null)
  const [outcomeTotalRows, setOutcomeTotalRows] = useState(0)
  const [outcomesLoading, setOutcomesLoading] = useState(false)
  const [outcomesTruncated, setOutcomesTruncated] = useState(false)
  const [oFilterMember, setOFilterMember] = useState('')
  const [oFilterOp, setOFilterOp] = useState('')
  const [oFilterKw, setOFilterKw] = useState('')
  const [oFilterIndex, setOFilterIndex] = useState('')
  const [oFilterRankKw, setOFilterRankKw] = useState('')
  const [oFilterOutcome, setOFilterOutcome] = useState('')
  const [oSortBy, setOSortBy] = useState<OutcomeSortBy>('score')
  const [oSortDir, setOSortDir] = useState<'asc' | 'desc'>('desc')
  const [oPage, setOPage] = useState(0)
  const [oPageSize, setOPageSize] = useState(20)

  // 追踪汇总 tab state
  interface SourceEff { source: string; total: number; ranked: number; indexed: number }
  interface TrackingBucket { label: string; count: number; volume: number; bySource: { source: string; count: number }[] }
  interface TrackingSummary {
    userId: string; username: string
    submitted: { total: number }
    indexed: { count: number; volume: number; bySource: { source: string; count: number }[] }
    ranked: { total: number; totalVolume: number; buckets: TrackingBucket[] }
    totalScore: number
  }
  interface RankingEntry {
    rank: number; userId: string; username: string
    // null = 屏蔽的其他组员数据（能看到排名和姓名，看不到具体数字），
    // 跟"真实值为0"要能区分开，所以不能直接用0代替。
    submitted: number | null; ranked: number | null; indexed: number | null; totalScore: number | null
  }
  interface TrackingSummaryResponse {
    month: string; canSeeAll: boolean; isMember: boolean; scope: string
    computedAt?: string; fromCache?: boolean
    memberList?: { userId: string; username: string }[]
    summary: TrackingSummary
    groupSummary?: TrackingSummary
    ranking: RankingEntry[]
    groupSourceEffectiveness: SourceEff[]
    scopeSourceEffectiveness: SourceEff[]
  }
  interface SourceDetailTarget { kind: 'indexed' | 'rank'; bucket?: string }
  interface SourceDetailRow {
    keyword: string; final_keyword: string | null
    search_volume?: number; rank_position?: number; rank_keyword?: string; rank_volume?: number
    source: string; operation_type: string | null; username?: string
  }
  const [trackingMonth, setTrackingMonth] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7))
  const [trackingData, setTrackingData] = useState<TrackingSummaryResponse | null>(null)
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [trackingScope, setTrackingScope] = useState<string>(() => (canSeeAll ? 'total' : 'own'))
  const [sourceDetailModal, setSourceDetailModal] = useState<SourceDetailTarget | null>(null)
  const [sourceDetailRows, setSourceDetailRows] = useState<SourceDetailRow[]>([])
  const [sourceDetailTotal, setSourceDetailTotal] = useState(0)
  const [sourceDetailPage, setSourceDetailPage] = useState(0)
  const [sourceDetailLoading, setSourceDetailLoading] = useState(false)
  const sourceDetailTotalPages = Math.max(1, Math.ceil(sourceDetailTotal / DETAIL_PAGE_SIZE))

  const today = useMemo(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), [])

  useEffect(() => { setReportTab(initialTab) }, [groupId, initialTab])

  // Load groups
  useEffect(() => {
    if (!groupId) {
      setGroups([])
      setGroupsLoading(false)
      return
    }
    setGroupsLoading(true)
    fetch('/api/task-groups').then(r => readResponse<{ groups?: Group[] }>(r, '分组加载失败')).then(d => {
      const g: Group[] = (d.groups || []).map((grp: Group) => ({
        ...grp, site_domains: grp.site_domains || [], competitor_domains: grp.competitor_domains || [],
      }))
      setGroups(g)
      if (groupId) {
        setActiveTabId(g.some(group => group.id === groupId) ? groupId : '')
      }
      setLoadError(current => current?.scope === 'groups' ? null : current)
    }).catch(error => setLoadError({ scope: 'groups', message: error instanceof Error ? error.message : '分组加载失败' }))
      .finally(() => setGroupsLoading(false))
  }, [groupId, retryNonce])

  // The report landing page loads every visible group's submission overview in
  // one API request. Detailed outcome/tracking data remains isolated per route.
  useEffect(() => {
    if (groupId) return
    if (period === 'custom' && (!customStart || !customEnd || customStart > customEnd)) return
    setOverviewLoading(true)
    const params = new URLSearchParams({ period })
    if (period === 'custom') {
      params.set('startDate', customStart)
      params.set('endDate', customEnd)
    }
    fetch(`/api/task-groups/report-overview?${params}`)
      .then(response => readResponse<{ groups?: OverviewGroup[] }>(response, '提交概况加载失败'))
      .then(data => {
        setOverviewGroups(data.groups || [])
        setLoadError(current => current?.scope === 'overview' ? null : current)
      })
      .catch(error => setLoadError({ scope: 'overview', message: error instanceof Error ? error.message : '提交概况加载失败' }))
      .finally(() => setOverviewLoading(false))
  }, [groupId, period, customStart, customEnd, retryNonce])

  // Load member report
  useEffect(() => {
    if (!SHOW_SUBMISSION_DETAILS || !activeTabId) return
    if (period === 'custom') {
      if (!customStart || !customEnd || customStart > customEnd) return
    }
    setLoading(true)
    setReport(null)
    setSubPage(0)
    setFilterUserId('all')
    const url = period === 'custom'
      ? `/api/task-groups/${activeTabId}/report?period=custom&startDate=${customStart}&endDate=${customEnd}`
      : `/api/task-groups/${activeTabId}/report?period=${period}`
    fetch(url).then(r => readResponse<ReportData>(r, '提交报告加载失败')).then(d => {
      setReport(d)
      setLoadError(current => current?.scope === 'report' ? null : current)
    }).catch(error => setLoadError({ scope: 'report', message: error instanceof Error ? error.message : '提交报告加载失败' }))
      .finally(() => setLoading(false))
  }, [activeTabId, period, customStart, customEnd, retryNonce])

  // Reset outcome filters when switching groups
  useEffect(() => {
    setOFilterMember('')
    setOFilterOp('')
    setOFilterKw('')
    setOFilterIndex('')
    setOFilterRankKw('')
    setOFilterOutcome('')
    setOPage(0)
  }, [activeTabId])

  // Load outcomes data — server-side paginated: every filter/sort/page change
  // re-fetches just the one page being displayed, plus summary/pilot stats
  // computed over the full filtered set. Changing a filter or sort resets
  // oPage to 0 at the call site (see the various onChange handlers below);
  // oPage itself is a dependency here so Prev/Next re-fetches the new page.
  function loadOutcomes() {
    if (!activeTabId || reportTab !== 'outcomes') return
    setOutcomesLoading(true)
    const p = new URLSearchParams()
    if (oFilterMember)        p.set('memberId',      oFilterMember)
    if (oFilterOp)            p.set('opType',        oFilterOp)
    if (oFilterKw)            p.set('keyword',       oFilterKw)
    if (oFilterIndex)         p.set('indexed',       oFilterIndex)
    if (oFilterRankKw)        p.set('rankKeyword',   oFilterRankKw)
    if (oFilterOutcome)       p.set('outcome',       oFilterOutcome)
    p.set('sortBy',  oSortBy)
    p.set('sortDir', oSortDir)
    p.set('page',     String(oPage))
    p.set('pageSize', String(oPageSize))
    fetch(`/api/task-groups/${activeTabId}/outcomes?${p}`)
      .then(r => readResponse<{ rows?: OutcomeRow[]; summary?: OutcomeSummary; groupSummary?: OutcomeSummary; totalRows?: number; truncated?: boolean }>(r, '成效追踪加载失败'))
      .then(d => {
        setOutcomes(d.rows || [])
        setOutcomeSummary(d.summary || null)
        setOutcomeGroupSummary(d.groupSummary || null)
        setOutcomeTotalRows(d.totalRows ?? 0)
        setOutcomesTruncated(!!d.truncated)
        setLoadError(current => current?.scope === 'outcomes' ? null : current)
      })
      .catch(error => setLoadError({ scope: 'outcomes', message: error instanceof Error ? error.message : '成效追踪加载失败' }))
      .finally(() => setOutcomesLoading(false))
  }
  useEffect(loadOutcomes, [activeTabId, reportTab, oFilterMember, oFilterOp, oFilterKw, oFilterIndex, oFilterRankKw, oFilterOutcome, oSortBy, oSortDir, oPage, oPageSize, retryNonce])

  // Load tracking summary
  function scopeParams(month: string, scope: string): URLSearchParams {
    const p = new URLSearchParams({ month })
    if (scope === 'total' || scope === 'own') p.set('scope', scope)
    else { p.set('scope', 'member'); p.set('memberId', scope) }
    return p
  }

  async function refreshTrackingSummary() {
    if (!activeTabId || !canSeeAll) return
    setTrackingLoading(true)
    try {
      const params = scopeParams(trackingMonth, trackingScope)
      params.set('refresh', '1')
      const response = await fetch(`/api/task-groups/${activeTabId}/tracking-summary?${params}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '刷新失败')
      setTrackingData(data)
      setLoadError(current => current?.scope === 'tracking' ? null : current)
    } catch (error) {
      setLoadError({ scope: 'tracking', message: error instanceof Error ? error.message : '追踪汇总刷新失败' })
    } finally {
      setTrackingLoading(false)
    }
  }
  useEffect(() => {
    if (reportTab !== 'trackingSummary' || !activeTabId) return
    setTrackingLoading(true)
    fetch(`/api/task-groups/${activeTabId}/tracking-summary?${scopeParams(trackingMonth, trackingScope)}`)
      .then(r => readResponse<TrackingSummaryResponse>(r, '追踪汇总加载失败'))
      .then(d => {
        setTrackingData(d)
        if (!d.canSeeAll && trackingScope !== 'own') setTrackingScope('own')
        setLoadError(current => current?.scope === 'tracking' ? null : current)
      })
      .catch(error => setLoadError({ scope: 'tracking', message: error instanceof Error ? error.message : '追踪汇总加载失败' }))
      .finally(() => setTrackingLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportTab, activeTabId, trackingMonth, trackingScope, retryNonce])

  // Load source-detail drill-down (获取收录/排名区间"查看")，50条/页
  useEffect(() => {
    if (!sourceDetailModal || !activeTabId) return
    setSourceDetailLoading(true)
    setSourceDetailRows([])
    const p = scopeParams(trackingMonth, trackingScope)
    p.set('kind', sourceDetailModal.kind)
    if (sourceDetailModal.bucket) p.set('bucket', sourceDetailModal.bucket)
    p.set('page', String(sourceDetailPage))
    fetch(`/api/task-groups/${activeTabId}/tracking-summary/detail?${p}`)
      .then(r => readResponse<{ rows?: SourceDetailRow[]; total?: number }>(r, '追踪详情加载失败'))
      .then(d => { setSourceDetailRows(d.rows || []); setSourceDetailTotal(d.total || 0) })
      .catch(error => setLoadError({ scope: 'sourceDetail', message: error instanceof Error ? error.message : '追踪详情加载失败' }))
      .finally(() => setSourceDetailLoading(false))
  }, [sourceDetailModal, activeTabId, trackingMonth, trackingScope, sourceDetailPage, retryNonce])

  // Load detail keywords on demand
  useEffect(() => {
    if (!SHOW_SUBMISSION_DETAILS || !detailModal || !activeTabId) return
    setDetailLoading(true)
    setDetailKws([])
    const url = `/api/task-groups/${activeTabId}/report/keywords?memberId=${detailModal.userId}&date=${detailModal.date}&page=${detailPage}&pageSize=${DETAIL_PAGE_SIZE}`
    fetch(url).then(r => readResponse<{ keywords?: DetailKw[]; total?: number }>(r, '提交详情加载失败')).then(d => {
      setDetailKws(d.keywords || [])
      setDetailTotal(d.total || 0)
    }).catch(error => setLoadError({ scope: 'detail', message: error instanceof Error ? error.message : '提交详情加载失败' }))
      .finally(() => setDetailLoading(false))
  }, [detailModal, detailPage, activeTabId, retryNonce])

  // Build flat submission rows from report data
  const submissionRows = useMemo(() => {
    if (!report) return []
    const rows: { key: string; date: string; userId: string; username: string; count: number; volume: number }[] = []
    for (const member of report.members) {
      for (const day of member.byDate) {
        if (day.count === 0) continue
        rows.push({ key: `${day.date}|${member.userId}`, date: day.date, userId: member.userId, username: member.username, count: day.count, volume: day.volume })
      }
    }
    rows.sort((a, b) => b.date !== a.date ? b.date.localeCompare(a.date) : a.username.localeCompare(b.username))
    return rows
  }, [report])

  const filteredRows = filterUserId === 'all' ? submissionRows : submissionRows.filter(r => r.userId === filterUserId)
  const totalRows = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(totalRows / SUBMISSION_PAGE_SIZE))
  const pagedRows = filteredRows.slice(subPage * SUBMISSION_PAGE_SIZE, (subPage + 1) * SUBMISSION_PAGE_SIZE)

  const detailTotalPages = Math.max(1, Math.ceil(detailTotal / DETAIL_PAGE_SIZE))

  const hasData = report && (report.groupTotal?.total.count ?? report.members.reduce((s, m) => s + m.total.count, 0)) > 0
  const activeGroup = groups.find(group => group.id === activeTabId) ?? null
  const hasVisibleGroups = groupId ? groups.length > 0 : overviewGroups.length > 0
  const showSubmissionDetails = SHOW_SUBMISSION_DETAILS

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">成效报告</p>
            <h1 className="text-lg font-semibold text-gray-900">{groupId ? (activeGroup?.name || '选择分组') : '全部分组提交概况'}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{groupId ? '成效追踪与追踪总汇' : '集中查看所有可见分组及成员的提交情况'}</p>
          </div>
          {groupId && groups.length > 0 && (
            <select aria-label="切换成效报告分组" value={activeTabId}
              onChange={event => router.push(`/group-report/${encodeURIComponent(event.target.value)}?view=${reportTab === 'trackingSummary' ? 'summary' : 'outcomes'}`)}
              className="min-w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:outline-none focus:ring-green-500">
              {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {loadError && (
        <div role="alert" className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{loadError.message}。请检查网络后重试。</span>
          <button type="button" onClick={() => setRetryNonce(value => value + 1)}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-500">
            重试
          </button>
        </div>
      )}

      {(groupId && groupsLoading) || (!groupId && overviewLoading) ? <Spinner /> : !hasVisibleGroups ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">暂无分组</div>
      ) : !groupId ? (
        <div className="px-6 py-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">提交概况</h2>
              <p className="text-xs text-gray-400">点击分组名称进入该组的成效追踪与追踪总汇</p>
            </div>
            <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
              {(['yesterday', 'week', 'month', 'custom'] as Period[]).map(value => (
                <button key={value} type="button" onClick={() => setPeriod(value)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === value ? 'bg-green-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                  {PERIOD_LABELS[value]}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="flex items-center gap-2">
                <input aria-label="全部分组提交概况开始日期" type="date" value={customStart} max={customEnd || today}
                  onChange={event => setCustomStart(event.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500" />
                <span className="text-sm text-gray-400">至</span>
                <input aria-label="全部分组提交概况结束日期" type="date" value={customEnd} min={customStart} max={today}
                  onChange={event => setCustomEnd(event.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            )}
          </div>

          {overviewGroups.map(group => {
            const totalCount = group.groupTotal?.total.count ?? group.members.reduce((sum, member) => sum + member.total.count, 0)
            return (
              <section key={group.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
                  <div>
                    <Link href={`/group-report/${encodeURIComponent(group.id)}?view=outcomes`}
                      className="inline-flex items-center gap-1.5 text-base font-semibold text-gray-900 hover:text-green-700 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-green-500">
                      {group.name}<span aria-hidden="true">→</span>
                    </Link>
                    <p className="mt-0.5 text-xs text-gray-400">提交概况</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">{PERIOD_LABELS[period]}</span>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {canSeeAll && group.groupTotal && (
                    <ReportCard title="全部组员合计" total={group.groupTotal.total} bySource={group.groupTotal.bySource} isTotal />
                  )}
                  {group.members.map(member => (
                    <ReportCard key={member.userId} title={member.username} memberType={member.memberType} total={member.total} bySource={member.bySource} />
                  ))}
                </div>
                {totalCount === 0 && (
                  <p className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">
                    {PERIOD_LABELS[period]}暂无提交记录
                  </p>
                )}
              </section>
            )
          })}
        </div>
      ) : !activeGroup ? (
        <div className="mx-6 mt-5 flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-20 text-center">
          <p className="text-sm font-medium text-gray-700">无法查看这个分组的成效报告</p>
          <p className="mt-1 text-xs text-gray-400">分组不存在，或者你没有该分组权限。</p>
          <Link href="/group-report" className="mt-4 btn-secondary">选择其他分组</Link>
        </div>
      ) : (
        <div className="px-6 py-5 space-y-5">
          {/* Only the two result views remain as tabs. */}
          <div className="flex items-center gap-0 border-b border-gray-100">
            {([['outcomes', '成效追踪'], ['trackingSummary', '追踪总汇']] as [ReportTab, string][]).map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => {
                setReportTab(tab)
                router.replace(`/group-report/${encodeURIComponent(activeTabId)}?view=${tab === 'trackingSummary' ? 'summary' : 'outcomes'}`)
              }}
                className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${reportTab === tab ? 'border-green-500 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* ── 成效追踪 ── */}
          {reportTab === 'outcomes' && (() => {
            const OCOLS = 'grid-cols-[48px_2fr_60px_80px_70px_88px_1.5fr_60px_76px_56px_70px_70px_70px]'
            const anyFilter = !!(oFilterMember || oFilterOp || oFilterIndex || oFilterOutcome || oFilterKw || oFilterRankKw)
            // outcomes already holds just the current page — pagination and
            // totals are computed server-side against the full filtered set
            // (see outcomeTotalRows) so this page never has to hold more than
            // oPageSize rows in the browser at once.
            const displayTotal = outcomeTotalRows
            const oTotalPages = Math.max(1, Math.ceil(displayTotal / oPageSize))
            const pagedO = outcomes
            function oSortIcons(col: OutcomeSortBy) {
              const isAsc  = oSortBy === col && oSortDir === 'asc'
              const isDesc = oSortBy === col && oSortDir === 'desc'
              return (
                <span className="inline-flex flex-col items-center gap-px select-none ml-0.5">
                  <svg onClick={(e) => { e.stopPropagation(); setOSortBy(col); setOSortDir('asc');  setOPage(0) }} viewBox="0 0 8 5" width="8" height="5" fill="currentColor"
                    className={`cursor-pointer ${isAsc  ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 0L8 5H0Z"/></svg>
                  <svg onClick={(e) => { e.stopPropagation(); setOSortBy(col); setOSortDir('desc'); setOPage(0) }} viewBox="0 0 8 5" width="8" height="5" fill="currentColor"
                    className={`cursor-pointer ${isDesc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 5L0 0H8Z"/></svg>
                </span>
              )
            }
            return (
              <div className="space-y-4">
                {outcomesTruncated && (
                  <div className="mx-4 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center gap-2">
                    <span className="font-bold">⚠</span>
                    数据获取时发生变化（可能有记录被同时修改），请刷新页面重试。
                  </div>
                )}
                {outcomeSummary && (() => {
                  // 管理员/超管从"全部成员"切到某个具体组员时，卡片主数字改成
                  // "该组员 / 全组同筛选条件下的总数"，方便对比（2026-08-04 请求）。
                  const showRatio = !!(oFilterMember && canSeeAll && outcomeGroupSummary)
                  const ratioStr = (mine: number, group: number) => showRatio ? `${mine.toLocaleString()} / ${group.toLocaleString()}` : mine.toLocaleString()
                  const g = outcomeGroupSummary ?? outcomeSummary
                  return (
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: '已追踪记录', value: ratioStr(outcomeSummary.total, g.total), sub: '全部提交' },
                      { label: '获取排名', value: ratioStr(outcomeSummary.rankedCount, g.rankedCount), sub: outcomeSummary.total ? `排名率 ${Math.round(outcomeSummary.rankedCount / outcomeSummary.total * 100)}%` : '—', color: 'text-green-600' },
                      { label: '获取收录', value: ratioStr(outcomeSummary.indexedCount, g.indexedCount), sub: outcomeSummary.total ? `收录率 ${Math.round((outcomeSummary.rankedCount + outcomeSummary.indexedCount) / outcomeSummary.total * 100)}%` : '—', color: 'text-blue-600' },
                      { label: '追踪中', value: ratioStr(outcomeSummary.trackingCount, g.trackingCount), sub: `无效 ${outcomeSummary.invalidCount}` },
                    ].map(s => (
                      <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                        <div className={`font-bold tabular-nums ${(s as { color?: string }).color ?? 'text-gray-800'} ${showRatio ? 'text-lg' : 'text-2xl'}`}>{s.value}</div>
                        <div className="text-xs font-medium text-gray-600 mt-0.5">{s.label}</div>
                        <div className="text-[11px] text-gray-400">{s.sub}</div>
                      </div>
                    ))}
                  </div>
                  )
                })()}
                <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {canSeeAll && activeGroup.members.length > 1 && (
                      <select aria-label="选择选项" value={oFilterMember} onChange={e => { setOFilterMember(e.target.value); setOPage(0) }}
                        className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white">
                        <option value="">全部成员</option>
                        {activeGroup.members.map(member => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}
                      </select>
                    )}
                    <select aria-label="选择选项" value={oFilterOp} onChange={e => { setOFilterOp(e.target.value); setOPage(0) }}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white">
                      <option value="">全部操作</option>
                      <option value="新增">新增</option>
                      <option value="更新">更新</option>
                    </select>
                    <select aria-label="选择选项" value={oFilterIndex} onChange={e => { setOFilterIndex(e.target.value); setOPage(0) }}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white">
                      <option value="">全部收录</option>
                      <option value="has">已收录</option>
                      <option value="none">未收录</option>
                    </select>
                    <select aria-label="选择选项" value={oFilterOutcome} onChange={e => { setOFilterOutcome(e.target.value); setOPage(0) }}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white">
                      <option value="">全部成效</option>
                      <option value="获取排名">获取排名</option>
                      <option value="获取收录">获取收录</option>
                      <option value="追踪中">追踪中</option>
                      <option value="无效">无效</option>
                    </select>
                    <input aria-label="输入内容" value={oFilterKw} onChange={e => { setOFilterKw(e.target.value); setOPage(0) }}
                      placeholder="搜索关键词 / 最终词…"
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 w-44" />
                    <input aria-label="输入内容" value={oFilterRankKw} onChange={e => { setOFilterRankKw(e.target.value); setOPage(0) }}
                      placeholder="搜索排名词…"
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 w-36" />
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                    <span className="text-sm font-semibold text-gray-700">动作成效明细</span>
                    <span className="text-xs text-gray-400 ml-2">每条提交动作的排名与收录结果</span>
                  </div>
                  {outcomesLoading ? <Spinner /> : displayTotal === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                      <svg className="w-10 h-10 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm">{anyFilter ? '没有符合筛选条件的记录' : '暂无数据，组员提交带 URL + 最终词的操作后自动显示'}</span>
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <div className={`grid ${OCOLS} gap-x-2 px-4 py-2 bg-gray-50/40 border-b border-gray-100 min-w-[980px]`}>
                          <span className="text-[11px] font-medium text-gray-400 text-center">操作</span>
                          <span className="text-[11px] font-medium text-gray-400">最终词 → 关键词</span>
                          <span className="text-[11px] font-medium text-gray-400 inline-flex items-center justify-center">搜索量{oSortIcons('search_volume')}</span>
                          <span className="text-[11px] font-medium text-gray-400 text-center">来源</span>
                          <span className="text-[11px] font-medium text-gray-400 text-center">收录</span>
                          <span className="text-[11px] font-medium text-gray-400 inline-flex items-center justify-center">排名{oSortIcons('rank_position')}</span>
                          <span className="text-[11px] font-medium text-gray-400">排名词</span>
                          <span className="text-[11px] font-medium text-gray-400 inline-flex items-center justify-center">排名量{oSortIcons('rank_volume')}</span>
                          <span className="text-[11px] font-medium text-gray-400 text-center">成效</span>
                          <span className="text-[11px] font-medium text-gray-400 inline-flex items-center justify-center">得分{oSortIcons('score')}</span>
                          <span className="text-[11px] font-medium text-gray-400 inline-flex items-center justify-center">提交日期{oSortIcons('submit_date')}</span>
                          <span className="text-[11px] font-medium text-gray-400 inline-flex items-center justify-center">记录日期{oSortIcons('record_date')}</span>
                          <span className="text-[11px] font-medium text-gray-400 text-center">成员</span>
                        </div>
                        <div className="divide-y divide-gray-50 min-w-[980px]">
                          {pagedO.map(row => {
                            return (
                              <div key={row.id} className={`grid ${OCOLS} gap-x-2 px-4 py-2.5 hover:bg-gray-50/60 transition-colors items-center`}>
                                <div className="flex justify-center">
                                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${row.operation_type === '新增' ? 'bg-green-50 text-green-600' : row.operation_type === '更新' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                                    {row.operation_type ?? '—'}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-gray-800 truncate" title={row.final_keyword || row.keyword}>{row.final_keyword || row.keyword}</div>
                                  {row.final_keyword
                                    ? <div className="text-xs text-green-600 truncate" title={row.keyword}>→ {row.keyword}</div>
                                    : <div className="text-xs text-gray-300">—</div>}
                                </div>
                                <div className="text-sm text-gray-600 tabular-nums text-center">{fmtVol(row.search_volume)}</div>
                                <span className="text-xs text-gray-500 text-center truncate" title={row.source ?? ''}>
                                  {SOURCE_LABEL[row.source ?? ''] ?? row.source ?? '—'}
                                </span>
                                <div className="text-center">
                                  {row.is_indexed
                                    ? <span className="text-sm text-blue-600">{row.index_first_seen ? row.index_first_seen.slice(5).replace('-', '/') : '已收录'}</span>
                                    : <span className="text-sm text-red-400">未收录</span>}
                                </div>
                                {(() => {
                                  // rank_matches holds every 爱站 keyword matched to this claim's page_url
                                  // (not just the single "best" one on the row itself) — show them all,
                                  // stacked, per the user's request. Falls back to the single scalar
                                  // fields for rows predating this table / with no matches.
                                  const matches = row.rank_matches && row.rank_matches.length > 0
                                    ? row.rank_matches
                                    : (row.rank_keyword || row.rank_position != null)
                                      ? [{ keyword: row.rank_keyword, rank_position: row.rank_position, prev_rank_position: row.prev_rank_position, volume: row.rank_volume }]
                                      : []
                                  if (matches.length === 0) {
                                    return (
                                      <>
                                        <div className="flex items-center justify-center"><span className="text-sm text-gray-300">—</span></div>
                                        <div className="min-w-0"><span className="text-sm text-gray-300">—</span></div>
                                        <div className="text-sm text-gray-300 text-center">—</div>
                                      </>
                                    )
                                  }
                                  return (
                                    <>
                                      <div className="flex flex-col gap-1">
                                        {matches.map((m, i) => {
                                          const mc = (m.rank_position != null && m.prev_rank_position != null) ? m.prev_rank_position - m.rank_position : null
                                          // 'isNewRank' 只在这条是"真新排名"（历史上从没排过名，不是这条claim
                                          // 刚开始追踪、还没攒够前一天数据）时才有意义——见
                                          // app/api/task-groups/[id]/outcomes/route.ts 的历史查询。
                                          const isNew = 'isNewRank' in m && m.isNewRank
                                          return (
                                            <div key={i} className="flex items-center justify-center gap-1.5">
                                              {m.rank_position != null
                                                ? <span className="text-sm text-gray-700">第{m.rank_position}名</span>
                                                : <span className="text-sm text-gray-300">—</span>}
                                              {isNew && (
                                                <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 rounded-full px-1.5">新</span>
                                              )}
                                              {!isNew && mc != null && mc !== 0 && (
                                                <span className={`text-xs font-semibold tabular-nums ${mc > 0 ? 'text-green-600' : 'text-red-400'}`}>
                                                  {mc > 0 ? `+${mc}` : `${mc}`}
                                                </span>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                      <div className="flex flex-col gap-1 min-w-0">
                                        {matches.map((m, i) => (
                                          <div key={i} className="text-sm text-gray-700 truncate" title={m.keyword ?? ''}>{m.keyword ?? '—'}</div>
                                        ))}
                                      </div>
                                      <div className="flex flex-col gap-1">
                                        {matches.map((m, i) => (
                                          <div key={i} className="text-sm text-gray-500 tabular-nums text-center">{m.volume.toLocaleString()}</div>
                                        ))}
                                      </div>
                                    </>
                                  )
                                })()}
                                <div className="flex justify-center">
                                  {row.effectiveness === '获取排名' && <span className="text-xs whitespace-nowrap bg-green-50 text-green-600 border border-green-200 px-1.5 py-0.5 rounded-full">获取排名</span>}
                                  {row.effectiveness === '获取收录' && <span className="text-xs whitespace-nowrap bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded-full">获取收录</span>}
                                  {row.effectiveness === '追踪中'   && <span className="text-xs whitespace-nowrap bg-gray-100 text-gray-400 border border-gray-200 px-1.5 py-0.5 rounded-full">追踪中</span>}
                                  {row.effectiveness === '无效'     && <span className="text-xs whitespace-nowrap bg-red-50 text-red-400 border border-red-200 px-1.5 py-0.5 rounded-full">无效</span>}
                                </div>
                                {(() => {
                                  const score = row.score
                                  if (row.effectiveness === '追踪中' && score === 0) return (
                                    <button onClick={() => setScoreDetailRow(row)} className="w-full text-center text-xs text-gray-300 hover:text-gray-500 transition-colors">—</button>
                                  )
                                  if (row.env_excluded) return (
                                    <button onClick={() => setScoreDetailRow(row)} className="w-full text-center hover:opacity-70 transition-opacity" title="记录日期环境异常（全站大跌或抓取失败），未计入规则平均分">
                                      <span className="text-sm font-bold tabular-nums text-gray-300">{score.toFixed(1)}</span>
                                      <span className="text-[9px] text-gray-300 block leading-none">环境</span>
                                    </button>
                                  )
                                  // 分数不再封顶（排名量用log10加权），旧的70/40分档阈值已经没有意义
                                  // ——改成按正负号三色：创造了价值/暂无价值/被扣分
                                  const color = score > 0 ? 'text-green-600' : score < 0 ? 'text-red-400' : 'text-gray-400'
                                  return (
                                    <button onClick={() => setScoreDetailRow(row)} className="w-full text-center hover:opacity-70 transition-opacity">
                                      <span className={`text-sm font-bold tabular-nums underline decoration-dotted decoration-gray-300 underline-offset-2 ${color}`}>{score.toFixed(1)}</span>
                                    </button>
                                  )
                                })()}
                                <span className="text-sm text-gray-500 text-center">{(row.submit_date ?? '').slice(5).replace('-', '/')}</span>
                                <span className="text-sm text-gray-500 text-center">{row.record_date.slice(5).replace('-', '/')}</span>
                                <span className="text-sm text-gray-700 text-center truncate" title={row.username}>{row.username}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/40">
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>第 {oPage * oPageSize + 1}–{Math.min((oPage + 1) * oPageSize, displayTotal)} 条，共 {displayTotal} 条</span>
                          <span className="text-gray-200 mx-1">|</span>
                          <span>每页</span>
                          {([20, 40, 60] as const).map(n => (
                            <button key={n} onClick={() => { setOPageSize(n); setOPage(0) }}
                              className={`px-2 py-0.5 rounded border transition-colors ${oPageSize === n ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                              {n}
                            </button>
                          ))}
                          <span>条</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button disabled={oPage === 0} onClick={() => setOPage(p => p - 1)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">上一页</button>
                          <span className="text-xs text-gray-400 px-2">{oPage + 1} / {oTotalPages}</span>
                          <button disabled={oPage >= oTotalPages - 1} onClick={() => setOPage(p => p + 1)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">下一页</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── 追踪汇总 ── */}
          {reportTab === 'trackingSummary' && (() => {
            if (trackingLoading || !trackingData) return <Spinner />
            const shiftMonth = (delta: number) => {
              const [y, m] = trackingMonth.split('-').map(Number)
              const d = new Date(Date.UTC(y, m - 1 + delta, 1))
              setTrackingMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
            }
            const isCurrentMonth = trackingMonth === new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
            const { summary: view, groupSummary, ranking, groupSourceEffectiveness, scopeSourceEffectiveness } = trackingData

            const SourceEffCards = ({ title, stats }: { title: string; stats: SourceEff[] }) => (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">{title}</p>
                {stats.length === 0 ? (
                  <p className="text-sm text-gray-300 py-2">暂无数据</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {stats.map(s => {
                      const skl = SOURCE_COLORS[s.source]
                      const effectiveRate = s.total > 0 ? Math.round((s.indexed + s.ranked * 2) / s.total * 100) : null
                      return (
                        <div key={s.source} className={`flex-shrink-0 rounded-xl border px-4 py-3 min-w-[130px] ${skl ? `border-transparent ${skl.bg}` : 'bg-white border-gray-100'}`}>
                          <p className={`text-xs font-semibold truncate ${skl ? skl.text : 'text-gray-700'}`}>{SOURCE_LABEL[s.source] ?? s.source}</p>
                          <p className="text-xl font-bold text-gray-800 mt-1">{s.total.toLocaleString()}</p>
                          <div className="mt-1 space-y-0.5">
                            {effectiveRate !== null && (
                              <p className="text-[10px] text-gray-500">有效率 <span className={`font-semibold ${effectiveRate >= 30 ? 'text-green-600' : 'text-amber-500'}`}>{effectiveRate}%</span></p>
                            )}
                            <p className="text-[10px] text-gray-400">{s.indexed} 已收录</p>
                            <p className="text-[10px] text-gray-400">{s.ranked} 已排名</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )

            return (
              <div>
                <div className="flex items-center gap-3 mb-5 flex-wrap">
                  <div className="flex items-center gap-1">
                    <button onClick={() => shiftMonth(-1)} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100">‹</button>
                    <span className="text-sm font-medium text-gray-700 tabular-nums w-20 text-center">{trackingMonth}</span>
                    <button onClick={() => shiftMonth(1)} disabled={isCurrentMonth}
                      className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed">›</button>
                  </div>
                  {trackingData.canSeeAll && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <button onClick={() => setTrackingScope('total')}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${trackingScope === 'total' ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>全组汇总</button>
                      {/* super/admin 常常不是这个组的成员（只是以管理者身份查看），
                          这种情况下"我自己"没有意义（永远是空的），直接不显示。 */}
                      {trackingData.isMember && (
                        <button onClick={() => setTrackingScope('own')}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${trackingScope === 'own' ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{trackingScope === 'own' ? view.username : '我自己'}</button>
                      )}
                      {(trackingData.memberList ?? []).filter(m => m.userId !== currentUserId).map(m => (
                        <button key={m.userId} onClick={() => setTrackingScope(m.userId)}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${trackingScope === m.userId ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{m.username}</button>
                      ))}
                    </div>
                  )}
                  <div className="ml-auto flex items-center gap-2 text-xs text-gray-500" aria-live="polite">
                    {trackingData.computedAt && (
                      <span title={trackingData.computedAt}>
                        数据更新于 {new Date(trackingData.computedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' })}
                      </span>
                    )}
                    {trackingData.canSeeAll && (
                      <button type="button" onClick={refreshTrackingSummary} className="btn-secondary min-h-11 px-3">
                        刷新最新数据
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  {/* 全组排名——不跟着上面的范围切换器走，管理员/超管始终看到全部
                      组员+最下面的全组汇总行；普通组员的接口响应本身就只含自己
                      那一条（不是前端隐藏），所以这里天然只会渲染出一行。 */}
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                      <span className="text-sm font-semibold text-gray-700">全组排名</span>
                      <span className="text-xs text-gray-400 ml-2">按得分从高到低</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table aria-label="数据表格" className="w-full min-w-[520px]">
                        <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                          <th className="px-4 py-2 text-center font-medium w-14">排名</th>
                          <th className="px-2 py-2 text-left font-medium">成员</th>
                          <th className="px-2 py-2 text-center font-medium w-20">提交数</th>
                          <th className="px-2 py-2 text-center font-medium w-20">获取排名</th>
                          <th className="px-2 py-2 text-center font-medium w-20">获取收录</th>
                          <th className="px-4 py-2 text-center font-medium w-20">得分</th>
                        </tr></thead>
                        <tbody>
                          {ranking.map(r => (
                            <tr key={r.userId} className={`border-b border-gray-50 last:border-0 ${r.userId === currentUserId ? 'bg-green-50/40' : ''}`}>
                              <td className="px-4 py-2.5 text-center text-sm font-semibold text-gray-500 tabular-nums">{r.rank}</td>
                              <td className="px-2 py-2.5 text-sm text-gray-800">{r.username}</td>
                              <td className="px-2 py-2.5 text-sm text-gray-700 text-center tabular-nums">{r.submitted ?? '—'}</td>
                              <td className="px-2 py-2.5 text-sm text-gray-700 text-center tabular-nums">{r.ranked ?? '—'}</td>
                              <td className="px-2 py-2.5 text-sm text-gray-700 text-center tabular-nums">{r.indexed ?? '—'}</td>
                              <td className={`px-4 py-2.5 text-sm text-center font-semibold tabular-nums ${r.totalScore == null ? 'text-gray-300' : r.totalScore > 0 ? 'text-green-600' : r.totalScore < 0 ? 'text-red-400' : 'text-gray-800'}`}>{r.totalScore == null ? '—' : r.totalScore.toFixed(1)}</td>
                            </tr>
                          ))}
                          {groupSummary && (
                            <tr className="bg-gray-50/70 border-t-2 border-gray-200">
                              <td className="px-4 py-2.5 text-center text-sm text-gray-400">—</td>
                              <td className="px-2 py-2.5 text-sm font-semibold text-gray-700">全组汇总</td>
                              <td className="px-2 py-2.5 text-sm text-gray-800 text-center font-semibold tabular-nums">{groupSummary.submitted.total}</td>
                              <td className="px-2 py-2.5 text-sm text-gray-800 text-center font-semibold tabular-nums">{groupSummary.ranked.total}</td>
                              <td className="px-2 py-2.5 text-sm text-gray-800 text-center font-semibold tabular-nums">{groupSummary.indexed.count}</td>
                              <td className="px-4 py-2.5 text-sm text-center font-bold tabular-nums text-gray-900">{groupSummary.totalScore.toFixed(1)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                {view.submitted.total === 0 ? (
                  <div className="text-center py-10 text-gray-400 text-sm">这个月还没有数据</div>
                ) : (
                  <>
                    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-4">
                      <SourceEffCards title="全组来源成效" stats={groupSourceEffectiveness} />
                      {trackingScope !== 'total' && (
                        <SourceEffCards title={`${view.username}来源成效`} stats={scopeSourceEffectiveness} />
                      )}
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                        <span className="text-sm font-semibold text-gray-700">获取收录</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table aria-label="数据表格" className="w-full min-w-[560px]">
                          <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="px-4 py-2 text-left font-medium w-28">类目</th>
                            <th className="px-2 pr-6 py-2 text-center font-medium w-20">条数</th>
                            <th className="pl-4 pr-2 py-2 text-left font-medium">来源</th>
                            <th className="px-2 py-2 text-right font-medium w-24">总搜索量</th>
                            <th className="px-4 py-2 text-center font-medium w-16">操作</th>
                          </tr></thead>
                          <tbody>
                            <tr className="border-b border-gray-50 last:border-0">
                              <td className="px-4 py-2.5 text-sm text-gray-700">排除排名</td>
                              <td className="px-2 pr-6 py-2.5 text-sm text-gray-700 text-center tabular-nums">{view.indexed.count}</td>
                              <td className="pl-4 pr-2 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {view.indexed.bySource.map(s => (
                                    <span key={s.source} className="inline-flex items-center gap-0.5"><SourceTag source={s.source} /><span className="text-[10px] text-gray-400">{s.count}</span></span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-2 py-2.5 text-sm text-gray-500 text-right tabular-nums">{view.indexed.volume > 0 ? fmtVol(view.indexed.volume) : '—'}</td>
                              <td className="px-4 py-2.5 text-center">
                                <button onClick={() => { setSourceDetailModal({ kind: 'indexed' }); setSourceDetailPage(0) }} disabled={view.indexed.count === 0}
                                  className="text-xs border rounded px-2 py-0.5 whitespace-nowrap text-gray-400 hover:text-gray-600 border-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">查看</button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                        <span className="text-sm font-semibold text-gray-700">排名分布</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table aria-label="数据表格" className="w-full min-w-[560px]">
                          <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="px-4 py-2 text-left font-medium w-28">排名区间</th>
                            <th className="px-2 pr-6 py-2 text-center font-medium w-20">词数</th>
                            <th className="pl-4 pr-2 py-2 text-left font-medium">来源</th>
                            <th className="px-2 py-2 text-right font-medium w-24">总搜索量</th>
                            <th className="px-4 py-2 text-center font-medium w-16">操作</th>
                          </tr></thead>
                          <tbody>
                            {view.ranked.buckets.map(b => (
                              <tr key={b.label} className="border-b border-gray-50 last:border-0">
                                <td className="px-4 py-2.5 text-sm text-gray-700">{b.label}</td>
                                <td className="px-2 pr-6 py-2.5 text-sm text-gray-700 text-center tabular-nums">{b.count}</td>
                                <td className="pl-4 pr-2 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {b.bySource.map(s => (
                                      <span key={s.source} className="inline-flex items-center gap-0.5"><SourceTag source={s.source} /><span className="text-[10px] text-gray-400">{s.count}</span></span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-2 py-2.5 text-sm text-gray-500 text-right tabular-nums">{b.volume > 0 ? fmtVol(b.volume) : '—'}</td>
                                <td className="px-4 py-2.5 text-center">
                                  <button onClick={() => { setSourceDetailModal({ kind: 'rank', bucket: b.label }); setSourceDetailPage(0) }} disabled={b.count === 0}
                                    className="text-xs border rounded px-2 py-0.5 whitespace-nowrap text-gray-400 hover:text-gray-600 border-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">查看</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
                </div>
              </div>
            )
          })()}

          {/* ── 提交记录 ── */}
          {report && showSubmissionDetails && (
            <>
              {/* Period selector */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500 mr-1">时间段：</span>
                <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                  {(['yesterday', 'week', 'month', 'custom'] as Period[]).map(p => (
                    <button key={p} onClick={() => setPeriod(p)}
                      className={`px-4 py-1.5 text-sm font-medium transition-colors ${period === p ? 'bg-green-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                      {PERIOD_LABELS[p]}
                    </button>
                  ))}
                </div>
                {period === 'custom' ? (
                  <div className="flex items-center gap-2">
                    <input aria-label="选择日期" type="date" value={customStart} max={customEnd || today}
                      onChange={e => setCustomStart(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-700" />
                    <span className="text-gray-400 text-sm">~</span>
                    <input aria-label="选择日期" type="date" value={customEnd} min={customStart} max={today}
                      onChange={e => setCustomEnd(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-700" />
                    {customStart && customEnd && customStart > customEnd && (
                      <span className="text-xs text-red-400">开始日期不能晚于结束日期</span>
                    )}
                  </div>
                ) : report ? (
                  <span className="text-xs text-gray-400">
                    {report.startDate === report.endDate ? report.startDate : `${report.startDate} ~ ${report.endDate}`}
                  </span>
                ) : null}
              </div>

              {loading ? <Spinner /> : !report ? null : (
                <>
                  {/* Summary cards */}
                  <div className="flex gap-4 overflow-x-auto pb-2">
                    {canSeeAll && report.groupTotal && (
                      <ReportCard title="全部成员合计" total={report.groupTotal.total} bySource={report.groupTotal.bySource} isTotal />
                    )}
                    {report.members.map(m => (
                      <ReportCard key={m.userId} title={m.username} memberType={m.memberType} total={m.total} bySource={m.bySource} />
                    ))}
                  </div>

                  {!hasData ? (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                      <svg className="w-10 h-10 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm">{PERIOD_LABELS[period]}暂无提交记录</span>
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      {/* Table header bar */}
                      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center gap-3">
                        <span className="text-sm font-semibold text-gray-700">提交明细</span>
                        {canSeeAll && report.members.length > 1 && (
                          <select aria-label="选择选项" value={filterUserId} onChange={e => { setFilterUserId(e.target.value); setSubPage(0) }}
                            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white ml-auto">
                            <option value="all">全部成员</option>
                            {report.members.map(m => <option key={m.userId} value={m.userId}>{m.username}</option>)}
                          </select>
                        )}
                      </div>
                      {/* Column headers */}
                      <div className="grid grid-cols-[90px_1fr_70px_100px_80px] gap-x-3 px-5 py-2 bg-gray-50/30 border-b border-gray-100 text-[11px] font-medium text-gray-400">
                        <span>日期</span>
                        <span>组员</span>
                        <span className="text-right">提交数</span>
                        <span className="text-right">搜索量</span>
                        <span className="text-center">操作</span>
                      </div>
                      {/* Rows */}
                      <div className="divide-y divide-gray-50">
                        {pagedRows.map(row => (
                          <div key={row.key} className="grid grid-cols-[90px_1fr_70px_100px_80px] gap-x-3 px-5 py-3 items-center hover:bg-gray-50/60 transition-colors">
                            <span className="text-sm text-gray-700 font-medium">{fmtDate(row.date)}</span>
                            <span className="text-sm text-gray-600 truncate">{row.username}</span>
                            <span className="text-sm text-gray-700 text-right tabular-nums">{row.count}</span>
                            <span className="text-sm text-gray-700 text-right tabular-nums">{fmtVol(row.volume)}</span>
                            <div className="flex justify-center">
                              <button
                                onClick={() => { setDetailModal({ date: row.date, userId: row.userId, username: row.username }); setDetailPage(0); setDetailKws([]); setDetailTotal(0) }}
                                className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300 transition-colors">
                                详情
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40">
                          <span className="text-xs text-gray-400">共 {totalRows} 条 · 第 {subPage + 1} / {totalPages} 页</span>
                          <div className="flex items-center gap-1">
                            <button disabled={subPage === 0} onClick={() => setSubPage(p => p - 1)}
                              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                              上一页
                            </button>
                            <button disabled={subPage >= totalPages - 1} onClick={() => setSubPage(p => p + 1)}
                              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                              下一页
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* 得分计算说明 Modal */}
      {scoreDetailRow && (() => {
        const row = scoreDetailRow
        if (row.operation_type === '更新' && row.updateEffectBreakdown) {
          const u = row.updateEffectBreakdown
          const liftDesc = u.rankPos == null ? '没有排名'
            : u.isNewRank ? `真新排名（历史上从没排过名）`
            : u.rankChange != null && u.rankChange > 0 ? `排名上涨 ${u.rankChange} 位`
            : u.rankChange != null && u.rankChange <= 0 ? '排名没有实际提升'
            : '没有历史对比数据'
          return (
            <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setScoreDetailRow(null)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 truncate" title={row.final_keyword || row.keyword}>{row.final_keyword || row.keyword}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">"更新"成效是怎么算出来的</p>
                  </div>
                  <button onClick={() => setScoreDetailRow(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2.5 text-sm">
                  <p className="text-[11px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2">参考：这个词现在的关键词价值是 {u.keywordValue.toFixed(1)}（不管是谁做的、这个词现在值不值钱）——下面算的是"这次更新到底有没有用"，两个数字分开看。</p>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-gray-500">排名提升分（{liftDesc}）</span>
                    <span className="font-medium text-gray-800 tabular-nums">{u.rankLiftScore}</span>
                  </div>
                  {u.tierBonus > 0 && (
                    <div className="flex items-center justify-between py-1">
                      <span className="text-gray-500">跨档奖励</span>
                      <span className="font-medium text-gray-800 tabular-nums">+{u.tierBonus}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-1 border-b border-gray-100 pb-3">
                    <span className="text-gray-500">搜索量系数{u.rankPos != null ? `（排名量 ${u.rankVolume?.toLocaleString() ?? 0}）` : ''}</span>
                    <span className="font-medium text-gray-800 tabular-nums">×{u.volumeMultiplier.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-gray-100 pb-3">
                    <span className="text-gray-500">收录确认分{u.indexConfirmScore > 0 ? '（这次真的新收录了）' : ''}</span>
                    <span className="font-medium text-gray-800 tabular-nums">+{u.indexConfirmScore}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-gray-700 font-semibold">更新成效分</span>
                    <span className={`text-lg font-bold tabular-nums ${u.total > 0 ? 'text-green-600' : 'text-gray-800'}`}>{u.total.toFixed(1)}</span>
                  </div>
                  {row.env_excluded && (
                    <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">这条记录日期环境异常（全站大跌或抓取失败），不计入"得分"平均分。</p>
                  )}
                  <details className="pt-2">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">公式说明</summary>
                    <div className="mt-2 text-[11px] text-gray-500 leading-relaxed space-y-1">
                      <p>更新成效分 = (排名提升分 + 跨档奖励) × 搜索量系数 + 收录确认分——"更新"看这次操作比操作前多创造了多少增量，不是这个词现在绝对值多少钱（那是"关键词价值"）</p>
                      <p>排名提升分·真新排名：进前3 +30 / 前10 +22 / 前20 +16 / 前30 +12 / 前50 +8 / 50名以后 +4</p>
                      <p>排名提升分·有历史对比：涨20+位+15 / 10-19位+10 / 5-9位+6 / 1-4位+3 / 没有实际提升 0分（不再按当前排名发钱）</p>
                      <p>跨档奖励：31+进前30 +2 / 前30进前20 +3 / 前20进前10 +5 / 前10进前3 +6（只在有真实提升时叠加）</p>
                      <p>搜索量系数：0-99×0.8 / 100-499×1.0 / 500-999×1.1 / 1000-4999×1.25 / 5000+×1.4</p>
                      <p>收录确认分：这次claim期间真的新收录了 +2，本来就收录着的 0</p>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          )
        }
        const b = explainOutcomeScore(row.rank_position, row.is_indexed, row.rank_change, row.rank_volume)
        const changeDesc = row.rank_change == null ? '无排名变化数据'
          : row.rank_change > 0 ? `排名上涨 ${row.rank_change} 位`
          : row.rank_change < 0 ? `排名下跌 ${-row.rank_change} 位`
          : '排名无变化'
        return (
          <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setScoreDetailRow(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 truncate" title={row.final_keyword || row.keyword}>{row.final_keyword || row.keyword}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">得分是怎么算出来的</p>
                </div>
                <button onClick={() => setScoreDetailRow(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
              <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2.5 text-sm">
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500">排名分{row.rank_position != null ? `（第${row.rank_position}名）` : '（未排名）'}</span>
                  <span className="font-medium text-gray-800 tabular-nums">{b.rankScore}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-gray-100 pb-3">
                  <span className="text-gray-500">搜索量权重{row.rank_position != null ? `（排名量 ${row.rank_volume?.toLocaleString() ?? 0}）` : ''}</span>
                  <span className="font-medium text-gray-800 tabular-nums">×{b.volumeWeight.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-600 font-medium">= 排名价值</span>
                  <span className="font-semibold text-gray-900 tabular-nums">{b.baseValue.toFixed(1)}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500">收录分{row.is_indexed ? '（已收录）' : '（未收录）'}</span>
                  <span className="font-medium text-gray-800 tabular-nums">+{b.indexScore}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-gray-100 pb-3">
                  <span className="text-gray-500">涨跌分（{changeDesc}）</span>
                  <span className={`font-medium tabular-nums ${b.changeScore > 0 ? 'text-green-600' : b.changeScore < 0 ? 'text-red-400' : 'text-gray-800'}`}>{b.changeScore >= 0 ? `+${b.changeScore.toFixed(1)}` : b.changeScore.toFixed(1)}</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-gray-700 font-semibold">总分</span>
                  <span className={`text-lg font-bold tabular-nums ${b.total > 0 ? 'text-green-600' : b.total < 0 ? 'text-red-400' : 'text-gray-800'}`}>{b.total.toFixed(1)}</span>
                </div>
                {row.env_excluded && (
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">这条记录日期环境异常（全站大跌或抓取失败），不计入"得分"平均分。</p>
                )}
                <details className="pt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">公式说明</summary>
                  <div className="mt-2 text-[11px] text-gray-500 leading-relaxed space-y-1">
                    <p>总分 = 排名分 × 搜索量权重 + 收录分 + 涨跌分</p>
                    <p>排名分：前3名10 / 4-10名8 / 11-20名6 / 21-30名4 / 30名以后2</p>
                    <p>搜索量权重：1 + log10(排名量+1)，只在有排名时生效</p>
                    <p>收录分：收录固定 +1</p>
                    <p>涨跌分：涨20+位+2 / 涨10-20位+1.5 / 涨1-9位+1 / 不变0 / 跌1-5位-0.2 / 跌6-10位-0.5 / 跌11-20位-1 / 跌20+位-1.5</p>
                    <p>"更新"类型走单独的增量公式（点开一条"更新"记录的得分能看到），这里的公式只适用于"新增"</p>
                  </div>
                </details>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 追踪汇总"查看"详情 Modal */}
      {sourceDetailModal && (
        <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSourceDetailModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {sourceDetailModal.kind === 'indexed' ? '获取收录' : `排名 ${sourceDetailModal.bucket}`}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">共 {sourceDetailTotal} 词</p>
              </div>
              <button onClick={() => setSourceDetailModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {sourceDetailLoading ? <Spinner /> : sourceDetailRows.length === 0 ? (
                <div className="flex items-center justify-center py-14 text-sm text-gray-300">暂无数据</div>
              ) : sourceDetailModal.kind === 'indexed' ? (
                <>
                  <div className="grid grid-cols-[1fr_90px_90px_70px] gap-x-3 px-5 py-2 bg-gray-50/50 border-b border-gray-100 text-[11px] font-medium text-gray-400 sticky top-0">
                    <span>最终词 → 关键词</span>
                    <span className="text-right">搜索量</span>
                    <span className="text-center">来源</span>
                    <span className="text-center">操作</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {sourceDetailRows.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr_90px_90px_70px] gap-x-3 px-5 py-2.5 items-center hover:bg-gray-50/60 transition-colors">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate" title={r.final_keyword || r.keyword}>{r.final_keyword || r.keyword}</div>
                          {r.final_keyword
                            ? <div className="text-xs text-green-600 truncate" title={r.keyword}>→ {r.keyword}</div>
                            : r.username ? <div className="text-xs text-gray-300">{r.username}</div> : null}
                        </div>
                        <span className="text-sm text-gray-600 text-right tabular-nums">{fmtVol(r.search_volume ?? 0)}</span>
                        <div className="flex justify-center"><SourceTag source={r.source} /></div>
                        <div className="flex justify-center">
                          {r.operation_type
                            ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.operation_type === '新增' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>{r.operation_type}</span>
                            : <span className="text-xs text-gray-300">—</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_60px_1fr_90px_90px_70px] gap-x-3 px-5 py-2 bg-gray-50/50 border-b border-gray-100 text-[11px] font-medium text-gray-400 sticky top-0">
                    <span>最终词 → 关键词</span>
                    <span className="text-center">排名</span>
                    <span>排名词</span>
                    <span className="text-right">排名量</span>
                    <span className="text-center">来源</span>
                    <span className="text-center">操作</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {sourceDetailRows.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr_60px_1fr_90px_90px_70px] gap-x-3 px-5 py-2.5 items-center hover:bg-gray-50/60 transition-colors">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate" title={r.final_keyword || r.keyword}>{r.final_keyword || r.keyword}</div>
                          {r.final_keyword
                            ? <div className="text-xs text-green-600 truncate" title={r.keyword}>→ {r.keyword}</div>
                            : r.username ? <div className="text-xs text-gray-300">{r.username}</div> : null}
                        </div>
                        <span className="text-sm text-gray-700 text-center tabular-nums">{r.rank_position}</span>
                        <span className="text-sm text-gray-700 truncate" title={r.rank_keyword}>{r.rank_keyword || '—'}</span>
                        <span className="text-sm text-gray-600 text-right tabular-nums">{fmtVol(r.rank_volume ?? 0)}</span>
                        <div className="flex justify-center"><SourceTag source={r.source} /></div>
                        <div className="flex justify-center">
                          {r.operation_type
                            ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.operation_type === '新增' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>{r.operation_type}</span>
                            : <span className="text-xs text-gray-300">—</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            {sourceDetailTotalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40 flex-shrink-0">
                <span className="text-xs text-gray-400">{sourceDetailPage * DETAIL_PAGE_SIZE + 1}–{Math.min((sourceDetailPage + 1) * DETAIL_PAGE_SIZE, sourceDetailTotal)} 条，共 {sourceDetailTotal} 条</span>
                <div className="flex items-center gap-1">
                  <button disabled={sourceDetailPage === 0} onClick={() => setSourceDetailPage(p => p - 1)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors">上一页</button>
                  <span className="text-xs text-gray-400 px-2">{sourceDetailPage + 1} / {sourceDetailTotalPages}</span>
                  <button disabled={sourceDetailPage >= sourceDetailTotalPages - 1} onClick={() => setSourceDetailPage(p => p + 1)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors">下一页</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 关键词详情 Modal */}
      {detailModal && (
        <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{detailModal.username}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{detailModal.date} · 共 {detailTotal} 词</p>
              </div>
              <button onClick={() => setDetailModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {detailLoading ? <Spinner /> : detailKws.length === 0 ? (
                <div className="flex items-center justify-center py-14 text-sm text-gray-300">暂无关键词数据</div>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_80px_auto_120px] gap-x-3 px-5 py-2 bg-gray-50/50 border-b border-gray-100 text-[11px] font-medium text-gray-400 sticky top-0">
                    <span>关键词 / 最终词</span>
                    <span className="text-right">搜索量</span>
                    <span className="text-center">操作</span>
                    <span>页面URL</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {detailKws.map((kw, i) => (
                      <div key={i} className="grid grid-cols-[1fr_80px_auto_120px] gap-x-3 px-5 py-2.5 items-start hover:bg-gray-50/60 transition-colors">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-gray-800 truncate" title={kw.keyword}>{kw.keyword}</span>
                          </div>
                          {kw.final_keyword && <span className="text-xs text-green-600 truncate block" title={kw.final_keyword}>→ {kw.final_keyword}</span>}
                        </div>
                        <span className="text-sm text-gray-500 text-right tabular-nums">{fmtVol(kw.search_volume)}</span>
                        <div className="flex justify-center pt-0.5">
                          {kw.operation_type
                            ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${kw.operation_type === '新增' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>{kw.operation_type}</span>
                            : <SourceTag source={kw.source} />}
                        </div>
                        <div className="min-w-0">
                          {(canSeeAll || detailModal?.userId === currentUserId) ? (
                            <input aria-label="输入内容"
                              type="text"
                              defaultValue={kw.page_url ?? ''}
                              placeholder="https://…"
                              title={kw.page_url ?? ''}
                              className="w-full text-xs text-blue-500 font-mono bg-transparent border-b border-transparent hover:border-gray-200 focus:border-green-400 focus:outline-none placeholder-gray-300 truncate"
                              onBlur={async e => {
                                const val = e.target.value.trim()
                                if (val === (kw.page_url ?? '')) return
                                await fetch(`/api/task-groups/${activeTabId}/claimed`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ claimId: kw.id, page_url: val }),
                                })
                                setDetailKws(prev => prev.map((k, j) => j === i ? { ...k, page_url: val || null } : k))
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            />
                          ) : kw.page_url ? (
                            <a href={kw.page_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline font-mono truncate block" title={kw.page_url}>
                              {kw.page_url.replace(/^https?:\/\//, '').slice(0, 30)}{kw.page_url.replace(/^https?:\/\//, '').length > 30 ? '…' : ''}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            {detailTotalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40 flex-shrink-0">
                <span className="text-xs text-gray-400">{detailPage * DETAIL_PAGE_SIZE + 1}–{Math.min((detailPage + 1) * DETAIL_PAGE_SIZE, detailTotal)} 条，共 {detailTotal} 条</span>
                <div className="flex items-center gap-1">
                  <button disabled={detailPage === 0} onClick={() => setDetailPage(p => p - 1)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors">上一页</button>
                  <span className="text-xs text-gray-400 px-2">{detailPage + 1} / {detailTotalPages}</span>
                  <button disabled={detailPage >= detailTotalPages - 1} onClick={() => setDetailPage(p => p + 1)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors">下一页</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
