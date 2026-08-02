'use client'

import { useEffect, useState, useMemo } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { buildGroupMaps } from '@/lib/company-groups'

// ── Interfaces ────────────────────────────────────────────────────────────────

interface WordEntry {
  keyword: string; count: number; siteCount: number; sites: string[]
  last_date: string; first_date: string
}
interface RankEntry {
  keyword: string; siteCount: number; volume: number; sites: string[]
  last_date: string; first_date: string; rankDays: number
}
interface CrossEntry {
  keyword: string; dims: string[]; volume: number | null
  newSites: string[]; rankSites: string[]; sites: string[]
  last_date: string; first_date: string
}
interface StreakEntry {
  keyword: string; streak: number; domain: string; volume: number
  last_date: string; first_date: string
}
interface StreakGrouped {
  keyword: string; streak: number; domains: string[]; volume: number
  last_date: string; first_date: string
}
interface VolumeRisingEntry { keyword: string; volume: number; prevVolume: number | null; change: number; last_date: string }
interface RadarData { newWords: WordEntry[]; rankWords: RankEntry[]; streakWords: StreakEntry[]; volumeRisingWords: VolumeRisingEntry[] }
interface WeightInfo { pc: number; mobile: number; pcChg: number; mobileChg: number }
interface DetailRow  { date: string; domain: string }

type Tab      = 'cross' | 'volumeRising' | 'new' | 'rank' | 'streak' | 'wordLib'
type PageSize = 50 | 100 | 500
const PAGE_SIZES: PageSize[] = [50, 100, 500]

// ── Pure helpers ──────────────────────────────────────────────────────────────

