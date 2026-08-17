'use client'

import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { buildGroupMaps, groupSortedRows } from '@/lib/company-groups'
import { useUser } from '@/lib/user-context'
import { SimplePagination, PAGE_SIZE } from '@/components/simple-pagination'
import { computeKwStatus } from '@/lib/kw-status'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface CompetitorRow {
  site_id: string
  domain: string
  name: string
  focus_level: number
  yesterday: number
  weekdayBaseline: number
  weekendBaseline: number
  trend: { date: string; count: number }[]
  status: 'normal' | 'warning' | 'high'
  hasHtml: boolean
  hasRankData: boolean
  hasRankTitle: boolean
}


interface SiteRow {
  id: string
  domain: string
  name: string
  focus_level: number
  list_url: string | null
  has_rank_data: boolean
  has_rank_title: boolean
  friend_links?: string[] | null
  is_enabled?: boolean
}

interface Keyword {
  keyword: string
  source_url: string | null
  discovered_at: string
  content_date: string | null
  content_type: string | null
}

interface CleanedEntry {
  base: string
  variants: string[]
}

interface RankEntry {
  keyword: string
  volume: number
}

interface UnstableEntry {
  keyword: string
  volume: number
  upDays: number
  downDays: number
  totalDays: number
}

type PageSize = 50 | 100 | 500
const PAGE_SIZES: PageSize[] = [50, 100, 500]

const statusConfig = {
  normal:  { label: '正常', className: 'text-green-600 bg-green-50 px-2 py-0.5 rounded text-sm font-medium' },
  warning: { label: '偏低', className: 'text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded text-sm font-medium' },
  high:    { label: '偏高', className: 'text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-sm font-medium' },
}

