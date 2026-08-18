'use client'

import { useState, useEffect, useCallback } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { CRAWL_RULES } from '@/lib/crawl-rules'

type ActivityLog = {
  id: string
  type: 'cron_task' | 'cron_manual' | 'search'
  source: string | null
  step: string | null
  domain: string | null
  group_index: number | null
  total_groups: number | null
  ip: string | null
  status: 'running' | 'done' | 'warn' | 'fail'
  ok_count: number
  empty_count: number
  skip_count: number
  fail_count: number
  rows_written: number
  duration_ms: number | null
  summary: string | null
  logged_at: string
}

type SiteLog = {
  id: string
  domain: string
  status: 'ok' | 'empty' | 'skip' | 'fail'
  rows_written: number
  detail: string | null
  logged_at: string
}

function getMalaysiaToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function getMytDayRange(mytDate: string): { from: string; to: string } {
  return {
    from: new Date(mytDate + 'T00:00:00+08:00').toISOString(),
    to: new Date(mytDate + 'T23:59:59.999+08:00').toISOString(),
  }
}

function toMyt(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000)
}

function formatDateTime(iso: string): string {
  return toMyt(iso).toISOString().slice(0, 19).replace('T', ' ')
}

function formatCardTime(iso: string): string {
  const d = toMyt(iso)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hhmm = d.toISOString().slice(11, 16)
  return `${mm}/${dd} ${hhmm}`
}