function getMYDate(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

type Badge = 'new' | 'updated' | null

// 今日 = first_date 是今天/昨天（刚进入此 tab）；更新 = 旧词有新活动
function getBadge(first_date: string, last_date: string, yesterday: string): Badge {
  if (!last_date || last_date < yesterday) return null
  if (first_date >= yesterday) return 'new'
  return 'updated'
}

// 连续上涨词：streak==2 刚达到门槛→今日；streak>2 持续上涨→更新
function getStreakBadge(streak: number, last_date: string, yesterday: string): Badge {
  if (!last_date || last_date < yesterday) return null
  return streak <= 2 ? 'new' : 'updated'
}

function badgePriority(first_date: string, last_date: string, yesterday: string): number {
  if (!last_date || last_date < yesterday) return 2
  if (first_date >= yesterday) return 0
  return 1
}

function sortByDate<T extends { last_date: string; first_date: string }>(
  list: T[], yesterday: string, secondary: (a: T, b: T) => number
): T[] {
  return [...list].sort((a, b) => {
    if (a.last_date !== b.last_date) return b.last_date.localeCompare(a.last_date)
    const bp = badgePriority(a.first_date, a.last_date, yesterday) - badgePriority(b.first_date, b.last_date, yesterday)
    if (bp !== 0) return bp
    return secondary(a, b)
  })
}

function fmtDate(d: string): string {
  if (!d) return '—'
  return d.slice(5).replace('-', '/')
}

function fmtVolume(v: number): string {
  if (v <= 0) return '—'
  return v.toLocaleString()
}

// ── Small components ──────────────────────────────────────────────────────────

const DIM_LABELS: Record<string, { label: string; cls: string }> = {
  new:  { label: '新增', cls: 'bg-blue-50 text-blue-600' },
  rank: { label: '涨排', cls: 'bg-orange-50 text-orange-600' },
}

function BadgeChip({ badge }: { badge: Badge }) {
  if (!badge) return null
  if (badge === 'new')
    return <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold bg-green-500 text-white leading-none">今日</span>
  return <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold bg-amber-400 text-white leading-none">更新</span>
}

function DateCell({ last_date, today, yesterday, badge, includeYesterday }: {
  last_date: string; today: string; yesterday: string; badge: Badge; includeYesterday?: boolean
}) {
  const isRecent = last_date === today || (includeYesterday && last_date === yesterday)
  return (
    <td className="table-td whitespace-nowrap w-24">
      <div className={`flex items-center gap-1 flex-wrap ${isRecent ? 'text-green-600' : 'text-gray-400'}`}>
        <span className={`text-xs ${isRecent ? 'font-semibold' : ''}`}>{fmtDate(last_date)}</span>
        <BadgeChip badge={badge} />
      </div>
    </td>
  )
}

function DetailDateList({ byDate, weightMap, colorMap }: {
  byDate: [string, string[]][]
  weightMap: Map<string, WeightInfo>
  colorMap: Map<string, string>
}) {
  return (
    <div className="space-y-2">
      {byDate.map(([date, domains]) => (
        <div key={date} className="flex items-start gap-2">
          <span className="text-xs text-gray-400 w-10 flex-shrink-0 pt-1.5">{date.slice(5)}</span>
          <div className="flex flex-wrap gap-1">
            {domains.map(d => (
              <SiteBadge key={d} domain={d} weight={weightMap.get(d)} borderColor={colorMap.get(d)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PaginationBar({ page, total, pageSize, onPageChange }: {
  page: number; total: number; pageSize: PageSize; onPageChange: (p: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-1 px-4 py-2.5 border-t border-gray-100 text-xs">
      <button disabled={page === 0} onClick={() => onPageChange(0)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100">«</button>
      <button disabled={page === 0} onClick={() => onPageChange(page - 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100">‹</button>
      <span className="px-2 text-gray-500">{page + 1} / {totalPages}</span>
      <button disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100">›</button>
      <button disabled={page >= totalPages - 1} onClick={() => onPageChange(totalPages - 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100">»</button>
    </div>
  )
}

// ── SiteBadge / SiteBadges ────────────────────────────────────────────────────

function SiteBadge({ domain, weight, borderColor }: {
  domain: string; weight?: WeightInfo; borderColor?: string
}) {
  return (
    <span
      className="inline-flex flex-col text-xs bg-gray-100 rounded px-1.5 py-1 min-w-0 flex-shrink-0"
      style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
    >
      <span className="text-gray-700 truncate max-w-[130px]">{domain}</span>
      {weight && (
        <span className="text-[10px] flex items-center gap-1 mt-px">
          <span className="text-gray-400">PC</span>
          <span className="text-gray-600 font-medium">{weight.pc}</span>
          {weight.pcChg !== 0 && <span className={weight.pcChg > 0 ? 'text-green-500' : 'text-red-500'}>{weight.pcChg > 0 ? '↑' : '↓'}</span>}
          <span className="text-gray-300">·</span>
          <span className="text-gray-400">M</span>
          <span className="text-gray-600 font-medium">{weight.mobile}</span>
          {weight.mobileChg !== 0 && <span className={weight.mobileChg > 0 ? 'text-green-500' : 'text-red-500'}>{weight.mobileChg > 0 ? '↑' : '↓'}</span>}
        </span>
      )}
    </span>
  )
}

function sortSitesByWeight(sites: string[], weightMap: Map<string, WeightInfo>, idMap: Map<string, number>): string[] {
  const score = (d: string) => { const w = weightMap.get(d); return w ? (w.pc + w.mobile) / 2 : -1 }
  const groupMax = new Map<number, number>()
  for (const d of sites) {
    const gid = idMap.get(d)
    if (gid !== undefined) {
      const s = score(d)
      if (!groupMax.has(gid) || s > groupMax.get(gid)!) groupMax.set(gid, s)
    }
  }
  return [...sites].sort((a, b) => {
    const gidA = idMap.get(a), gidB = idMap.get(b)
    const anchorA = gidA !== undefined ? (groupMax.get(gidA) ?? score(a)) : score(a)
    const anchorB = gidB !== undefined ? (groupMax.get(gidB) ?? score(b)) : score(b)
    if (anchorA !== anchorB) return anchorB - anchorA
    if (gidA !== gidB) return (gidA ?? 999999) - (gidB ?? 999999)
    return score(b) - score(a)
  })
}

function SiteBadges({ sites, weightMap, idMap, colorMap }: {
  sites: string[]; weightMap: Map<string, WeightInfo>
  idMap: Map<string, number>; colorMap: Map<string, string>
}) {
  const sorted = useMemo(() => sortSitesByWeight(sites, weightMap, idMap), [sites, weightMap, idMap])
  return (
    <div className="flex gap-1 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'thin' }}>
      {sorted.map((d) => (
        <SiteBadge key={d} domain={d} weight={weightMap.get(d)} borderColor={colorMap.get(d)} />
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TAB_CONFIG: { key: Tab; label: string }[] = [
  { key: 'volumeRising', label: '搜索量上涨' },
  { key: 'cross',   label: '交叉词' },
  { key: 'rank',    label: '竞品涨排名' },
  { key: 'streak',  label: '连续上涨词' },
  { key: 'new',     label: '共新增词' },
  { key: 'wordLib', label: '更新词库' },
]

export default function HotRadarPage() {
  const [data, setData]           = useState<RadarData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('volumeRising')
  const [minSites, setMinSites]   = useState(1)
  const [minStreak, setMinStreak] = useState(2)
  const [filterSite, setFilterSite]       = useState('')
  const [filterKeyword, setFilterKeyword] = useState('')
  const [page, setPage]         = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(50)
  const [weightMap, setWeightMap]     = useState<Map<string, WeightInfo>>(new Map())
  const [siteIdMap, setSiteIdMap]     = useState<Map<string, string>>(new Map())
  const [groupIdMap, setGroupIdMap]   = useState<Map<string, number>>(new Map())
  const [groupColorMap, setGroupColorMap] = useState<Map<string, string>>(new Map())
  const [copied, setCopied]           = useState(false)
  const [detailKw, setDetailKw]       = useState<string | null>(null)
  const [detailNewRows, setDetailNewRows]   = useState<DetailRow[]>([])
  const [detailRankRows, setDetailRankRows] = useState<DetailRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [wordLibSiteKws, setWordLibSiteKws] = useState<{domain: string; keywords: string[]}[]>([])
  const [wordLibData, setWordLibData] = useState<(WordEntry & { longTailCount: number })[]>([])
  const [wordLibLoading, setWordLibLoading] = useState(false)
  const [wordLibLoaded, setWordLibLoaded] = useState(false)
  const [sortCol, setSortCol]           = useState('')
  const [sortDir, setSortDir]           = useState<'asc'|'desc'|''>('')
  const [wordLibMinSites, setWordLibMinSites] = useState(1)

  const today     = useMemo(() => getMYDate(),    [])
  const yesterday = useMemo(() => getMYDate(-1),  [])

  // ── Fetch ────────────────────────────────────────────────────────────────

  async function fetchWeights() {
    const db = getBrowserClient()
    const d14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
    const [{ data: siteRows }, { data: whRows }] = await Promise.all([
      db.from('sites').select('id, domain, friend_links'),
      db.from('weight_history').select('site_id, record_date, pc_weight, mobile_weight')
        .gte('record_date', d14).order('record_date'),
    ])
    const sites = (siteRows || []) as { id: string; domain: string; friend_links?: string[] | null }[]
    const idToDomain = new Map(sites.map(s => [s.id, s.domain]))
    setSiteIdMap(idToDomain)

    const { idMap, colorMap } = buildGroupMaps(sites)
    setGroupIdMap(idMap)
    setGroupColorMap(colorMap)

    const byId = new Map<string, { pc: number; mobile: number }[]>()
    for (const r of ((whRows || []) as { site_id: string; pc_weight: number; mobile_weight: number }[])) {
      if (!byId.has(r.site_id)) byId.set(r.site_id, [])
      byId.get(r.site_id)!.push({ pc: r.pc_weight, mobile: r.mobile_weight })
    }
    const map = new Map<string, WeightInfo>()
    for (const [sid, recs] of Array.from(byId.entries())) {
      const domain = idToDomain.get(sid)
      if (!domain) continue
      const latest = recs[recs.length - 1]
      const prev   = recs.length >= 2 ? recs[recs.length - 2] : null
      map.set(domain, {
        pc: latest.pc, mobile: latest.mobile,
        pcChg: prev ? latest.pc - prev.pc : 0,
        mobileChg: prev ? latest.mobile - prev.mobile : 0,
      })
    }
    setWeightMap(map)
  }

  function dedupDetailRows(rows: DetailRow[]): DetailRow[] {
    const seen = new Set<string>()
    return rows
      .filter(r => { const k = `${r.date}|${r.domain}`; if (seen.has(k)) return false; seen.add(k); return true })
      .sort((a, b) => b.date.localeCompare(a.date) || a.domain.localeCompare(b.domain))
  }

  async function openDetail(keyword: string) {
    setDetailKw(keyword)
    setDetailLoading(true)
    setDetailNewRows([])
    setDetailRankRows([])
    setWordLibSiteKws([])
    const db = getBrowserClient()

    if (activeTab === 'wordLib') {
      const wordEntry = wordLibData.find(w => w.keyword === keyword)
      const targetDomains = wordEntry?.sites || []
      const domainToId = new Map(Array.from(siteIdMap.entries()).map(([id, d]) => [d, id]))
      const siteIds = targetDomains.map(d => domainToId.get(d)).filter((id): id is string => !!id)
      try {
        if (siteIds.length > 0) {
          const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: raw } = await (db.from('raw_keywords') as any)
            .select('site_id, keyword')
            .in('site_id', siteIds)
            .like('keyword', `${keyword}%`)
            .gte('discovered_at', since)
          const bySite = new Map<string, Set<string>>()
          for (const r of (raw || [])) {
            const domain = siteIdMap.get(r.site_id)
            if (!domain) continue
            if (!bySite.has(domain)) bySite.set(domain, new Set())
            bySite.get(domain)!.add(r.keyword)
          }
          setWordLibSiteKws(
            Array.from(bySite.entries())
              .map(([domain, kws]) => ({ domain, keywords: Array.from(kws).sort() }))
              .sort((a, b) => b.keywords.length - a.keywords.length)
          )
        }
      } finally {
        setDetailLoading(false)
      }
      return
    }

    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    try {
      const nRows: DetailRow[] = []
      const rRows: DetailRow[] = []
      if (activeTab === 'new' || activeTab === 'cross') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: raw } = await (db.from('raw_keywords') as any)
          .select('site_id, content_date')
          .eq('keyword', keyword).gte('content_date', since)
          .order('content_date', { ascending: false })
        for (const r of (raw || [])) {
          const domain = siteIdMap.get(r.site_id)
          if (domain) nRows.push({ date: String(r.content_date).slice(0, 10), domain })
        }
      }
      if (activeTab === 'rank' || activeTab === 'streak' || activeTab === 'cross') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: raw } = await (db.from('rank_changes') as any)
          .select('site_id, stat_date')
          .eq('keyword', keyword).eq('type', 'rankup').gte('stat_date', since)
          .order('stat_date', { ascending: false })
        for (const r of (raw || [])) {
          const domain = siteIdMap.get(r.site_id)
          if (domain) rRows.push({ date: String(r.stat_date).slice(0, 10), domain })
        }
      }
      setDetailNewRows(dedupDetailRows(nRows))
      setDetailRankRows(dedupDetailRows(rRows))
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetch('/api/hot-radar')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => setError(e.message || '加载失败'))
      .finally(() => setLoading(false))
    fetchWeights()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== 'wordLib' || wordLibLoaded || wordLibLoading) return
    setWordLibLoading(true)
    fetch('/api/wordlib')
      .then(r => r.json())
      .then(({ data }: { data: Array<{keyword: string; long_tail_count: number; site_count: number; sites: string[]; last_date: string}> | null }) => {
        const t = today
        setWordLibData((data || []).map(r => {
          const last_date = String(r.last_date || '').slice(0, 10)
          return {
            keyword: r.keyword,
            longTailCount: r.long_tail_count,
            count: r.long_tail_count,
            siteCount: r.site_count,
            sites: r.sites || [],
            last_date,
            first_date: last_date === t ? t : '',
          }
        }))
        setWordLibLoaded(true)
      })
      .catch(() => { setWordLibData([]) })
      .finally(() => { setWordLibLoading(false) })
  }, [activeTab, wordLibLoaded, wordLibLoading, today])

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!data) return null
    const nw = data.newWords.filter(w => w.siteCount >= minSites)
    const rw = data.rankWords.filter(w => w.siteCount >= minSites)

    const nwMap = new Map(nw.map(w => [w.keyword, w]))
    const rwMap = new Map(rw.map(w => [w.keyword, w]))
    const allKws = new Set([...Array.from(nwMap.keys()), ...Array.from(rwMap.keys())])

    const cw: CrossEntry[] = Array.from(allKws).map(keyword => {
      const dims: string[] = []
      const sites = new Set<string>()
      let last_date = '', first_date = ''

      const nwe = nwMap.get(keyword)
      if (nwe) {
        dims.push('new')
        nwe.sites.forEach(s => sites.add(s))
        if (nwe.last_date > last_date) last_date = nwe.last_date
        if (!first_date || nwe.first_date < first_date) first_date = nwe.first_date
      }
      const rwe = rwMap.get(keyword)
      if (rwe) {
        dims.push('rank')
        rwe.sites.forEach(s => sites.add(s))
        if (rwe.last_date > last_date) last_date = rwe.last_date
        if (!first_date || rwe.first_date < first_date) first_date = rwe.first_date
      }
      return { keyword, dims, volume: rwe?.volume ?? null, newSites: nwe?.sites || [], rankSites: rwe?.sites || [], sites: Array.from(sites), last_date, first_date }
    }).filter(w => w.dims.length >= 2)

    return {
      newWords:    sortByDate(nw, yesterday, (a, b) => b.count - a.count || b.siteCount - a.siteCount),
      rankWords:   sortByDate(rw, yesterday, (a, b) => b.volume - a.volume || b.siteCount - a.siteCount),
      crossWords:  sortByDate(cw, yesterday, (a, b) => (b.volume ?? 0) - (a.volume ?? 0)),
      streakWords: data.streakWords || [],
      // keyword_volume 没有站点归属，跟其他几类不一样不受 minSites 门槛过滤，
      // 直接按涨幅排序。
      volumeRisingWords: [...(data.volumeRisingWords || [])].sort((a, b) => b.last_date.localeCompare(a.last_date) || b.change - a.change),
    }
  }, [data, minSites, yesterday])

  const filteredStreakWords = useMemo((): StreakGrouped[] => {
    if (!filtered) return []
    const raw = filtered.streakWords.filter(w => w.streak >= minStreak)
    const grouped = new Map<string, StreakGrouped>()
    for (const w of raw) {
      const g = grouped.get(w.keyword)
      if (!g) {
        grouped.set(w.keyword, { keyword: w.keyword, streak: w.streak, domains: [w.domain], volume: w.volume, first_date: w.first_date, last_date: w.last_date })
      } else {
        if (!g.domains.includes(w.domain)) g.domains.push(w.domain)
        if (w.streak > g.streak) g.streak = w.streak
        if (w.volume > g.volume) g.volume = w.volume
        if (w.last_date > g.last_date) g.last_date = w.last_date
        if (!g.first_date || w.first_date < g.first_date) g.first_date = w.first_date
      }
    }
    // 只保留单站点（多站点归竞品涨排名）
    const single = Array.from(grouped.values()).filter(g => g.domains.length === 1)
    return [...single].sort((a, b) => {
      if (a.last_date !== b.last_date) return b.last_date.localeCompare(a.last_date)
      const pa = getStreakBadge(a.streak, a.last_date, yesterday) === 'new' ? 0 : getStreakBadge(a.streak, a.last_date, yesterday) === 'updated' ? 1 : 2
      const pb = getStreakBadge(b.streak, b.last_date, yesterday) === 'new' ? 0 : getStreakBadge(b.streak, b.last_date, yesterday) === 'updated' ? 1 : 2
      if (pa !== pb) return pa - pb
      return b.streak - a.streak || b.volume - a.volume
    })
  }, [filtered, minStreak, yesterday])

  const wordLibFiltered = useMemo(
    () => wordLibData.filter(w => w.siteCount >= wordLibMinSites),
    [wordLibData, wordLibMinSites]
  )

  const baseList = !filtered ? [] :
    activeTab === 'cross'        ? filtered.crossWords        :
    activeTab === 'volumeRising' ? filtered.volumeRisingWords :
    activeTab === 'new'          ? filtered.newWords          :
    activeTab === 'rank'         ? filtered.rankWords         :
    activeTab === 'wordLib'      ? wordLibFiltered            :
    filteredStreakWords

  const activeList = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let list = [...(baseList as any[])]
    if (filterSite.trim()) {
      const fs = filterSite.trim().toLowerCase()
      list = list.filter((w: any) => {
        if ('domains' in w) return w.domains.some((d: string) => d.toLowerCase().includes(fs))
        return w.sites ? w.sites.some((s: string) => s.toLowerCase().includes(fs)) : true
      })
    }
    if (filterKeyword.trim()) {
      const kw = filterKeyword.trim().toLowerCase()
      list = list.filter((w: any) => w.keyword.toLowerCase().includes(kw))
    }
    if (sortCol && sortDir) {
      list.sort((a: any, b: any) => {
        let va: string | number = 0, vb: string | number = 0
        switch (sortCol) {
          case 'date':          va = a.last_date || ''; vb = b.last_date || ''; break
          case 'volume':        va = a.volume ?? 0;     vb = b.volume ?? 0;     break
          case 'count':         va = a.count ?? 0;      vb = b.count ?? 0;      break
          case 'rankDays':      va = a.rankDays ?? 0;   vb = b.rankDays ?? 0;   break
          case 'streak':        va = a.streak ?? 0;     vb = b.streak ?? 0;     break
          case 'change':        va = a.change ?? 0;     vb = b.change ?? 0;     break
          case 'longTailCount': va = a.longTailCount ?? 0; vb = b.longTailCount ?? 0; break
          case 'siteCount':     va = a.siteCount ?? 0;  vb = b.siteCount ?? 0;  break
        }
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va)
        return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
      })
    }
    return list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseList, filterSite, filterKeyword, sortCol, sortDir])

  const pagedList = activeList.slice(page * pageSize, (page + 1) * pageSize)

  function handleTabChange(tab: Tab) { setActiveTab(tab); setPage(0); setSortCol(''); setSortDir('') }

  const sortIcons = (col: string) => {
    const isAsc = sortCol === col && sortDir === 'asc'
    const isDesc = sortCol === col && sortDir === 'desc'
    const toggle = (dir: 'asc' | 'desc') => {
      setSortCol(sortCol === col && sortDir === dir ? '' : col)
      setSortDir(sortCol === col && sortDir === dir ? '' : dir)
      setPage(0)
    }
    return (
      <span className="inline-flex flex-col items-center gap-px select-none ml-0.5">
        <svg onClick={() => toggle('asc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor"
          className={`cursor-pointer ${isAsc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}>
          <path d="M4 0L8 5H0Z"/>
        </svg>
        <svg onClick={() => toggle('desc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor"
          className={`cursor-pointer ${isDesc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}>
          <path d="M4 5L0 0H8Z"/>
        </svg>
      </span>
    )
  }

  function copyKeywords() {
    navigator.clipboard.writeText(activeList.map(w => w.keyword).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function groupByDate(rows: DetailRow[]) {
    const map = new Map<string, string[]>()
    for (const r of rows) {
      if (!map.has(r.date)) map.set(r.date, [])
      if (!map.get(r.date)!.includes(r.domain)) map.get(r.date)!.push(r.domain)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }
  const detailNewByDate  = useMemo(() => groupByDate(detailNewRows),  [detailNewRows])  // eslint-disable-line react-hooks/exhaustive-deps
  const detailRankByDate = useMemo(() => groupByDate(detailRankRows), [detailRankRows]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">热词雷达</h1>
        <p className="text-gray-400 text-sm mt-0.5">近30天多竞品同时关注的词，捕捉趋势机会</p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-2 mb-4">
        {TAB_CONFIG.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-3">
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            聚合中...
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 text-sm">{error}</div>
          </div>
        ) : (
          <>
            {/* Filter bar */}
            <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">站点</span>
                <input type="text" value={filterSite}
                  onChange={e => { setFilterSite(e.target.value); setPage(0) }}
                  placeholder="输入域名..."
                  className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none w-36" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">关键词</span>
                <input type="text" value={filterKeyword}
                  onChange={e => { setFilterKeyword(e.target.value); setPage(0) }}
                  placeholder="搜索..."
                  className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none w-32" />
              </div>
              <div className="flex items-center gap-1.5">
                {activeTab === 'wordLib' ? (
                  <>
                    <span className="text-xs text-gray-400">最少站点数</span>
                    <select value={wordLibMinSites} onChange={e => { setWordLibMinSites(Number(e.target.value)); setPage(0) }}
                      className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                      <option value={1}>1站</option>
                      <option value={2}>2站</option>
                      <option value={3}>3站</option>
                      <option value={4}>4站</option>
                    </select>
                  </>
                ) : activeTab === 'streak' ? (
                  <>
                    <span className="text-xs text-gray-400">最少上涨天数</span>
                    <select value={minStreak} onChange={e => { setMinStreak(Number(e.target.value)); setPage(0) }}
                      className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                      <option value={2}>2天</option>
                      <option value={3}>3天</option>
                      <option value={5}>5天</option>
                      <option value={7}>7天</option>
                    </select>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-gray-400">最少站点数</span>
                    <select value={minSites} onChange={e => { setMinSites(Number(e.target.value)); setPage(0) }}
                      className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                      <option value={2}>2站</option>
                      <option value={3}>3站</option>
                      <option value={4}>4站</option>
                      <option value={5}>5站</option>
                    </select>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={copyKeywords}
                  className={`text-xs px-2.5 py-1 rounded font-medium transition-all duration-200 ${
                    copied ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}>
                  {copied ? '已复制 ✓' : '复制关键词'}
                </button>
                <span className="text-gray-200">|</span>
                <span className="text-xs text-gray-400">每页</span>
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value) as PageSize); setPage(0) }}
                  className="text-xs border border-gray-200 rounded px-1 py-0.5 text-gray-700 focus:outline-none">
                  {PAGE_SIZES.map(s => <option key={s} value={s}>{s} 条</option>)}
                </select>
                <span className="text-xs text-gray-400">共 {activeList.length} 条</span>
              </div>
            </div>

            {/* Tables — 统一列宽：日期 w-24 | 关键词 w-52 | 数字列 w-24 each | 站点 auto | 操作 w-16 */}
            <div className="overflow-x-auto [&_td]:py-2 [&_th]:py-2">

              {/* 交叉词：7列 */}
              {activeTab === 'cross' && (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-24" />
                    <col className="w-56" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col />
                    <col />
                    <col className="w-16" />
                  </colgroup>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="table-th"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
                      <th className="table-th">关键词</th>
                      <th className="table-th text-center whitespace-nowrap">命中维度</th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">搜索量{sortIcons('volume')}</span></th>
                      <th className="table-th whitespace-nowrap">共新增词</th>
                      <th className="table-th whitespace-nowrap">竞品涨排名</th>
                      <th className="table-th text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedList.length === 0 ? (
                      <tr><td colSpan={7} className="table-td text-center text-gray-400 py-10">暂无交叉词数据</td></tr>
                    ) : (
                      (pagedList as CrossEntry[]).map(w => (
                        <tr key={w.keyword} className="hover:bg-gray-50 transition-colors">
                          <DateCell last_date={w.last_date} today={today} yesterday={yesterday} badge={getBadge(w.first_date, w.last_date, yesterday)} />
                          <td className="table-td font-medium text-gray-900 overflow-hidden">
                            <span className="block truncate" title={w.keyword}>{w.keyword}</span>
                          </td>
                          <td className="table-td">
                            <div className="flex justify-center gap-1">
                              {w.dims.map(d => (
                                <span key={d} className={`text-xs px-1.5 py-0.5 rounded font-medium ${DIM_LABELS[d]?.cls}`}>
                                  {DIM_LABELS[d]?.label}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{w.volume != null ? fmtVolume(w.volume) : '—'}</span>
                          </td>
                          <td className="table-td">
                            {w.newSites.length > 0
                              ? <SiteBadges sites={w.newSites} weightMap={weightMap} idMap={groupIdMap} colorMap={groupColorMap} />
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="table-td">
                            {w.rankSites.length > 0
                              ? <SiteBadges sites={w.rankSites} weightMap={weightMap} idMap={groupIdMap} colorMap={groupColorMap} />
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="table-td text-center">
                            <button onClick={() => openDetail(w.keyword)} className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors">查看</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {/* 共新增词：6列 */}
              {activeTab === 'new' && (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-24" />
                    <col className="w-64" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col />
                    <col className="w-16" />
                  </colgroup>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="table-th"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
                      <th className="table-th">关键词</th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">新增次数{sortIcons('count')}</span></th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">站点数{sortIcons('siteCount')}</span></th>
                      <th className="table-th">出现站点</th>
                      <th className="table-th text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedList.length === 0 ? (
                      <tr><td colSpan={6} className="table-td text-center text-gray-400 py-10">暂无数据</td></tr>
                    ) : (
                      (pagedList as WordEntry[]).map(w => (
                        <tr key={w.keyword} className="hover:bg-gray-50 transition-colors">
                          <DateCell last_date={w.last_date} today={today} yesterday={yesterday} badge={getBadge(w.first_date, w.last_date, yesterday)} includeYesterday />
                          <td className="table-td font-medium text-gray-900 overflow-hidden">
                            <span className="block truncate" title={w.keyword}>{w.keyword}</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{w.count}</span>
                            <span className="text-gray-400 text-xs">次</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{w.siteCount}</span>
                            <span className="text-gray-400 text-xs">站</span>
                          </td>
                          <td className="table-td">
                            <SiteBadges sites={w.sites} weightMap={weightMap} idMap={groupIdMap} colorMap={groupColorMap} />
                          </td>
                          <td className="table-td text-center">
                            <button onClick={() => openDetail(w.keyword)} className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors">查看</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {/* 搜索量上涨：keyword_volume 没有站点归属，列比其他tab少 */}
              {activeTab === 'volumeRising' && (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-24" />
                    <col className="w-64" />
                    <col className="w-28" />
                    <col className="w-28" />
                    <col />
                  </colgroup>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="table-th"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
                      <th className="table-th">关键词</th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">涨幅{sortIcons('change')}</span></th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">当前搜索量{sortIcons('volume')}</span></th>
                      <th className="table-th">变化</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedList.length === 0 ? (
                      <tr><td colSpan={5} className="table-td text-center text-gray-400 py-10">暂无搜索量上涨的词</td></tr>
                    ) : (
                      (pagedList as VolumeRisingEntry[]).map(w => (
                        <tr key={w.keyword} className="hover:bg-gray-50 transition-colors">
                          <DateCell last_date={w.last_date} today={today} yesterday={yesterday} badge={null} />
                          <td className="table-td font-medium text-gray-900 overflow-hidden">
                            <span className="block truncate" title={w.keyword}>{w.keyword}</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-green-600">+{fmtVolume(w.change)}</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{fmtVolume(w.volume)}</span>
                          </td>
                          <td className="table-td text-xs text-gray-400">
                            {w.prevVolume != null ? `${w.prevVolume.toLocaleString()} → ${w.volume.toLocaleString()}` : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {/* 竞品涨排名：6列 */}
              {activeTab === 'rank' && (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-24" />
                    <col className="w-64" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col />
                    <col className="w-16" />
                  </colgroup>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="table-th"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
                      <th className="table-th">关键词</th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">涨排次数{sortIcons('rankDays')}</span></th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">搜索量{sortIcons('volume')}</span></th>
                      <th className="table-th">出现站点</th>
                      <th className="table-th text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedList.length === 0 ? (
                      <tr><td colSpan={6} className="table-td text-center text-gray-400 py-10">暂无数据</td></tr>
                    ) : (
                      (pagedList as RankEntry[]).map(w => (
                        <tr key={w.keyword} className="hover:bg-gray-50 transition-colors">
                          <DateCell last_date={w.last_date} today={today} yesterday={yesterday} badge={getBadge(w.first_date, w.last_date, yesterday)} />
                          <td className="table-td font-medium text-gray-900 overflow-hidden">
                            <span className="block truncate" title={w.keyword}>{w.keyword}</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{w.rankDays}</span>
                            <span className="text-gray-400 text-xs">次</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{fmtVolume(w.volume)}</span>
                          </td>
                          <td className="table-td">
                            <SiteBadges sites={w.sites} weightMap={weightMap} idMap={groupIdMap} colorMap={groupColorMap} />
                          </td>
                          <td className="table-td text-center">
                            <button onClick={() => openDetail(w.keyword)} className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors">查看</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {/* 连续上涨词：6列 */}
              {activeTab === 'streak' && (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-24" />
                    <col className="w-64" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col />
                    <col className="w-16" />
                  </colgroup>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="table-th"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
                      <th className="table-th">关键词</th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">上涨天数{sortIcons('streak')}</span></th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">搜索量{sortIcons('volume')}</span></th>
                      <th className="table-th whitespace-nowrap">出现站点</th>
                      <th className="table-th text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedList.length === 0 ? (
                      <tr><td colSpan={6} className="table-td text-center text-gray-400 py-10">暂无连续上涨词</td></tr>
                    ) : (
                      (pagedList as StreakGrouped[]).map(w => (
                        <tr key={w.keyword} className="hover:bg-gray-50 transition-colors">
                          <DateCell last_date={w.last_date} today={today} yesterday={yesterday} badge={getStreakBadge(w.streak, w.last_date, yesterday)} />
                          <td className="table-td font-medium text-gray-900 overflow-hidden">
                            <span className="block truncate" title={w.keyword}>{w.keyword}</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{w.streak}</span>
                            <span className="text-gray-400 text-xs">天</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{fmtVolume(w.volume)}</span>
                          </td>
                          <td className="table-td">
                            <SiteBadges sites={w.domains} weightMap={weightMap} idMap={groupIdMap} colorMap={groupColorMap} />
                          </td>
                          <td className="table-td text-center">
                            <button onClick={() => openDetail(w.keyword)} className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors">查看</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {/* 更新词库：6列 */}
              {activeTab === 'wordLib' && wordLibLoading && (
                <div className="flex items-center justify-center py-16 text-gray-400 gap-3">
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  加载中...
                </div>
              )}
              {activeTab === 'wordLib' && !wordLibLoading && (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-24" />
                    <col className="w-64" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col />
                    <col className="w-16" />
                  </colgroup>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="table-th"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
                      <th className="table-th">关键词</th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">长尾词数{sortIcons('longTailCount')}</span></th>
                      <th className="table-th text-center whitespace-nowrap"><span className="inline-flex items-center justify-center gap-0.5">站点数{sortIcons('siteCount')}</span></th>
                      <th className="table-th">出现站点</th>
                      <th className="table-th text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedList.length === 0 ? (
                      <tr><td colSpan={6} className="table-td text-center text-gray-400 py-10">暂无数据</td></tr>
                    ) : (
                      (pagedList as (WordEntry & { longTailCount: number })[]).map(w => (
                        <tr key={w.keyword} className="hover:bg-gray-50 transition-colors">
                          <DateCell last_date={w.last_date} today={today} yesterday={yesterday} badge={getBadge(w.first_date, w.last_date, yesterday)} includeYesterday />
                          <td className="table-td font-medium text-gray-900 overflow-hidden">
                            <span className="block truncate" title={w.keyword}>{w.keyword}</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{w.longTailCount}</span>
                            <span className="text-gray-400 text-xs">词</span>
                          </td>
                          <td className="table-td text-center">
                            <span className="font-semibold text-gray-900">{w.siteCount}</span>
                            <span className="text-gray-400 text-xs">站</span>
                          </td>
                          <td className="table-td">
                            <SiteBadges sites={w.sites} weightMap={weightMap} idMap={groupIdMap} colorMap={groupColorMap} />
                          </td>
                          <td className="table-td text-center">
                            <button onClick={() => openDetail(w.keyword)} className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors">查看</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

            </div>
            <PaginationBar page={page} total={activeList.length} pageSize={pageSize} onPageChange={setPage} />
          </>
        )}
      </div>

      {/* 查看 Detail Modal */}
      {detailKw && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailKw(null)}>
          <div className={`bg-white rounded-xl shadow-2xl w-full max-h-[80vh] flex flex-col ${activeTab === 'cross' ? 'max-w-3xl' : 'max-w-lg'}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">{detailKw}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {activeTab === 'wordLib' ? '近30天长尾词分布' : '近30天出现记录'}
                </p>
              </div>
              <button onClick={() => setDetailKw(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  加载中...
                </div>
              ) : activeTab === 'wordLib' ? (
                /* 更新词库：按站点分组显示长尾词 */
                wordLibSiteKws.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-10">暂无记录</p>
                ) : (
                  <div className="space-y-4">
                    {wordLibSiteKws.map(({ domain, keywords }) => (
                      <div key={domain}>
                        <div className="mb-2">
                          <SiteBadge domain={domain} weight={weightMap.get(domain)} borderColor={groupColorMap.get(domain)} />
                        </div>
                        <div className="flex flex-wrap gap-1 ml-1">
                          {keywords.map(kw => (
                            <span key={kw} className="text-xs bg-gray-100 rounded px-1.5 py-1 text-gray-700">{kw}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : activeTab === 'cross' ? (
                /* 交叉词：左右两栏 */
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-blue-600 mb-2 pb-1 border-b border-blue-100">共新增词</p>
                    {detailNewByDate.length === 0
                      ? <p className="text-xs text-gray-400">暂无记录</p>
                      : <DetailDateList byDate={detailNewByDate} weightMap={weightMap} colorMap={groupColorMap} />}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-orange-500 mb-2 pb-1 border-b border-orange-100">竞品涨排名</p>
                    {detailRankByDate.length === 0
                      ? <p className="text-xs text-gray-400">暂无记录</p>
                      : <DetailDateList byDate={detailRankByDate} weightMap={weightMap} colorMap={groupColorMap} />}
                  </div>
                </div>
              ) : (
                /* 其他 tab：单栏 */
                (() => {
                  const byDate = activeTab === 'new' ? detailNewByDate : detailRankByDate
                  return byDate.length === 0
                    ? <p className="text-sm text-gray-400 text-center py-10">暂无记录</p>
                    : <DetailDateList byDate={byDate} weightMap={weightMap} colorMap={groupColorMap} />
                })()
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