function PaginationBar({ page, total, pageSize, onPageChange, onPageSizeChange }: {
  page: number
  total: number
  pageSize: PageSize
  onPageChange: (p: number) => void
  onPageSizeChange: (s: PageSize) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between px-5 py-2.5 border-t border-gray-100 bg-gray-50/50 flex-shrink-0 text-xs">
      <div className="flex items-center gap-1.5 text-gray-500">
        每页
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
          className="border border-gray-200 rounded px-1 py-0.5 text-xs"
        >
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} 条</option>)}
        </select>
        <span className="ml-1 text-gray-400">共 {total} 条</span>
      </div>
      <div className="flex items-center gap-1">
        <button disabled={page === 0} onClick={() => onPageChange(0)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100">«</button>
        <button disabled={page === 0} onClick={() => onPageChange(page - 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100">‹</button>
        <span className="px-2 text-gray-600">{page + 1} / {totalPages}</span>
        <button disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100">›</button>
        <button disabled={page >= totalPages - 1} onClick={() => onPageChange(totalPages - 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100">»</button>
      </div>
    </div>
  )
}

function cleanTitleClient(title: string, suffixes: string[]): string {
  if (suffixes.length === 0) return title
  const escaped = suffixes.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`\\s*(${escaped.join('|')})$`, 'i')
  return title.replace(pattern, '').replace(/\s{2,}/g, ' ').trim() || title
}

export default function CompetitorDailyPage() {
  const { role, accessibleSiteIds } = useUser()
  const [rows, setRows] = useState<CompetitorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterSite, setFilterSite] = useState('')
  const [filterFocus, setFilterFocus] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [groupColorMap, setGroupColorMap] = useState<Map<string, string>>(new Map())
  const [sortCol, setSortCol] = useState<'yesterday' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(dir: 'asc' | 'desc') {
    if (sortCol === 'yesterday' && sortDir === dir) { setSortCol(null) }
    else { setSortCol('yesterday'); setSortDir(dir) }
    setMainPage(0)
  }

  // 主列表分页
  const [mainPage, setMainPage] = useState(0)

  // 全局分页大小（所有 modal 共用）
  const [pageSize, setPageSize] = useState<PageSize>(50)

  // 昨日新词 modal
  const [selectedSite, setSelectedSite] = useState<CompetitorRow | null>(null)
  const [siteKeywords, setSiteKeywords] = useState<Keyword[]>([])
  const [kwLoading, setKwLoading] = useState(false)
  const [kwDate, setKwDate] = useState('')
  const [kwTab, setKwTab] = useState<'app' | 'game'>('app')
  const [kwCounts, setKwCounts] = useState<{ app: number; game: number }>({ app: 0, game: 0 })
  const [kwPage, setKwPage] = useState(0)

  // 更新词库 modal
  const [cleanSite, setCleanSite] = useState<CompetitorRow | null>(null)
  const [cleanedEntries, setCleanedEntries] = useState<CleanedEntry[]>([])
  const [cleanLoading, setCleanLoading] = useState(false)
  const [expandedBases, setExpandedBases] = useState<Set<string>>(new Set())
  const [cleanPage, setCleanPage] = useState(0)

  // 排名变动 modal
  const [rankSite, setRankSite] = useState<CompetitorRow | null>(null)
  const [rankType, setRankType] = useState<'rankup' | 'rankdown'>('rankup')
  const [rankDate, setRankDate] = useState('')
  const [rankPageData, setRankPageData] = useState<RankEntry[]>([])
  const [rankCounts, setRankCounts] = useState<{ rankup: number; rankdown: number }>({ rankup: 0, rankdown: 0 })
  const [rankLoading, setRankLoading] = useState(false)
  const [rankPage, setRankPage] = useState(0)
  const [rankUnstableSet, setRankUnstableSet] = useState<Set<string>>(new Set())

  // 不稳定词 modal
  const [unstableSite, setUnstableSite] = useState<CompetitorRow | null>(null)
  const [unstableData, setUnstableData] = useState<UnstableEntry[]>([])
  const [unstableLoading, setUnstableLoading] = useState(false)
  const [unstablePage, setUnstablePage] = useState(0)

  // 趋势 modal
  const [trendSite, setTrendSite] = useState<CompetitorRow | null>(null)

  // 重新抓取
  const [rankCrawling, setRankCrawling] = useState(false)
  const [kwCrawling, setKwCrawling] = useState(false)
  const [kwCrawlMsg, setKwCrawlMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [rankCrawlMsg, setRankCrawlMsg] = useState<{ text: string; ok: boolean } | null>(null)

  function getMalaysiaDate(offsetDays = 0) {
    return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
  }

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const supabase = getBrowserClient()
      const yesterday = getMalaysiaDate(-1)
      const d30ago = getMalaysiaDate(-30)

      interface KwStatRow { site_id: string; stat_date: string; app_count: number; game_count: number }

      const [sitesApiRes, { data: statsRaw }, { data: groupsRaw }] = await Promise.all([
        fetch('/api/sites').then(r => r.json() as Promise<{ sites: SiteRow[] }>),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('competitor_kw_stats') as any)
          .select('site_id, stat_date, app_count, game_count')
          .gte('stat_date', d30ago)
          .lte('stat_date', yesterday),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('task_groups') as any).select('associated_domains'),
      ])

      const associatedDomains = new Set<string>()
      for (const g of (groupsRaw || []) as { associated_domains: string[] | null }[]) {
        for (const d of g.associated_domains || []) {
          if (d) associatedDomains.add(d)
        }
      }
      const allSites = (sitesApiRes.sites || []) as SiteRow[]
      const sites = accessibleSiteIds
        ? allSites.filter(s => accessibleSiteIds.includes(s.id))
        : allSites
      const stats = (statsRaw || []) as KwStatRow[]

      const result: CompetitorRow[] = sites.map((site) => {
        const siteStats = stats.filter(s => s.site_id === site.id)
        const ytStat = siteStats.find(s => (s.stat_date ?? '').slice(0, 10) === yesterday)
        const yesterdayVal = (ytStat?.app_count ?? 0) + (ytStat?.game_count ?? 0)

        const trend = siteStats
          .map(s => ({ date: (s.stat_date ?? '').slice(5), count: (s.app_count ?? 0) + (s.game_count ?? 0) }))
          .filter(p => p.date)
          .sort((a, b) => a.date.localeCompare(b.date))

        const weekdayVals: number[] = [], weekendVals: number[] = []
        for (const s of siteStats) {
          const d = (s.stat_date ?? '').slice(0, 10)
          if (!d || d === yesterday) continue
          const dow = new Date(d).getDay()
          const v = (s.app_count ?? 0) + (s.game_count ?? 0)
          if (dow === 0 || dow === 6) weekendVals.push(v)
          else weekdayVals.push(v)
        }
        const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
        const weekdayBaseline = avg(weekdayVals)
        const weekendBaseline = avg(weekendVals)

        const status = computeKwStatus(siteStats, yesterday)
        return { site_id: site.id, domain: site.domain, name: site.name, focus_level: site.focus_level ?? 3, yesterday: yesterdayVal, weekdayBaseline, weekendBaseline, trend, status, hasHtml: !!site.list_url, hasRankData: (site.has_rank_data ?? false) || associatedDomains.has(site.domain), hasRankTitle: site.has_rank_title ?? false }
      })

      const statusPriority = (r: CompetitorRow) => {
        if (r.status === 'warning') return 0
        if (r.status === 'high') return 1
        return 2
      }
      const { idMap, colorMap } = buildGroupMaps(sites)
      const sorted = result.sort((a, b) => {
        if (a.focus_level !== b.focus_level) return a.focus_level - b.focus_level
        if (a.focus_level >= 3) {
          const pd = statusPriority(a) - statusPriority(b)
          if (pd !== 0) return pd
        }
        return b.yesterday - a.yesterday
      })
      setRows(groupSortedRows(sorted, idMap, r => [r.focus_level]))
      setGroupColorMap(colorMap)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  // ── 昨日新词 ─────────────────────────────────────────────────────────────────

  function buildKwBaseQuery(supabase: ReturnType<typeof getBrowserClient>, site: CompetitorRow, date: string, tab: 'app' | 'game', from: number, to: number) {
    const base = supabase.from('raw_keywords')
      .select('keyword, source_url, discovered_at, content_date, content_type')
      .eq('site_id', site.site_id).eq('content_date', date)
      .not('keyword', 'like', '%电脑版%')
      .order('keyword', { ascending: true })
      .range(from, to)
    if (tab === 'game') return base.eq('content_type', 'game')
    return base.or('content_type.eq.app,content_type.is.null')
  }

  async function fetchKeywordsForDate(site: CompetitorRow, date: string, tab: 'app' | 'game', ps: PageSize = pageSize) {
    setKwPage(0)
    setKwLoading(true)
    setSiteKeywords([])
    try {
      const supabase = getBrowserClient()
      const [appRes, gameRes, kwRes] = await Promise.all([
        supabase.from('raw_keywords').select('id', { count: 'exact', head: true })
          .eq('site_id', site.site_id).eq('content_type', 'app')
          .eq('content_date', date).not('keyword', 'like', '%电脑版%'),
        supabase.from('raw_keywords').select('id', { count: 'exact', head: true })
          .eq('site_id', site.site_id).eq('content_type', 'game')
          .eq('content_date', date).not('keyword', 'like', '%电脑版%'),
        buildKwBaseQuery(supabase, site, date, tab, 0, ps - 1),
      ])
      setKwCounts({ app: appRes.count ?? 0, game: gameRes.count ?? 0 })
      if (kwRes.error) throw kwRes.error
      setSiteKeywords((kwRes.data || []) as Keyword[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(supabase.from('competitor_kw_stats') as any).upsert(
        { site_id: site.site_id, stat_date: date, app_count: appRes.count ?? 0, game_count: gameRes.count ?? 0, updated_at: new Date().toISOString() },
        { onConflict: 'site_id,stat_date' }
      ).then(() => loadData()).catch(() => loadData())
    } catch {
      setSiteKeywords([])
    } finally {
      setKwLoading(false)
    }
  }

  async function fetchKeywordsPage(site: CompetitorRow, date: string, tab: 'app' | 'game', page: number, ps: PageSize = pageSize) {
    setKwLoading(true)
    setSiteKeywords([])
    try {
      const supabase = getBrowserClient()
      const from = page * ps
      const to = (page + 1) * ps - 1
      const { data, error: err } = await buildKwBaseQuery(supabase, site, date, tab, from, to)
      if (err) throw err
      setSiteKeywords((data || []) as Keyword[])
    } catch {
      setSiteKeywords([])
    } finally {
      setKwLoading(false)
    }
  }

  async function triggerKwCrawl() {
    if (!selectedSite) return
    setKwCrawling(true)
    setKwCrawlMsg(null)
    try {
      const res = await fetch('/api/trigger-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: selectedSite.domain, step: 'keywords' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setKwCrawlMsg({ text: data?.error || `请求失败（${res.status}）`, ok: false })
      } else {
        const siteResult = (data?.results ?? []).find((r: { site: string; error?: string }) => r.site === selectedSite.domain)
        if (siteResult?.error) setKwCrawlMsg({ text: siteResult.error, ok: false })
        else setKwCrawlMsg({ text: `抓取成功，新增${siteResult?.count ?? 0}条`, ok: true })
      }
      await fetchKeywordsForDate(selectedSite, kwDate, kwTab)
    } catch {
      setKwCrawlMsg({ text: '请求失败，请检查网络', ok: false })
    } finally {
      setKwCrawling(false)
    }
  }

  function viewYesterdayKeywords(site: CompetitorRow) {
    const date = getMalaysiaDate(-1)
    setSelectedSite(site)
    setKwDate(date)
    setKwTab('app')
    setKwCounts({ app: 0, game: 0 })
    fetchKeywordsForDate(site, date, 'app')
  }

  function handleKwDateChange(date: string) {
    setKwDate(date)
    setKwTab('app')
    setKwCounts({ app: 0, game: 0 })
    if (selectedSite) fetchKeywordsForDate(selectedSite, date, 'app')
  }

  function handleKwTabChange(tab: 'app' | 'game') {
    setKwTab(tab)
    setKwPage(0)
    if (selectedSite && kwDate) fetchKeywordsForDate(selectedSite, kwDate, tab)
  }

  function handleKwPageChange(page: number) {
    setKwPage(page)
    if (selectedSite && kwDate) fetchKeywordsPage(selectedSite, kwDate, kwTab, page)
  }

  function handleKwPageSizeChange(ps: PageSize) {
    setPageSize(ps)
    setKwPage(0)
    if (selectedSite && kwDate) fetchKeywordsForDate(selectedSite, kwDate, kwTab, ps)
  }

  // ── 更新词库 ─────────────────────────────────────────────────────────────────

  async function viewCleanedKeywords(site: CompetitorRow) {
    setCleanSite(site)
    setCleanPage(0)
    setCleanLoading(true)
    setCleanedEntries([])
    try {
      const supabase = getBrowserClient()
      const since = new Date(Date.now() - 30 * 86400000).toISOString()

      const { data: kwData } = await supabase
        .from('raw_keywords')
        .select('keyword')
        .eq('site_id', site.site_id)
        .gte('discovered_at', since)
        .limit(5000)

      const keywords = Array.from(
        new Set(
          ((kwData || []) as { keyword: string }[])
            .map((r) => r.keyword)
            .filter((k) => !k.includes('电脑版'))
        )
      ).sort((a, b) => a.length - b.length)

      const groups = new Map<string, string[]>()
      for (const k of keywords) {
        let matched = false
        for (const base of Array.from(groups.keys())) {
          if (k.startsWith(base) && k !== base) {
            groups.get(base)!.push(k)
            matched = true
            break
          }
        }
        if (!matched) groups.set(k, [k])
      }

      const entries: CleanedEntry[] = Array.from(groups.entries())
        .map(([base, variants]) => ({ base, variants }))
        .filter((e) => e.variants.length > 1)
        .sort((a, b) => b.variants.length - a.variants.length)

      setCleanedEntries(entries)
    } catch {
      setCleanedEntries([])
    } finally {
      setCleanLoading(false)
    }
  }

  // ── 排名变动 ─────────────────────────────────────────────────────────────────

  async function fetchRankPage(site: CompetitorRow, date: string, type: 'rankup' | 'rankdown', page: number, ps: PageSize = pageSize, fetchCounts = false) {
    setRankLoading(true)
    setRankPageData([])
    try {
      const supabase = getBrowserClient()
      const from = page * ps
      const to = (page + 1) * ps - 1

      const useNewTable = site.hasRankTitle
      if (fetchCounts) {
        const baseUp = useNewTable
          ? supabase.from('site_keyword_ranks').select('id', { count: 'exact', head: true }).eq('site_id', site.site_id).eq('stat_date', date).eq('type', 'rankup').eq('platform', 'mobile').gt('volume', 0)
          : supabase.from('rank_changes').select('id', { count: 'exact', head: true }).eq('site_id', site.site_id).eq('stat_date', date).eq('type', 'rankup')
        const baseDown = useNewTable
          ? supabase.from('site_keyword_ranks').select('id', { count: 'exact', head: true }).eq('site_id', site.site_id).eq('stat_date', date).eq('type', 'rankdown').eq('platform', 'mobile').gt('volume', 0)
          : supabase.from('rank_changes').select('id', { count: 'exact', head: true }).eq('site_id', site.site_id).eq('stat_date', date).eq('type', 'rankdown')
        const basePage = useNewTable
          ? supabase.from('site_keyword_ranks').select('keyword, volume').eq('site_id', site.site_id).eq('stat_date', date).eq('type', type).eq('platform', 'mobile').gt('volume', 0).order('volume', { ascending: false }).range(from, to)
          : supabase.from('rank_changes').select('keyword, volume').eq('site_id', site.site_id).eq('stat_date', date).eq('type', type).order('volume', { ascending: false }).range(from, to)
        const [upCount, downCount, pageRes] = await Promise.all([baseUp, baseDown, basePage])
        setRankCounts({ rankup: upCount.count ?? 0, rankdown: downCount.count ?? 0 })
        setRankPageData((pageRes.data || []) as RankEntry[])
      } else {
        const q = useNewTable
          ? supabase.from('site_keyword_ranks').select('keyword, volume').eq('site_id', site.site_id).eq('stat_date', date).eq('type', type).eq('platform', 'mobile').gt('volume', 0).order('volume', { ascending: false }).range(from, to)
          : supabase.from('rank_changes').select('keyword, volume').eq('site_id', site.site_id).eq('stat_date', date).eq('type', type).order('volume', { ascending: false }).range(from, to)
        const { data } = await q
        setRankPageData((data || []) as RankEntry[])
      }
    } catch {
      setRankPageData([])
    } finally {
      setRankLoading(false)
    }
  }

  async function triggerRankCrawl() {
    if (!rankSite) return
    setRankCrawling(true)
    setRankCrawlMsg(null)
    try {
      const step = rankSite.hasRankTitle ? 'rank-title' : 'rank'
      const res = await fetch('/api/trigger-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: rankSite.domain, step }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setRankCrawlMsg({ text: data?.error || `请求失败（${res.status}）`, ok: false })
      } else {
        const siteResult = (data?.results ?? []).find((r: { site: string; error?: string }) => r.site === rankSite.domain)
        if (siteResult?.error) setRankCrawlMsg({ text: siteResult.error, ok: false })
        // rank-title 成功时 results 会带真实条数，plain rank 成功时接口不返回
        // 条数（只有失败才会push进results）——没有条数信息时不要编一个"0条"出来
        else setRankCrawlMsg({ text: siteResult?.count != null ? `抓取成功，${siteResult.count}条` : '抓取成功', ok: true })
      }
      await fetchRankPage(rankSite, rankDate, rankType, 0, pageSize, true)
      setRankPage(0)
    } catch {
      setRankCrawlMsg({ text: '请求失败，请检查网络', ok: false })
    } finally {
      setRankCrawling(false)
    }
  }

  async function openRankModal(site: CompetitorRow) {
    const today = getMalaysiaDate(0)
    setRankType('rankup')
    setRankDate(today)
    setRankPage(0)
    setRankSite(site)
    fetchRankPage(site, today, 'rankup', 0, pageSize, true)

    try {
      const supabase = getBrowserClient()
      const since = getMalaysiaDate(-30)
      const q = site.hasRankTitle
        ? supabase.from('site_keyword_ranks').select('keyword, type, stat_date').eq('site_id', site.site_id).eq('platform', 'mobile').gt('volume', 0).gte('stat_date', since).limit(5000)
        : supabase.from('rank_changes').select('keyword, type, stat_date').eq('site_id', site.site_id).gte('stat_date', since).limit(5000)
      const { data } = await q

      type RawRow = { keyword: string; type: string; stat_date: string }
      const rows = (data || []) as RawRow[]
      const upSet = new Map<string, Set<string>>()
      const downSet = new Map<string, Set<string>>()
      for (const row of rows) {
        if (row.type === 'rankup') {
          if (!upSet.has(row.keyword)) upSet.set(row.keyword, new Set())
          upSet.get(row.keyword)!.add(row.stat_date)
        } else {
          if (!downSet.has(row.keyword)) downSet.set(row.keyword, new Set())
          downSet.get(row.keyword)!.add(row.stat_date)
        }
      }
      const unstable = new Set<string>()
      for (const kw of Array.from(upSet.keys())) {
        const up = upSet.get(kw)!.size
        const down = downSet.get(kw)?.size ?? 0
        if (down > 0 && up + down >= 3) unstable.add(kw)
      }
      setRankUnstableSet(unstable)
    } catch {
      setRankUnstableSet(new Set())
    }
  }

  function handleRankTypeChange(type: 'rankup' | 'rankdown') {
    setRankType(type)
    setRankPage(0)
    if (rankSite && rankDate) fetchRankPage(rankSite, rankDate, type, 0, pageSize, false)
  }

  function handleRankDateChange(date: string) {
    setRankDate(date)
    setRankPage(0)
    if (rankSite) fetchRankPage(rankSite, date, rankType, 0, pageSize, true)
  }

  function handleRankPageChange(page: number) {
    setRankPage(page)
    if (rankSite && rankDate) fetchRankPage(rankSite, rankDate, rankType, page, pageSize, false)
  }

  function handleRankPageSizeChange(ps: PageSize) {
    setPageSize(ps)
    setRankPage(0)
    if (rankSite && rankDate) fetchRankPage(rankSite, rankDate, rankType, 0, ps, false)
  }

  // ── 不稳定词 ─────────────────────────────────────────────────────────────────

  async function openUnstableModal(site: CompetitorRow) {
    setUnstableSite(site)
    setUnstablePage(0)
    setUnstableLoading(true)
    setUnstableData([])
    try {
      const supabase = getBrowserClient()
      const since = getMalaysiaDate(-30)
      const q = site.hasRankTitle
        ? supabase.from('site_keyword_ranks').select('keyword, volume, type, stat_date').eq('site_id', site.site_id).eq('platform', 'mobile').gt('volume', 0).gte('stat_date', since).limit(5000)
        : supabase.from('rank_changes').select('keyword, volume, type, stat_date').eq('site_id', site.site_id).gte('stat_date', since).limit(5000)
      const { data } = await q

      type RawRow = { keyword: string; volume: number; type: string; stat_date: string }
      const rows = (data || []) as RawRow[]

      const kwMap = new Map<string, { upDays: Set<string>; downDays: Set<string>; volumes: number[] }>()
      for (const row of rows) {
        if (!kwMap.has(row.keyword)) kwMap.set(row.keyword, { upDays: new Set(), downDays: new Set(), volumes: [] })
        const entry = kwMap.get(row.keyword)!
        if (row.type === 'rankup') entry.upDays.add(row.stat_date)
        else entry.downDays.add(row.stat_date)
        if (row.volume > 0) entry.volumes.push(row.volume)
      }

      const results: UnstableEntry[] = []
      for (const [keyword, { upDays, downDays, volumes }] of Array.from(kwMap.entries())) {
        if (upDays.size > 0 && downDays.size > 0 && upDays.size + downDays.size >= 3) {
          const volume = volumes.length > 0 ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) : 0
          results.push({ keyword, volume, upDays: upDays.size, downDays: downDays.size, totalDays: upDays.size + downDays.size })
        }
      }

      setUnstableData(results.sort((a, b) => b.volume - a.volume || b.totalDays - a.totalDays))
    } catch {
      setUnstableData([])
    } finally {
      setUnstableLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const visibleRows = rows.filter(r => {
    if (filterSite && !r.domain.toLowerCase().includes(filterSite.toLowerCase()) && !r.name?.toLowerCase().includes(filterSite.toLowerCase())) return false
    if (filterFocus && String(r.focus_level) !== filterFocus) return false
    if (filterStatus && r.status !== filterStatus) return false
    return true
  })

  const sortedVisible = sortCol === null ? visibleRows : [...visibleRows].sort((a, b) =>
    sortDir === 'asc' ? a.yesterday - b.yesterday : b.yesterday - a.yesterday
  )

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">竞品日收</h1>
        <p className="text-gray-400 text-sm mt-0.5">各站点每日新增关键词数量对比</p>
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
                onChange={(e) => { setFilterSite(e.target.value); setMainPage(0) }}
                placeholder="输入域名..."
                className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none w-36"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">关注级别</span>
              <select value={filterFocus} onChange={(e) => { setFilterFocus(e.target.value); setMainPage(0) }} className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                <option value="">全部</option>
                <option value="1">重点</option>
                <option value="2">侧重</option>
                <option value="3">普通</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">状态</span>
              <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setMainPage(0) }} className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                <option value="">全部</option>
                <option value="normal">正常</option>
                <option value="warning">偏低</option>
                <option value="high">偏高</option>
              </select>
            </div>
            <span className="ml-auto text-xs text-gray-400">共 {visibleRows.length} 条</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-th">域名</th>
                  <th className="table-th"><div className="flex items-center justify-center gap-1">昨日新增<span className="flex flex-col items-center gap-px select-none"><svg onClick={() => handleSort('asc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor" className={`cursor-pointer ${sortCol === 'yesterday' && sortDir === 'asc' ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 0L8 5H0Z"/></svg><svg onClick={() => handleSort('desc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor" className={`cursor-pointer ${sortCol === 'yesterday' && sortDir === 'desc' ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 5L0 0H8Z"/></svg></span></div></th>
                  <th className="table-th text-center">状态</th>
                  <th className="table-th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="table-td text-center text-gray-400 py-10">暂无数据</td>
                  </tr>
                ) : (
                  sortedVisible.slice(mainPage * PAGE_SIZE, (mainPage + 1) * PAGE_SIZE).map((row) => {
                    const s = statusConfig[row.status]
                    return (
                      <tr key={row.site_id} className="hover:bg-gray-100 transition-colors" style={{ borderLeft: groupColorMap.has(row.domain) ? `4px solid ${groupColorMap.get(row.domain)}` : '4px solid transparent' }}>
                        <td className="table-td">
                          <span className="font-medium text-gray-900">{row.domain}</span>
                          {row.name && <span className="text-gray-400"> · {row.name}</span>}
                        </td>
                        <td className="table-td text-center font-semibold text-green-600">{row.yesterday.toLocaleString()}</td>
                        <td className="table-td text-center">
                          <span className={s.className}>{s.label}</span>
                        </td>
                        <td className="table-td text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setTrendSite(row)}
                              className="text-xs border rounded px-1.5 py-0.5 transition-colors text-blue-500 hover:text-blue-700 border-blue-100 hover:border-blue-200"
                            >
                              查看
                            </button>
                            <button
                              onClick={() => row.hasHtml && viewYesterdayKeywords(row)}
                              disabled={!row.hasHtml}
                              className={`text-xs border rounded px-1.5 py-0.5 transition-colors ${row.hasHtml ? 'text-green-500 hover:text-green-700 border-green-100 hover:border-green-200' : 'text-gray-300 border-gray-100 cursor-not-allowed'}`}
                            >
                              昨日新词
                            </button>
                            <button
                              onClick={() => row.hasHtml && viewCleanedKeywords(row)}
                              disabled={!row.hasHtml}
                              className={`text-xs border rounded px-1.5 py-0.5 transition-colors ${row.hasHtml ? 'text-amber-500 hover:text-amber-700 border-amber-100 hover:border-amber-200' : 'text-gray-300 border-gray-100 cursor-not-allowed'}`}
                            >
                              更新词库
                            </button>
                            <button
                              onClick={() => (row.hasRankData || row.hasRankTitle) && openRankModal(row)}
                              disabled={!row.hasRankData && !row.hasRankTitle}
                              className={`text-xs border rounded px-1.5 py-0.5 transition-colors ${(row.hasRankData || row.hasRankTitle) ? 'text-purple-500 hover:text-purple-700 border-purple-100 hover:border-purple-200' : 'text-gray-300 border-gray-100 cursor-not-allowed'}`}
                            >
                              排名变动
                            </button>
                            <button
                              onClick={() => (row.hasRankData || row.hasRankTitle) && openUnstableModal(row)}
                              disabled={!row.hasRankData && !row.hasRankTitle}
                              className={`text-xs border rounded px-1.5 py-0.5 transition-colors ${(row.hasRankData || row.hasRankTitle) ? 'text-rose-500 hover:text-rose-700 border-rose-100 hover:border-rose-200' : 'text-gray-300 border-gray-100 cursor-not-allowed'}`}
                            >
                              不稳定词
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <SimplePagination page={mainPage} total={sortedVisible.length} onChange={setMainPage} />
          </>
        )}
      </div>

      {/* 昨日新词 Modal */}
      {selectedSite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-gray-900">{selectedSite.domain} · 新词</h3>
                <input
                  type="date"
                  value={kwDate}
                  max={getMalaysiaDate(0)}
                  onChange={(e) => handleKwDateChange(e.target.value)}
                  className="text-sm border border-gray-200 rounded px-2 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <div className="flex items-center gap-2">
                {role !== 'normal' && (
                  <button
                    onClick={triggerKwCrawl}
                    disabled={kwCrawling}
                    className="text-xs text-gray-400 hover:text-green-600 px-2 py-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-40"
                  >
                    {kwCrawling ? '抓取中…' : '重抓'}
                  </button>
                )}
                <button onClick={() => setSelectedSite(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {kwCrawlMsg && (
              <p className={`text-xs px-5 py-1.5 border-b border-gray-100 ${kwCrawlMsg.ok ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50'}`}>
                {kwCrawlMsg.text}
              </p>
            )}
            {/* Tabs */}
            <div className="flex border-b border-gray-200 px-5">
              {(['app', 'game'] as const).map((t) => {
                const isActive = kwTab === t
                const label = t === 'app' ? '应用' : '游戏'
                const count = t === 'app' ? kwCounts.app : kwCounts.game
                const activeClass = t === 'app' ? 'border-blue-500 text-blue-600' : 'border-purple-500 text-purple-600'
                return (
                  <button
                    key={t}
                    onClick={() => handleKwTabChange(t)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors mr-2 ${
                      isActive ? activeClass : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                    {count > 0 && <span className="ml-1.5 text-xs text-gray-400">({count})</span>}
                  </button>
                )
              })}
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {kwLoading ? (
                <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  加载中...
                </div>
              ) : siteKeywords.length === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">该日期暂无新词</p>
              ) : (
                <ul className="space-y-2">
                  {siteKeywords.map((kw, i) => (
                    <li key={i} className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50">
                      <span className="text-sm text-gray-900">{kw.keyword}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {(kw.content_date ?? kwDate).slice(5).replace('-', '/')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* Pagination */}
            <PaginationBar
              page={kwPage}
              total={kwTab === 'app' ? kwCounts.app : kwCounts.game}
              pageSize={pageSize}
              onPageChange={handleKwPageChange}
              onPageSizeChange={handleKwPageSizeChange}
            />
          </div>
        </div>
      )}

      {/* 更新词库 Modal */}
      {cleanSite && (() => {
        const totalClean = cleanedEntries.length
        const cleanFrom = cleanPage * pageSize
        const pageClean = cleanedEntries.slice(cleanFrom, cleanFrom + pageSize)
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <div>
                  <h3 className="font-semibold text-gray-900">{cleanSite.domain} · 更新词库</h3>
                  <p className="text-xs text-gray-400 mt-0.5">近30天持续更新的词条，按出现天数排序</p>
                </div>
                <button onClick={() => setCleanSite(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {cleanLoading ? (
                  <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    加载中...
                  </div>
                ) : pageClean.length === 0 ? (
                  <p className="text-center text-gray-400 py-10 text-sm">暂无数据</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {pageClean.map((entry, i) => {
                      const expanded = expandedBases.has(entry.base)
                      return (
                        <div key={i} className="py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-gray-900">{entry.base}</span>
                            <button
                              onClick={() => setExpandedBases((prev) => {
                                const next = new Set(prev)
                                next.has(entry.base) ? next.delete(entry.base) : next.add(entry.base)
                                return next
                              })}
                              className="text-xs text-blue-500 hover:text-blue-700 flex-shrink-0"
                            >
                              {entry.variants.length}条
                            </button>
                          </div>
                          {expanded && (
                            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                              {entry.variants.join('、')}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <PaginationBar
                page={cleanPage}
                total={totalClean}
                pageSize={pageSize}
                onPageChange={(p) => setCleanPage(p)}
                onPageSizeChange={(ps) => { setPageSize(ps); setCleanPage(0) }}
              />
            </div>
          </div>
        )
      })()}

      {/* 排名变动 Modal */}
      {rankSite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-gray-900">{rankSite.domain} · 排名变动</h3>
                <input
                  type="date"
                  value={rankDate}
                  max={getMalaysiaDate(0)}
                  onChange={(e) => handleRankDateChange(e.target.value)}
                  className="text-sm border border-gray-200 rounded px-2 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
              <div className="flex items-center gap-2">
                {role !== 'normal' && (
                  <button
                    onClick={triggerRankCrawl}
                    disabled={rankCrawling}
                    className="text-xs text-gray-400 hover:text-purple-600 px-2 py-1 rounded hover:bg-purple-50 transition-colors disabled:opacity-40"
                  >
                    {rankCrawling ? '抓取中…' : '重抓'}
                  </button>
                )}
                <button onClick={() => setRankSite(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {rankCrawlMsg && (
              <p className={`text-xs px-5 py-1.5 border-b border-gray-100 ${rankCrawlMsg.ok ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50'}`}>
                {rankCrawlMsg.text}
              </p>
            )}
            {/* Tabs */}
            <div className="flex border-b border-gray-200 px-5">
              {(['rankup', 'rankdown'] as const).map((t) => {
                const isActive = rankType === t
                const label = t === 'rankup' ? '涨入' : '跌出'
                const activeClass = t === 'rankup' ? 'border-green-500 text-green-600' : 'border-red-500 text-red-600'
                const count = rankCounts[t]
                return (
                  <button
                    key={t}
                    onClick={() => handleRankTypeChange(t)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors mr-2 ${
                      isActive ? activeClass : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                    {!rankLoading && count > 0 && <span className="ml-1.5 text-xs text-gray-400">({count})</span>}
                  </button>
                )
              })}
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {rankLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm">加载中...</span>
                </div>
              ) : rankPageData.length === 0 ? (
                <p className="text-center text-gray-400 py-16 text-sm">无数据</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-5 py-2.5 text-left font-medium text-gray-500">关键词</th>
                      <th className="px-5 py-2.5 text-right font-medium text-gray-500">搜索量</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rankPageData.map((entry, i) => {
                      const isUnstable = rankUnstableSet.has(entry.keyword)
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className={`px-5 py-2 ${isUnstable ? 'text-red-500 font-medium' : 'text-gray-900'}`}>
                            {entry.keyword}
                          </td>
                          <td className="px-5 py-2 text-right text-gray-600">{entry.volume > 0 ? entry.volume.toLocaleString() : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {/* Pagination */}
            <PaginationBar
              page={rankPage}
              total={rankCounts[rankType]}
              pageSize={pageSize}
              onPageChange={handleRankPageChange}
              onPageSizeChange={handleRankPageSizeChange}
            />
          </div>
        </div>
      )}

      {/* 趋势 Modal */}
      {trendSite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setTrendSite(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">{trendSite.domain} · 新增趋势</h3>
                <p className="text-xs text-gray-400 mt-0.5">近30天每日新增关键词数量</p>
              </div>
              <button onClick={() => setTrendSite(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="mt-4">
              {trendSite.trend.length < 2 ? (
                <p className="text-sm text-gray-400 text-center py-8">暂无趋势数据</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendSite.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={45} />
                    <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v)} />
                    <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>工作日均值参考：<span className="font-semibold text-gray-800">{trendSite.weekdayBaseline.toLocaleString()}</span></span>
              <span>周末均值参考：<span className="font-semibold text-gray-800">{trendSite.weekendBaseline.toLocaleString()}</span></span>
              <span>昨日新增：<span className="font-semibold text-gray-800">{trendSite.yesterday.toLocaleString()}</span></span>
            </div>
          </div>
        </div>
      )}

      {/* 不稳定词 Modal */}
      {unstableSite && (() => {
        const totalUnstable = unstableData.length
        const unstableFrom = unstablePage * pageSize
        const pageUnstable = unstableData.slice(unstableFrom, unstableFrom + pageSize)
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <div>
                  <h3 className="font-semibold text-gray-900">{unstableSite.domain} · 不稳定词</h3>
                  <p className="text-xs text-gray-400 mt-0.5">近30天在涨入和跌出均出现过的词，按波动天数排序</p>
                </div>
                <button onClick={() => setUnstableSite(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {unstableLoading ? (
                  <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-sm">加载中...</span>
                  </div>
                ) : pageUnstable.length === 0 ? (
                  <p className="text-center text-gray-400 py-16 text-sm">暂无不稳定词（需积累多天数据）</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-5 py-2.5 text-left font-medium text-gray-500">关键词</th>
                        <th className="px-4 py-2.5 text-right font-medium text-gray-500">搜索量</th>
                        <th className="px-4 py-2.5 text-right font-medium text-green-600">涨入天</th>
                        <th className="px-4 py-2.5 text-right font-medium text-red-500">跌出天</th>
                        <th className="px-4 py-2.5 text-right font-medium text-gray-500">波动天</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pageUnstable.map((entry, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-5 py-2 text-gray-900">{entry.keyword}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{entry.volume > 0 ? entry.volume.toLocaleString() : '-'}</td>
                          <td className="px-4 py-2 text-right text-green-600 font-medium">{entry.upDays}</td>
                          <td className="px-4 py-2 text-right text-red-500 font-medium">{entry.downDays}</td>
                          <td className="px-4 py-2 text-right text-gray-700 font-bold">{entry.totalDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <PaginationBar
                page={unstablePage}
                total={totalUnstable}
                pageSize={pageSize}
                onPageChange={(p) => setUnstablePage(p)}
                onPageSizeChange={(ps) => { setPageSize(ps); setUnstablePage(0) }}
              />
            </div>
          </div>
        )
      })()}
    </div>
  )
}