function formatDuration(ms: number | null): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`
}

function getDateFilterRange(f: string): { from: string; to: string } | null {
  const nowMyt = Date.now() + 8 * 60 * 60 * 1000
  const today = new Date(nowMyt).toISOString().slice(0, 10)
  if (f === 'today') return getMytDayRange(today)
  if (f === 'yesterday') {
    return getMytDayRange(new Date(nowMyt - 86400000).toISOString().slice(0, 10))
  }
  if (f === '3days') {
    return {
      from: new Date(new Date(nowMyt - 2 * 86400000).toISOString().slice(0, 10) + 'T00:00:00+08:00').toISOString(),
      to: new Date(today + 'T23:59:59.999+08:00').toISOString(),
    }
  }
  return null
}

const STEP_LABELS: Record<string, string> = {
  keywords: '关键词', rank: '排名', weight: '权重+收录',
}

const STEP_TIMES: Record<string, string> = {
  keywords: '每日 00:00', rank: '每日 02:00', weight: '每日 01:00',
}

const TYPE_LABELS: Record<string, string> = {
  cron_task: '任务cron', cron_manual: '手动cron', search: '搜索',
}

const SITE_STATUS_LABELS: Record<string, string> = {
  ok: '成功', empty: '空', skip: '跳过', fail: '失败',
}

const SITE_STATUS_COLORS: Record<string, string> = {
  ok: 'text-green-700', empty: 'text-yellow-600', skip: 'text-gray-400', fail: 'text-red-500',
}

function StatusText({ status }: { status: string }) {
  const cls = { running: 'text-blue-600', done: 'text-green-700', warn: 'text-yellow-600', fail: 'text-red-500' }[status] ?? 'text-gray-500'
  const label = { running: '进行中', done: '完成', warn: '有空值', fail: '失败' }[status] ?? status
  return <span className={`text-sm font-medium ${cls}`}>{label}</span>
}

// ─── Retry modal ──────────────────────────────────────────────────────────────

type RetryStatus = 'pending' | 'retrying' | 'ok' | 'fail'

function RetryModal({ step, sites, onClose, onRefresh }: {
  step: string
  sites: SiteLog[]
  onClose: () => void
  onRefresh: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(sites.map(s => s.domain)))
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState<Record<string, RetryStatus>>({})

  function toggle(domain: string) {
    if (running) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain); else next.add(domain)
      return next
    })
  }

  async function handleRetry() {
    const domains = Array.from(selected)
    if (!domains.length) return
    setRunning(true)
    setDone(false)
    const init: Record<string, RetryStatus> = {}
    domains.forEach(d => { init[d] = 'pending' })
    setProgress(init)

    for (const domain of domains) {
      setProgress(prev => ({ ...prev, [domain]: 'retrying' }))
      try {
        const res = await fetch('/api/trigger-crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ site: domain, step }),
        })
        setProgress(prev => ({ ...prev, [domain]: res.ok ? 'ok' : 'fail' }))
      } catch {
        setProgress(prev => ({ ...prev, [domain]: 'fail' }))
      }
    }

    setRunning(false)
    setDone(true)
    onRefresh()
  }

  const completedCount = Object.values(progress).filter(s => s === 'ok' || s === 'fail').length
  const okCount = Object.values(progress).filter(s => s === 'ok').length

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={running ? undefined : onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">重试失败站点</h3>
            <p className="text-xs text-gray-400 mt-0.5">步骤：{STEP_LABELS[step] ?? step}</p>
          </div>
          {!running && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-3">
          {sites.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">暂无失败或空值站点</p>
          ) : (
            <div className="space-y-1">
              {sites.map(site => {
                const ps = progress[site.domain]
                return (
                  <div key={site.domain} className="flex items-center justify-between py-1.5">
                    <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                      <input type="checkbox" checked={selected.has(site.domain)}
                        onChange={() => toggle(site.domain)} disabled={running}
                        className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400 flex-shrink-0" />
                      <span className="text-sm text-gray-800 truncate">{site.domain}</span>
                      <span className={`text-xs flex-shrink-0 ${site.status === 'fail' ? 'text-red-400' : 'text-yellow-500'}`}>
                        {site.status === 'fail' ? '失败' : '空'}
                      </span>
                    </label>
                    <div className="text-xs ml-3 flex-shrink-0 w-16 text-right">
                      {ps === 'retrying' && <span className="text-blue-500 animate-pulse">重试中…</span>}
                      {ps === 'ok' && <span className="text-green-600">✓ 成功</span>}
                      {ps === 'fail' && <span className="text-red-500">✗ 失败</span>}
                      {(ps === 'pending' || !ps) && <span className="text-gray-200">—</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
          {done ? (
            <div className="space-y-3">
              <p className="text-sm text-center text-gray-600">
                重试完成：<span className="text-green-600 font-medium">{okCount} 成功</span>
                {completedCount - okCount > 0 && (
                  <span className="text-red-500 font-medium ml-2">{completedCount - okCount} 失败</span>
                )}
              </p>
              <button onClick={onClose}
                className="w-full py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
                关闭
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button onClick={onClose} disabled={running}
                className="flex-1 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40">
                取消
              </button>
              <button onClick={handleRetry} disabled={running || selected.size === 0}
                className="flex-1 py-2.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50">
                {running
                  ? `重试中 ${completedCount}/${selected.size}`
                  : `开始重试（${selected.size} 站）`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const SELECT_CLS = 'text-xs border border-gray-200 rounded-md pl-2.5 pr-6 py-1 text-gray-600 bg-white cursor-pointer hover:border-gray-300 focus:outline-none appearance-none'

type Row2Stats = {
  rankTitle: { succeeded: number; total: number; loggedAt: string | null }
  indexPages: ActivityLog | null
}

export default function CrawlLogPage() {
  const [todayLogs, setTodayLogs] = useState<Record<string, ActivityLog[]>>({
    keywords: [], rank: [], weight: [],
  })
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Row 2 cards
  const [row2, setRow2] = useState<Row2Stats>({
    rankTitle: { succeeded: 0, total: 0, loggedAt: null },
    indexPages: null,
  })

  // Filters
  const [filterDate, setFilterDate] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterDomain, setFilterDomain] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [page, setPage] = useState(1)

  // Modals
  const [rulesStep, setRulesStep] = useState<string | null>(null)
  const [detailActivity, setDetailActivity] = useState<ActivityLog | null>(null)
  const [siteLogs, setSiteLogs] = useState<SiteLog[]>([])
  const [siteLogsLoading, setSiteLogsLoading] = useState(false)
  const [siteLogsError, setSiteLogsError] = useState<string | null>(null)
  const [retryModal, setRetryModal] = useState<{ step: string; sites: SiteLog[] } | null>(null)

  // Card expand
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [expandedSites, setExpandedSites] = useState<Record<string, SiteLog[]>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    const supabase = getBrowserClient()
    const today = getMalaysiaToday()
    const { from, to } = getMytDayRange(today)
    const errors: string[] = []

    // Cards row 1: cron_task + cron_manual
    const { data: todayData, error: todayErr } = await supabase
      .from('activity_log')
      .select('*')
      .gte('logged_at', from)
      .lte('logged_at', to)
      .in('type', ['cron_task', 'cron_manual'])
      .order('logged_at', { ascending: false })
    if (todayErr) errors.push(todayErr.message)

    const grouped: Record<string, ActivityLog[]> = { keywords: [], rank: [], weight: [] }
    for (const row of (todayData || []) as ActivityLog[]) {
      if (row.step && grouped[row.step]) grouped[row.step].push(row)
    }
    setTodayLogs(grouped)

    // Row 2 rank-title card: all has_rank_title sites, count those with data today
    const { data: rtSitesRaw, error: rtSitesErr } = await supabase.from('sites').select('id').eq('has_rank_title', true)
    if (rtSitesErr) errors.push(rtSitesErr.message)
    const rtSiteIds = (rtSitesRaw || []).map((s: { id: string }) => s.id)
    const rtTotal = rtSiteIds.length
    let rtSucceeded = 0
    if (rtTotal > 0) {
      const { data: rtToday, error: rtTodayErr } = await supabase
        .from('site_keyword_ranks')
        .select('site_id')
        .eq('stat_date', today)
        .in('site_id', rtSiteIds)
      if (rtTodayErr) errors.push(rtTodayErr.message)
      rtSucceeded = new Set((rtToday || []).map((r: { site_id: string }) => r.site_id)).size
    }
    const { data: rtTs, error: rtTsErr } = await supabase
      .from('site_keyword_ranks')
      .select('created_at')
      .eq('stat_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
    if (rtTsErr) errors.push(rtTsErr.message)
    const rtLoggedAt = (rtTs as { created_at: string }[] | null)?.[0]?.created_at ?? null

    // Row 2 card C: index-pages latest activity_log (last 2 days in case run was yesterday night)
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()
    const { data: ipLogs, error: ipLogsErr } = await supabase
      .from('activity_log')
      .select('*')
      .gte('logged_at', twoDaysAgo)
      .eq('step', 'index-pages')
      .eq('type', 'cron_task')
      .order('logged_at', { ascending: false })
      .limit(1)
    if (ipLogsErr) errors.push(ipLogsErr.message)
    const latestIndexPages = ((ipLogs || []) as ActivityLog[])[0] ?? null

    setRow2({
      rankTitle: { succeeded: rtSucceeded, total: rtTotal, loggedAt: rtLoggedAt },
      indexPages: latestIndexPages,
    })

    const { data: logsData, error: logsErr } = await supabase
      .from('activity_log')
      .select('*')
      .order('logged_at', { ascending: false })
      .limit(200)
    if (logsErr) errors.push(logsErr.message)

    setLogs((logsData || []) as ActivityLog[])
    // 这个页面本身是运维用来判断"抓取任务是否正常"的监控页——查询失败时
    // 静默当成"今日暂无记录"处理会掩盖监控本身失效的事实，必须显式提示。
    setFetchError(errors.length > 0 ? errors[0] : null)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function openDetail(activity: ActivityLog) {
    setDetailActivity(activity)
    setSiteLogsLoading(true)
    setSiteLogs([])
    setSiteLogsError(null)
    const supabase = getBrowserClient()
    const { data, error } = await supabase
      .from('activity_site_log')
      .select('*')
      .eq('activity_id', activity.id)
      .order('logged_at', { ascending: true })
    if (error) setSiteLogsError(error.message)
    setSiteLogs((data || []) as SiteLog[])
    setSiteLogsLoading(false)
  }

  // Fetch problem sites for a step using latest-per-domain status.
  // Manual retries that succeeded are excluded (their latest status is 'ok').
  async function fetchProblemSites(step: string): Promise<SiteLog[]> {
    const supabase = getBrowserClient()
    const allStepLogs = todayLogs[step] || []
    const mainLogs = allStepLogs.filter(l => l.type === 'cron_task')
    const manualLogs = allStepLogs.filter(l => l.type === 'cron_manual')
    if (mainLogs.length === 0) return []
    const latestTime = new Date(mainLogs[0].logged_at).getTime()
    const mainIds = mainLogs.filter(l => latestTime - new Date(l.logged_at).getTime() < 3 * 3600000).map(l => l.id)
    const manualIds = manualLogs.map(l => l.id)
    const ids = [...mainIds, ...manualIds]
    if (ids.length === 0) return []
    const { data, error } = await supabase
      .from('activity_site_log')
      .select('*')
      .in('activity_id', ids)
      .not('status', 'eq', 'skip')
      .order('logged_at', { ascending: false })
    if (error) console.error('fetchProblemSites failed:', error.message)
    // Take latest status per domain, keep only still-problematic ones
    const latestPerDomain = new Map<string, SiteLog>()
    for (const log of (data || []) as SiteLog[]) {
      if (!latestPerDomain.has(log.domain)) latestPerDomain.set(log.domain, log)
    }
    return Array.from(latestPerDomain.values())
      .filter(s => s.status === 'fail' || s.status === 'empty')
      .sort((a, b) => a.status.localeCompare(b.status))
  }

  async function openRetry(step: string) {
    let sites = expandedSites[step]
    if (!sites) {
      sites = await fetchProblemSites(step)
      setExpandedSites(p => ({ ...p, [step]: sites! }))
    }
    setRetryModal({ step, sites: sites ?? [] })
  }

  async function toggleExpandStep(step: string) {
    if (expandedStep === step) { setExpandedStep(null); return }
    setExpandedStep(step)
    if (expandedSites[step]) return
    const sites = await fetchProblemSites(step)
    setExpandedSites(p => ({ ...p, [step]: sites }))
  }

  function resetFilters() {
    setFilterDate(''); setFilterType(''); setFilterDomain(''); setOnlyProblems(false); setPage(1)
  }

  function isFiltered() {
    return filterDate !== '' || filterType !== '' || filterDomain !== '' || onlyProblems
  }

  const domainOptions = Array.from(new Set(logs.filter(l => l.domain).map(l => l.domain!))).sort()

  const filteredLogs = logs.filter(log => {
    if (filterType && log.type !== filterType) return false
    if (filterDomain && !log.domain?.toLowerCase().includes(filterDomain.toLowerCase())) return false
    if (onlyProblems && log.status !== 'warn' && log.status !== 'fail') return false
    if (filterDate) {
      const range = getDateFilterRange(filterDate)
      if (range && (log.logged_at < range.from || log.logged_at > range.to)) return false
    }
    return true
  })

  const PAGE_SIZE = 20
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedLogs = filteredLogs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function getTodaySummary(step: string) {
    const allStepLogs = todayLogs[step] || []
    const mainLogs = allStepLogs.filter(l => l.type === 'cron_task')
    if (mainLogs.length === 0) return { ok: 0, empty: 0, fail: 0, total: 0, latestRun: undefined, runs: 0 }

    // Sort oldest→newest to identify the main batch vs later retry runs
    const sorted = [...mainLogs].sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime())
    const firstTime = new Date(sorted[0].logged_at).getTime()
    const BATCH_WINDOW = 30 * 60 * 1000 // 30 min: parallel sub-jobs are grouped here

    // Main batch = parallel jobs that started close together
    const mainBatch = sorted.filter(l => new Date(l.logged_at).getTime() - firstTime < BATCH_WINDOW)
    // cronRetries = 第二次跑空值的 cron_task（超过 30 分钟后启动）
    const cronRetries = sorted.filter(l => new Date(l.logged_at).getTime() - firstTime >= BATCH_WINDOW)

    let ok    = mainBatch.reduce((s, l) => s + l.ok_count,    0)
    let empty = mainBatch.reduce((s, l) => s + l.empty_count, 0)
    let fail  = mainBatch.reduce((s, l) => s + l.fail_count,  0)
    const total = ok + empty + fail  // 总数锁定在第一次主跑

    // 后续重跑（cron_task 重试 + 手动重试）只调整 ok/empty/fail，不改变总数
    const adjustRuns = [
      ...cronRetries,
      ...allStepLogs.filter(l => l.type === 'cron_manual'),
    ]
    for (const run of adjustRuns) {
      const fromEmpty = Math.min(empty, run.ok_count)
      empty = Math.max(0, empty - fromEmpty)
      fail  = Math.max(0, fail  - Math.max(0, run.ok_count - fromEmpty))
      ok   += run.ok_count
    }
    ok = Math.min(ok, total)

    return { ok, empty, fail, total, latestRun: mainLogs[0], runs: mainBatch.length }
  }

  const rulesSection = CRAWL_RULES.find(r => r.key === rulesStep)

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">抓取日志</h1>
          <p className="text-gray-500 text-sm mt-1">今日运行状态 · 历史记录 · 抓取规则</p>
        </div>
        <button
          onClick={fetchData}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          刷新
        </button>
      </div>

      {fetchError && !loading && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">
          部分数据加载失败：{fetchError}
        </div>
      )}
      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">加载中…</div>
      ) : (
        <div className="space-y-6">

          {/* Today's GitHub Actions task status */}
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">今日任务状态</h2>
            <div className="grid grid-cols-3 gap-4">
              {(['keywords', 'weight', 'rank'] as const).map(step => {
                const { ok, empty, fail, total, latestRun, runs } = getTodaySummary(step)
                const hasProblems = empty > 0 || fail > 0
                const isExpanded = expandedStep === step
                return (
                  <div key={step} className="card p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{STEP_LABELS[step]}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{STEP_TIMES[step]} MYT</p>
                      </div>
                      {latestRun ? (
                        <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
                          {formatCardTime(latestRun.logged_at)} 执行
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">尚无记录</span>
                      )}
                    </div>

                    {runs > 0 ? (
                      <>
                        {/* X/Y 站成功 */}
                        <div className="flex items-end justify-between mt-3">
                          <div>
                            <span className={`text-2xl font-bold tabular-nums ${hasProblems ? 'text-yellow-600' : 'text-green-700'}`}>
                              {ok}
                            </span>
                            <span className="text-sm text-gray-400">
                              {total > 0 ? `/${total}` : ''} 站成功
                            </span>
                            {fail > 0 && (
                              <span className="ml-2 text-xs text-red-500">{fail} 失败</span>
                            )}
                            {empty > 0 && (
                              <span className="ml-1 text-xs text-yellow-500">{empty} 空</span>
                            )}
                          </div>
                          {hasProblems && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openRetry(step)}
                                className="text-xs text-orange-500 hover:text-orange-700"
                              >
                                重试
                              </button>
                              <button
                                onClick={() => toggleExpandStep(step)}
                                className="text-xs text-blue-500 hover:text-blue-700"
                              >
                                {isExpanded ? '收起' : '查看'}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Expanded problem sites */}
                        {isExpanded && (
                          <div className="mt-3 border-t border-gray-100 pt-2 space-y-1">
                            {!expandedSites[step] ? (
                              <p className="text-xs text-gray-400">加载中…</p>
                            ) : expandedSites[step].length === 0 ? (
                              <p className="text-xs text-gray-400">无问题站点记录</p>
                            ) : (
                              expandedSites[step].map(sl => (
                                <div key={sl.id} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-700 truncate max-w-[140px]" title={sl.domain}>{sl.domain}</span>
                                  <span className={sl.status === 'fail' ? 'text-red-500' : 'text-yellow-600'}>
                                    {sl.status === 'fail' ? '失败' : '空'}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-gray-400 mt-3">今日暂无记录</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Row 2: rank-title / index-pages */}
          <div className="grid grid-cols-3 gap-4">

              {/* Card A — 排名抓取 */}
              <div className="card p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">排名抓取</p>
                    <p className="text-xs text-gray-400 mt-0.5">每日 02:00 MYT</p>
                  </div>
                  {row2.rankTitle.loggedAt ? (
                    <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
                      {formatCardTime(row2.rankTitle.loggedAt)} 执行
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">尚无记录</span>
                  )}
                </div>
                {row2.rankTitle.total > 0 ? (
                  <div className="mt-3">
                    <span className={`text-2xl font-bold tabular-nums ${row2.rankTitle.succeeded < row2.rankTitle.total ? 'text-yellow-600' : 'text-green-700'}`}>
                      {row2.rankTitle.succeeded}
                    </span>
                    <span className="text-sm text-gray-400">/{row2.rankTitle.total} 站成功</span>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-3">今日暂无记录</p>
                )}
              </div>

              {/* Card B — 百度收录 */}
              <div className="card p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">百度收录</p>
                    <p className="text-xs text-gray-400 mt-0.5">每日 03:00 MYT</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    {row2.indexPages ? (
                      <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
                        {formatCardTime(row2.indexPages.logged_at)} 执行
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">尚无记录</span>
                    )}
                  </div>
                </div>
                {row2.indexPages ? (
                  <div className="mt-3">
                    <span className={`text-2xl font-bold tabular-nums ${row2.indexPages.fail_count > 0 ? 'text-yellow-600' : 'text-green-700'}`}>
                      {row2.indexPages.ok_count}
                    </span>
                    <span className="text-sm text-gray-400">/{row2.indexPages.ok_count + row2.indexPages.empty_count + row2.indexPages.fail_count} 站成功</span>
                    {row2.indexPages.rows_written > 0 && (
                      <span className="ml-2 text-xs text-gray-400">{row2.indexPages.rows_written.toLocaleString()} 新增页面</span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-3">今日暂无记录</p>
                )}
              </div>

          </div>

          {/* Run log table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">运行记录</h2>
              <div className="flex items-center gap-2">
                {/* 全部 reset */}
                <button
                  onClick={resetFilters}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium ${
                    !isFiltered() ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  全部
                </button>

                {/* 日期▼ */}
                <div className="relative">
                  <select
                    value={filterDate}
                    onChange={e => { setFilterDate(e.target.value); setPage(1) }}
                    className={SELECT_CLS + (filterDate ? ' border-blue-300 text-blue-600' : '')}
                  >
                    <option value="">日期</option>
                    <option value="today">今天</option>
                    <option value="yesterday">昨天</option>
                    <option value="3days">近 3 天</option>
                  </select>
                  <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▼</span>
                </div>

                {/* 类型▼ */}
                <div className="relative">
                  <select
                    value={filterType}
                    onChange={e => { setFilterType(e.target.value); setPage(1) }}
                    className={SELECT_CLS + (filterType ? ' border-blue-300 text-blue-600' : '')}
                  >
                    <option value="">类型</option>
                    <option value="cron_task">任务cron</option>
                    <option value="cron_manual">手动cron</option>
                    <option value="search">搜索</option>
                  </select>
                  <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▼</span>
                </div>

                {/* 域名搜索 */}
                <input
                  type="text"
                  placeholder="域名"
                  value={filterDomain}
                  onChange={e => { setFilterDomain(e.target.value); setPage(1) }}
                  className={`text-xs border rounded-md px-2.5 py-1 bg-white focus:outline-none w-32 ${filterDomain ? 'border-blue-300 text-blue-600' : 'border-gray-200 text-gray-600'}`}
                />

                {/* 运行异常 */}
                <button
                  onClick={() => { setOnlyProblems(p => !p); setPage(1) }}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium ${
                    onlyProblems ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  运行异常
                </button>
              </div>
            </div>

            <div className="card overflow-hidden">
              {filteredLogs.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">暂无记录</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: '150px' }} />
                      <col style={{ width: '80px' }} />
                      <col style={{ width: '220px' }} />
                      <col style={{ width: '104px' }} />
                      <col style={{ width: '70px' }} />
                      <col style={{ width: '85px' }} />
                      <col style={{ width: '100px' }} />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-4 py-2.5 text-sm font-medium text-gray-600 whitespace-nowrap">时间 (MYT)</th>
                        <th className="text-left px-4 py-2.5 text-sm font-medium text-gray-600 whitespace-nowrap">类型</th>
                        <th className="text-left px-4 py-2.5 text-sm font-medium text-gray-600">步骤 / 域名 / IP</th>
                        <th className="text-center px-4 py-2.5 text-sm font-medium text-gray-600 whitespace-nowrap">成 / 空 / 失</th>
                        <th className="text-left px-4 py-2.5 text-sm font-medium text-gray-600 whitespace-nowrap">状态</th>
                        <th className="text-left px-4 py-2.5 text-sm font-medium text-gray-600 whitespace-nowrap">时长</th>
                        <th className="text-right pr-4 py-2.5 text-sm font-medium text-gray-600">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pagedLogs.map(log => (
                        <tr key={log.id} className="hover:bg-gray-100">
                          <td className="px-4 py-2.5 text-sm text-gray-500 tabular-nums whitespace-nowrap">
                            {formatDateTime(log.logged_at)}
                          </td>
                          <td className="px-4 py-2.5 text-sm whitespace-nowrap">
                            <span className={
                              log.type === 'cron_task' ? 'text-blue-600' :
                              log.type === 'cron_manual' ? 'text-violet-600' :
                              'text-gray-500'
                            }>
                              {TYPE_LABELS[log.type] ?? log.type}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-700 truncate">
                            {log.step && <span className="font-medium">{STEP_LABELS[log.step] ?? log.step}</span>}
                            {log.domain && <span className="text-gray-400"> · {log.domain}</span>}
                            {log.ip && <span className="text-gray-400"> · IP：{log.ip}</span>}
                            {log.group_index != null && log.total_groups != null && (
                              <span className="text-gray-400"> #{log.group_index}/{log.total_groups}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-sm tabular-nums text-center whitespace-nowrap">
                            <span className="text-green-700">{log.ok_count}</span>
                            <span className="text-gray-300 mx-1">/</span>
                            <span className={log.empty_count > 0 ? 'text-yellow-600' : 'text-gray-400'}>{log.empty_count}</span>
                            <span className="text-gray-300 mx-1">/</span>
                            <span className={log.fail_count > 0 ? 'text-red-500' : 'text-gray-400'}>{log.fail_count}</span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <StatusText status={log.status} />
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-400 tabular-nums whitespace-nowrap">
                            {formatDuration(log.duration_ms)}
                          </td>
                          <td className="pr-4 py-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              {log.step && (
                                <button
                                  onClick={() => setRulesStep(log.step as string)}
                                  className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-1.5 py-0.5 hover:border-gray-300"
                                >
                                  规则
                                </button>
                              )}
                              <button
                                onClick={() => openDetail(log)}
                                className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200"
                              >
                                查看
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                      <span className="text-xs text-gray-400">
                        第 {safePage} / {totalPages} 页 · 共 {filteredLogs.length} 条
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={safePage === 1}
                          className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          上一页
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                          .reduce<(number | '…')[]>((acc, n, i, arr) => {
                            if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…')
                            acc.push(n)
                            return acc
                          }, [])
                          .map((item, i) =>
                            item === '…' ? (
                              <span key={`e${i}`} className="px-1.5 text-xs text-gray-400">…</span>
                            ) : (
                              <button
                                key={item}
                                onClick={() => setPage(item as number)}
                                className={`w-7 py-1 text-xs rounded border ${
                                  safePage === item
                                    ? 'bg-gray-800 text-white border-gray-800'
                                    : 'border-gray-200 text-gray-600 hover:bg-white'
                                }`}
                              >
                                {item}
                              </button>
                            )
                          )}
                        <button
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={safePage === totalPages}
                          className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Retry Modal */}
      {retryModal && (
        <RetryModal
          step={retryModal.step}
          sites={retryModal.sites}
          onClose={() => setRetryModal(null)}
          onRefresh={() => {
            fetchData()
            setExpandedSites({})
            setExpandedStep(null)
          }}
        />
      )}

      {/* Rules Modal */}
      {rulesStep && rulesSection && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setRulesStep(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{rulesSection.title}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{rulesSection.badge}</p>
              </div>
              <button onClick={() => setRulesStep(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              {rulesSection.items.map(item => (
                <div key={item.label} className="flex gap-3 text-sm">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium flex-shrink-0 h-fit mt-0.5">{item.label}</span>
                  <span className="text-gray-600">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailActivity && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetailActivity(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {detailActivity.step ? (STEP_LABELS[detailActivity.step] ?? detailActivity.step) : (detailActivity.domain ?? '详情')}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDateTime(detailActivity.logged_at)} MYT
                  {' · '}{TYPE_LABELS[detailActivity.type] ?? detailActivity.type}
                  {detailActivity.source && ` · ${detailActivity.source}`}
                  {detailActivity.ip && ` · IP ${detailActivity.ip}`}
                </p>
              </div>
              <button onClick={() => setDetailActivity(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4">
              <div className="flex items-center flex-wrap gap-4 mb-4 text-sm">
                <StatusText status={detailActivity.status} />
                <span className="text-gray-500">成功 <span className="font-medium text-green-700">{detailActivity.ok_count}</span></span>
                <span className="text-gray-500">空 <span className="font-medium text-yellow-600">{detailActivity.empty_count}</span></span>
                <span className="text-gray-500">跳过 <span className="font-medium text-gray-500">{detailActivity.skip_count}</span></span>
                <span className="text-gray-500">失败 <span className="font-medium text-red-500">{detailActivity.fail_count}</span></span>
                <span className="text-gray-400">{formatDuration(detailActivity.duration_ms)}</span>
              </div>
              {detailActivity.summary && (
                <p className="text-xs text-gray-500 mb-4 bg-gray-50 rounded px-3 py-2">{detailActivity.summary}</p>
              )}
              {siteLogsLoading ? (
                <div className="text-center text-gray-400 text-sm py-8">加载中…</div>
              ) : siteLogsError ? (
                <div className="text-center text-red-500 text-sm py-8">加载失败：{siteLogsError}</div>
              ) : siteLogs.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8">无站点明细记录</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 text-sm font-medium text-gray-600">域名</th>
                      <th className="text-left py-2 text-sm font-medium text-gray-600">状态</th>
                      <th className="text-left py-2 text-sm font-medium text-gray-600">写入</th>
                      <th className="text-left py-2 text-sm font-medium text-gray-600">详情</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {siteLogs.map(sl => (
                      <tr key={sl.id}>
                        <td className="py-1.5 text-sm text-gray-700">{sl.domain}</td>
                        <td className="py-1.5 text-sm">
                          <span className={SITE_STATUS_COLORS[sl.status] ?? 'text-gray-500'}>
                            {SITE_STATUS_LABELS[sl.status] ?? sl.status}
                          </span>
                        </td>
                        <td className="py-1.5 text-sm text-gray-400">{sl.rows_written > 0 ? `${sl.rows_written} 行` : '-'}</td>
                        <td className="py-1.5 text-sm text-gray-400 max-w-[220px] truncate" title={sl.detail ?? ''}>{sl.detail ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
