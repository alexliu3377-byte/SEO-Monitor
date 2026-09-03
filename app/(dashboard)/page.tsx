'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { type ReactNode } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { useUser } from '@/lib/user-context'
import { isKeywordExportOwner } from '@/lib/kw-export-owner'
import { computeIndexStatus } from '@/lib/index-status'
import { computeKwStatus } from '@/lib/kw-status'
import { fetchAllRows } from '@/lib/supabase-paginate'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = 'large' | 'medium' | 'small'

interface Site { id: string; domain: string; name: string; category: Category }
interface IndexSnap { site_id: string; snapshot_date: string; index_count: number }
interface WeightRec {
  site_id: string
  record_date: string
  pc_weight: number
  mobile_weight: number
  pc_ip: number
  pc_ip_max: number
  mobile_ip: number
  mobile_ip_max: number
}
interface KwStatRow { site_id: string; stat_date: string; app_count: number; game_count: number }
interface WeightChangeItem { site_id: string; domain: string; pcChange: number; mobileChange: number; date: string }
interface AlertItem { site_id: string; domain: string; status: 'warning' | 'high'; date: string }
interface IndexAlertItem { site_id: string; domain: string; status: 'danger' | 'warning' | 'rising'; date: string }
interface WeightModalExtra {
  appKw: { keyword: string }[]
  gameKw: { keyword: string }[]
  appCount: number; gameCount: number; kwDate: string
  rankupAll: { keyword: string; volume: number }[]
  rankdownAll: { keyword: string; volume: number }[]
  rankupCount: number; rankdownCount: number
  rankDate: string
  unstableAll: { keyword: string; volume: number; upDays: number; downDays: number }[]
  loading: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CAT_LABEL: Record<Category, string> = { large: '大站', medium: '中站', small: '小站' }

// Color palette for multiple sites
const SITE_COLORS = [
  '#22c55e', '#3b82f6', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#f59e0b', '#ef4444',
]

function niceMax(rawMax: number): number {
  if (rawMax <= 0) return 100
  const exp = Math.pow(10, Math.floor(Math.log10(rawMax)))
  const n = rawMax / exp
  const nice = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 7.5 ? 7.5 : 10
  return nice * exp
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMY(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000)
    .toISOString()
    .slice(0, 10)
}

type CsvSheet = { name: string; rows: Record<string, unknown>[] }

function createCsvWorkbookApi() {
  const escapeCell = (value: unknown) => {
    const text = value == null ? '' : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return {
    utils: {
      book_new: () => ({ sheets: [] as CsvSheet[] }),
      json_to_sheet: (rows: Record<string, unknown>[]) => rows,
      book_append_sheet: (book: { sheets: CsvSheet[] }, rows: Record<string, unknown>[], name: string) => {
        book.sheets.push({ name, rows })
      },
    },
    write: (book: { sheets: CsvSheet[] }, _options?: unknown) => {
      const headers = [...new Set(book.sheets.flatMap(sheet => sheet.rows.flatMap(row => Object.keys(row))))]
      const lines = [
        ['日期', ...headers].map(escapeCell).join(','),
        ...book.sheets.flatMap(sheet => sheet.rows.map(row =>
          [sheet.name, ...headers.map(header => row[header])].map(escapeCell).join(',')
        )),
      ]
      const encoded = new TextEncoder().encode(lines.join('\r\n'))
      const withBom = new Uint8Array(encoded.length + 3)
      withBom.set([0xef, 0xbb, 0xbf])
      withBom.set(encoded, 3)
      return withBom
    },
  }
}


function fmtNum(n: number): string {
  if (n >= 10000) {
    const w = n / 10000
    return (w % 1 === 0 ? w.toFixed(0) : w.toFixed(1)) + 'w'
  }
  return n.toLocaleString()
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { role, accessibleSiteIds } = useUser()
  const [sites, setSites] = useState<Site[]>([])
  const [indexSnaps, setIndexSnaps] = useState<IndexSnap[]>([])
  const [weightRecs, setWeightRecs] = useState<WeightRec[]>([])
  const [weightChanges, setWeightChanges] = useState<WeightChangeItem[]>([])
  const [indexAlerts, setIndexAlerts] = useState<IndexAlertItem[]>([])
  const [kwAlerts, setKwAlerts] = useState<AlertItem[]>([])
  const [kwStatsAll, setKwStatsAll] = useState<KwStatRow[]>([])
  const [kwModalSite, setKwModalSite] = useState<AlertItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 图表日期范围——2026-08-14 从预设"当月/近3个月/全年"改成自定义起止日期。
  // 默认一个月，用户可以自己选，配合下面 load() 里按 chartFrom 动态限定查询
  // 起点（不再固定拉365/90天全量），避免 weight_history/index_snapshots 这类
  // 永久保留、持续增长的表撞上 Supabase 单次查询3000行硬顶（见
  // project_supabase_row_limit_hard_cap 记忆，这两张表当时验证过365天和90天
  // 窗口行数完全一样，说明表本身历史还没攒够90天就已经超过3000行了，缩小
  // 固定天数窗口治标不治本，只有绑定到用户实际选的范围才能长期稳定）。
  const [chartFrom, setChartFrom] = useState(getMY(-30))
  const [chartTo, setChartTo] = useState(getMY())
  const [activeCategory, setActiveCategory] = useState<Category>('large')
  // selected = focused sites; empty = show all
  const [selected, setSelected] = useState<Record<Category, string[]>>({
    large: [], medium: [], small: [],
  })
  const [weightModalSite, setWeightModalSite] = useState<WeightChangeItem | null>(null)
  const [weightModalTab, setWeightModalTab] = useState<'weight' | 'ip' | 'index' | 'keywords' | 'rank' | 'unstable'>('weight')
  const [weightModalExtra, setWeightModalExtra] = useState<WeightModalExtra | null>(null)
  const [weightModalKwTab, setWeightModalKwTab] = useState<'app' | 'game'>('app')
  const [weightModalRankTab, setWeightModalRankTab] = useState<'up' | 'down'>('up')
  const [indexModalSite, setIndexModalSite] = useState<IndexAlertItem | null>(null)

  useEffect(() => { load() }, [chartFrom])  // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const db = getBrowserClient()
      const yesterday = getMY(-1)
      const d28 = getMY(-30)
      const d30 = getMY(-30)
      // 2026-08-13/14：weight_history/index_snapshots 之前固定拉365天（后来试过
      // 缩到90天）全站数据，都会撞上 Supabase/PostgREST 单次查询3000行硬顶——
      // 验证过这两张表当时90天和365天查出来的行数完全一样（都是3098/3099行），
      // 说明表本身历史都还没攒够90天就已经超标，缩固定天数窗口治标不治本。
      // 改成查询起点跟着用户在图表上选的 chartFrom 走（不再是写死的天数）：
      // 权重变动/收录变动这两个提醒卡片只需要最近8天算日环比，所以起点取
      // "chartFrom 和 8天前哪个更晚"——用户选的范围比8天短时，起点兜底不早于
      // 8天前，保证提醒卡片一直有数据算；用户选得比8天长时，起点跟着 chartFrom
      // 走。配合图表控件那边的最大跨度限制（见下方 maxChartSpanDays），单次查询
      // 行数可以一直稳定压在3000以下，不用管站点数字以后涨到多少。
      const d8 = getMY(-8)
      const rangeFrom = chartFrom < d8 ? chartFrom : d8

      const [
        { data: sitesRaw },
        { data: snapsRaw },
        { data: wrecsRaw },
        { data: kwStatsRaw },
      ] = await Promise.all([
        db.from('sites').select('id, domain, name, category'),
        db.from('index_snapshots')
          .select('site_id, snapshot_date, index_count')
          .gte('snapshot_date', rangeFrom)
          .order('snapshot_date'),
        db.from('weight_history')
          .select('site_id, record_date, pc_weight, mobile_weight, pc_ip, pc_ip_max, mobile_ip, mobile_ip_max')
          .gte('record_date', rangeFrom)
          .order('record_date'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db.from('competitor_kw_stats') as any)
          .select('site_id, stat_date, app_count, game_count')
          .gte('stat_date', d28)
          .lte('stat_date', yesterday),
      ])

      const rawList = (sitesRaw || []) as Site[]
      const siteList = accessibleSiteIds
        ? rawList.filter(s => accessibleSiteIds.includes(s.id))
        : rawList
      setSites(siteList)
      setIndexSnaps((snapsRaw || []) as IndexSnap[])
      setWeightRecs((wrecsRaw || []) as WeightRec[])

      // Weight change alerts: check every record in the last 7 days vs its predecessor
      const wChanges: WeightChangeItem[] = []
      const d7ago = getMY(-7)
      for (const s of siteList) {
        const siteRecs = ((wrecsRaw || []) as WeightRec[])
          .filter(r => r.site_id === s.id)
          .sort((a, b) => a.record_date.localeCompare(b.record_date))
        if (siteRecs.length < 2) continue
        for (let idx = 1; idx < siteRecs.length; idx++) {
          const rec = siteRecs[idx]
          if (rec.record_date <= d7ago) continue
          const prev = siteRecs[idx - 1]
          const pc = rec.pc_weight - prev.pc_weight
          const mo = rec.mobile_weight - prev.mobile_weight
          if (pc !== 0 || mo !== 0)
            wChanges.push({ site_id: s.id, domain: s.domain, pcChange: pc, mobileChange: mo, date: rec.record_date })
        }
      }
      wChanges.sort((a, b) => b.date.localeCompare(a.date))
      setWeightChanges(wChanges.slice(0, 50))

      // Index alerts: check each snapshot in the last 7 days against its historical water level
      const iAlerts: IndexAlertItem[] = []
      for (const s of siteList) {
        const siteSnaps = ((snapsRaw || []) as IndexSnap[])
          .filter(r => r.site_id === s.id && r.snapshot_date >= d30)
          .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
        const recentSnaps = siteSnaps.filter(r => r.snapshot_date > d7ago)
        for (const snap of recentSnaps) {
          const snapsUpTo = siteSnaps.filter(r => r.snapshot_date <= snap.snapshot_date)
          const status = computeIndexStatus(snapsUpTo)
          if (status !== 'normal')
            iAlerts.push({ site_id: s.id, domain: s.domain, status, date: snap.snapshot_date })
        }
      }
      iAlerts.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        const order = { danger: 0, warning: 1, rising: 2 }
        return order[a.status] - order[b.status]
      })
      setIndexAlerts(iAlerts.slice(0, 50))

      const kwStats = (kwStatsRaw || []) as KwStatRow[]
      setKwStatsAll(kwStats)
      const kAlerts: AlertItem[] = []
      for (const s of siteList) {
        const ss = kwStats.filter(r => r.site_id === s.id)
        if (ss.length === 0) continue
        for (let i = 1; i <= 7; i++) {
          const checkDate = getMY(-i)
          const status = computeKwStatus(ss, checkDate)
          // 2026-08-17 曾经只保留偏低（"不在乎新增变动，只想看异常"），当天
          // 又反悔要把偏高加回来——两个都要提醒。真正用来控制"信息太多"的是
          // lib/kw-status.ts 的 SPREAD_MULTIPLIER（阈值本身，同一天已经从
          // 2.5调到4）和这里的7天回看窗口，不是靠砍掉某一档状态。
          if (status !== 'normal') kAlerts.push({ site_id: s.id, domain: s.domain, status, date: checkDate })
        }
      }
      kAlerts.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        const order = { warning: 0, high: 1 }
        return order[a.status] - order[b.status]
      })
      setKwAlerts(kAlerts.slice(0, 50))

      const firstCat = (['large', 'medium', 'small'] as Category[]).find(
        c => siteList.some(s => s.category === c)
      )
      if (firstCat) setActiveCategory(firstCat)

    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const catSites = useMemo<Record<Category, Site[]>>(() => {
    const r: Record<Category, Site[]> = { large: [], medium: [], small: [] }
    for (const s of sites) r[s.category].push(s)
    return r
  }, [sites])

  const siteMap = useMemo(() => new Map(sites.map(s => [s.id, s])), [sites])

  // Latest pc/mobile weight per site (weightRecs sorted asc, so last write wins)
  const latestWeightMap = useMemo(() => {
    const map = new Map<string, { pc: number; mobile: number }>()
    for (const r of weightRecs) map.set(r.site_id, { pc: r.pc_weight, mobile: r.mobile_weight })
    return map
  }, [weightRecs])

  // Color index by site within category
  function siteColor(cat: Category, siteId: string): string {
    const idx = catSites[cat].findIndex(s => s.id === siteId)
    return SITE_COLORS[idx % SITE_COLORS.length]
  }

  // 图表最多能选多宽的日期范围——按当前站点数反推，保证单次查询行数稳定
  // 压在 Supabase 3000行硬顶以下（每个站点每天最多1行，2800是留了200行余量）。
  // 站点数以后涨了这个上限会自动跟着收紧，不用再手动改数字。
  const maxChartSpanDays = sites.length > 0 ? Math.max(7, Math.floor(2800 / sites.length)) : 30

  function addDays(dateStr: string, days: number): string {
    return new Date(new Date(dateStr + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10)
  }

  function handleChartFromChange(v: string) {
    setChartFrom(v)
    if (v > chartTo) setChartTo(v)
    else if (addDays(v, maxChartSpanDays) < chartTo) setChartTo(addDays(v, maxChartSpanDays))
  }

  function handleChartToChange(v: string) {
    setChartTo(v)
    if (v < chartFrom) setChartFrom(v)
    else if (addDays(v, -maxChartSpanDays) > chartFrom) setChartFrom(addDays(v, -maxChartSpanDays))
  }

  function toggleSite(siteId: string) {
    setSelected(prev => {
      const cur = prev[activeCategory]
      const next = cur.includes(siteId) ? cur.filter(id => id !== siteId) : [...cur, siteId]
      return { ...prev, [activeCategory]: next }
    })
  }

  function getIndexData(ids: string[]) {
    const filtered = indexSnaps.filter(r => r.snapshot_date >= chartFrom && r.snapshot_date <= chartTo && ids.includes(r.site_id))
    const map = new Map<string, Record<string, number>>()
    for (const r of filtered) {
      if (!map.has(r.snapshot_date)) map.set(r.snapshot_date, {})
      map.get(r.snapshot_date)![r.site_id] = r.index_count
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }))
  }

  function getMobileIPData(ids: string[]) {
    const filtered = weightRecs.filter(r => r.record_date >= chartFrom && r.record_date <= chartTo && ids.includes(r.site_id))
    const map = new Map<string, Record<string, number>>()
    for (const r of filtered) {
      const avg = Math.round(((r.mobile_ip ?? 0) + (r.mobile_ip_max ?? 0)) / 2)
      if (avg === 0) continue
      if (!map.has(r.record_date)) map.set(r.record_date, {})
      map.get(r.record_date)![r.site_id] = avg
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }))
  }

  async function fetchWeightModalExtra(siteId: string) {
    setWeightModalExtra({ appKw: [], gameKw: [], appCount: 0, gameCount: 0, kwDate: '', rankupAll: [], rankdownAll: [], rankupCount: 0, rankdownCount: 0, rankDate: '', unstableAll: [], loading: true })
    const db = getBrowserClient()
    const d30ago = getMY(-30)
    const [{ data: appRaw }, { data: gameRaw }, { data: rdRaw }] = await Promise.all([
      db.from('raw_keywords').select('keyword,content_date').eq('site_id', siteId)
        .or('content_type.eq.app,content_type.is.null').not('keyword', 'like', '%电脑版%')
        .order('content_date', { ascending: false }).limit(200),
      db.from('raw_keywords').select('keyword,content_date').eq('site_id', siteId)
        .eq('content_type', 'game').not('keyword', 'like', '%电脑版%')
        .order('content_date', { ascending: false }).limit(200),
      (async () => ({ data: await fetchAllRows<{ id: string; keyword: string; volume: number; type: string; stat_date: string }>((from, to) => db
        .from('rank_changes').select('id,keyword,volume,type,stat_date')
        .eq('site_id', siteId).gte('stat_date', d30ago)
        .order('stat_date', { ascending: false }).order('id', { ascending: true }).range(from, to)) }))(),
    ])
    type KwRaw = { keyword: string; content_date: string }
    const latestAppDate = (appRaw || []).length > 0 ? (appRaw![0] as KwRaw).content_date : ''
    const latestGameDate = (gameRaw || []).length > 0 ? (gameRaw![0] as KwRaw).content_date : ''
    const latestKwDate = [latestAppDate, latestGameDate].filter(Boolean).sort().reverse()[0] || ''
    const appAll = ((appRaw || []) as KwRaw[]).filter(k => k.content_date === latestKwDate).map(k => ({ keyword: k.keyword }))
    const gameAll = ((gameRaw || []) as KwRaw[]).filter(k => k.content_date === latestKwDate).map(k => ({ keyword: k.keyword }))
    type RD = { keyword: string; volume: number; type: string; stat_date: string }
    const rdArr = (rdRaw || []) as RD[]
    const latestRankDate = rdArr.length > 0 ? rdArr[0].stat_date : ''
    let rankupAll: { keyword: string; volume: number }[] = []
    let rankdownAll: { keyword: string; volume: number }[] = []
    if (latestRankDate) {
      const today = rdArr.filter(r => r.stat_date === latestRankDate)
      rankupAll = today.filter(r => r.type === 'rankup').map(r => ({ keyword: r.keyword, volume: r.volume })).sort((a, b) => b.volume - a.volume)
      rankdownAll = today.filter(r => r.type === 'rankdown').map(r => ({ keyword: r.keyword, volume: r.volume })).sort((a, b) => b.volume - a.volume)
    }
    const upMap = new Map<string, number>()
    const downMap = new Map<string, number>()
    const volMap = new Map<string, number[]>()
    for (const r of rdArr) {
      if (r.type === 'rankup') upMap.set(r.keyword, (upMap.get(r.keyword) ?? 0) + 1)
      else downMap.set(r.keyword, (downMap.get(r.keyword) ?? 0) + 1)
      if (r.volume > 0) {
        if (!volMap.has(r.keyword)) volMap.set(r.keyword, [])
        volMap.get(r.keyword)!.push(r.volume)
      }
    }
    const unstableAll: { keyword: string; volume: number; upDays: number; downDays: number }[] = []
    for (const [kw, upDays] of Array.from(upMap.entries())) {
      const downDays = downMap.get(kw) ?? 0
      if (downDays > 0 && upDays + downDays >= 3) {
        const vols = volMap.get(kw) || []
        const volume = vols.length > 0 ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : 0
        unstableAll.push({ keyword: kw, volume, upDays, downDays })
      }
    }
    unstableAll.sort((a, b) => b.volume - a.volume || (b.upDays + b.downDays) - (a.upDays + a.downDays))
    setWeightModalExtra({
      appKw: appAll.slice(0, 12), gameKw: gameAll.slice(0, 12),
      appCount: appAll.length, gameCount: gameAll.length, kwDate: latestKwDate,
      rankupAll: rankupAll.slice(0, 12), rankdownAll: rankdownAll.slice(0, 12),
      rankupCount: rankupAll.length, rankdownCount: rankdownAll.length,
      rankDate: latestRankDate, unstableAll: unstableAll.slice(0, 12), loading: false,
    })
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          加载中...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 text-sm">{error}</div>
      </div>
    )
  }

  const today = getMY()
  const activeSelected = selected[activeCategory]

  return (
    <>
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">首页快报</h1>
        <p className="text-gray-500 text-sm mt-1">{today} · 今日数据汇总</p>
      </div>

      {/* ── Alert Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">

        <AlertCard title="权重变动" count={weightChanges.length} badgeCount={weightChanges.filter(w => w.date === getMY()).length} color="red" empty="暂无权重变动">
          {weightChanges.map((w, i) => {
            const isRecent = w.date === getMY()
            return (
              <button key={i} onClick={() => { setWeightModalSite(w); setWeightModalTab('weight'); setWeightModalKwTab('app'); setWeightModalRankTab('up'); fetchWeightModalExtra(w.site_id) }} className="w-full flex items-center justify-between gap-2 py-0.5 hover:bg-red-50 rounded px-1 -mx-1 transition-colors text-left">
                <p className="text-xs truncate">
                  <span className={isRecent ? 'text-red-500 font-medium' : 'text-gray-400'}>{w.date.slice(5)}</span>
                  <span className="text-gray-400"> · </span>
                  <span className="font-medium text-gray-800">{w.domain}</span>
                </p>
                <div className="flex gap-1.5 flex-shrink-0">
                  {w.pcChange !== 0 && (
                    <span className={`text-xs font-semibold ${w.pcChange > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      PC {w.pcChange > 0 ? '+' : ''}{w.pcChange}
                    </span>
                  )}
                  {w.mobileChange !== 0 && (
                    <span className={`text-xs font-semibold ${w.mobileChange > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      m {w.mobileChange > 0 ? '+' : ''}{w.mobileChange}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </AlertCard>

        <AlertCard
          title="收录变动"
          count={indexAlerts.length}
          color="orange"
          empty="各站收录正常"
          action={
            <div className="flex items-center gap-1.5">
              {role === 'super' && <RankupExportButton />}
              {role === 'super' && <span className="text-gray-200 select-none">|</span>}
              {role === 'super' && <RankdownExportButton />}
            </div>
          }
        >
          {indexAlerts.map((a, i) => {
            const isRecent = a.date === getMY()
            return (
            <button key={i} onClick={() => setIndexModalSite(a)} className={`w-full flex items-center justify-between gap-2 py-0.5 rounded px-1 -mx-1 transition-colors text-left ${
              a.status === 'danger' ? 'hover:bg-red-50' :
              a.status === 'warning' ? 'hover:bg-yellow-50' :
              'hover:bg-blue-50'
            }`}>
              <p className="text-xs truncate">
                <span className={isRecent ? 'text-orange-500 font-medium' : 'text-gray-400'}>{a.date.slice(5)}</span>
                <span className="text-gray-400"> · </span>
                <span className="font-medium text-gray-800">{a.domain}</span>
              </p>
              <span className={`text-xs px-1.5 rounded font-medium flex-shrink-0 ${
                a.status === 'danger' ? 'bg-red-50 text-red-500' :
                a.status === 'warning' ? 'bg-yellow-50 text-yellow-600' :
                'bg-blue-50 text-blue-600'
              }`}>
                {a.status === 'danger' ? '危险' : a.status === 'warning' ? '下跌' : '涨入'}
              </span>
            </button>
            )
          })}
        </AlertCard>

        <AlertCard
          title="新增变动"
          count={kwAlerts.length}
          badgeCount={kwAlerts.filter(a => a.date === getMY(-1)).length}
          color="yellow"
          empty="各站新增正常"
        >
          {kwAlerts.map((a, i) => {
            const isRecent = a.date === getMY(-1)
            return (
              <button key={i} onClick={() => setKwModalSite(a)} className="w-full flex items-center justify-between gap-2 py-0.5 rounded px-1 -mx-1 hover:bg-yellow-50 transition-colors text-left">
                <p className="text-xs truncate">
                  <span className={isRecent ? 'text-yellow-500 font-medium' : 'text-gray-400'}>{a.date.slice(5)}</span>
                  <span className="text-gray-400"> · </span>
                  <span className="font-medium text-gray-800">{a.domain}</span>
                </p>
                <span className={`text-xs px-1.5 rounded font-medium flex-shrink-0 ${
                  a.status === 'warning' ? 'bg-yellow-50 text-yellow-600' :
                  'bg-blue-50 text-blue-600'
                }`}>
                  {a.status === 'warning' ? '偏低' : '偏高'}
                </span>
              </button>
            )
          })}
        </AlertCard>

        <KeywordSearchCard />

      </div>

      {/* ── Charts Section ──────────────────────────────────────────────── */}
      <div className="card">

        {/* Header: category tabs + time range */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-4 border-b border-gray-100">
          <div className="flex gap-1">
            {(['large', 'medium', 'small'] as Category[]).map(cat => {
              const has = catSites[cat].length > 0
              return (
                <button
                  key={cat}
                  onClick={() => has && setActiveCategory(cat)}
                  disabled={!has}
                  className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                    activeCategory === cat
                      ? 'bg-green-500 text-white'
                      : has
                        ? 'text-gray-500 hover:bg-gray-100'
                        : 'text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {CAT_LABEL[cat]}
                </button>
              )
            })}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <input aria-label="选择日期"
                type="date"
                value={chartFrom}
                max={chartTo}
                onChange={e => handleChartFromChange(e.target.value)}
                className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none"
              />
              <span className="text-xs text-gray-400">至</span>
              <input aria-label="选择日期"
                type="date"
                value={chartTo}
                min={chartFrom}
                max={getMY()}
                onChange={e => handleChartToChange(e.target.value)}
                className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-gray-400">最多可选 {maxChartSpanDays} 天范围，超过会自动收窄——避免单次查询数据量太大被平台截断</p>
          </div>
        </div>

        <div className="p-5 space-y-4">

          {/* Site grouped pills，每组下面各自跟一对图表——2026-08-18 用户
              反馈站点一多，所有站点混在同一对图表里线条太密看不清，改成
              a-m/n-z/0-9 三组各自独立一对图表，只画自己组内的站点。 */}
          {catSites[activeCategory].length === 0 ? (
            <p className="text-sm text-gray-400">该分类暂无站点，请在网站管理中设置分类</p>
          ) : (
            <div className="space-y-6">
              {activeSelected.length > 0 && (
                <button
                  onClick={() => setSelected(prev => ({ ...prev, [activeCategory]: [] }))}
                  className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
                >
                  全部
                </button>
              )}
              {([
                { label: 'a–m', test: (d: string) => /^[a-m]/i.test(d) },
                { label: 'n–z', test: (d: string) => /^[n-z]/i.test(d) },
                { label: '0–9', test: (d: string) => /^\d/.test(d) },
              ]).map(g => {
                const groupSites = catSites[activeCategory]
                  .filter(s => g.test(s.domain))
                  .sort((a, b) => a.domain.localeCompare(b.domain))
                if (groupSites.length === 0) return null
                const groupIds = groupSites.map(s => s.id)
                // 选了具体站点时，这组图表只画"被选中的站点里属于这组的那些"
                // ——没选任何站点（默认全选）时，这组图表画组内全部站点。
                const groupActiveIds = activeSelected.length > 0
                  ? groupIds.filter(id => activeSelected.includes(id))
                  : groupIds
                return (
                  <div key={g.label} className="space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-gray-400 font-mono w-8 flex-shrink-0 pt-1.5">{g.label}</span>
                      <div className="w-px self-stretch bg-gray-200 flex-shrink-0" />
                      <div className="flex flex-wrap gap-2">
                        {groupSites.map(s => {
                          const color = siteColor(activeCategory, s.id)
                          const isActive = activeSelected.length === 0 || activeSelected.includes(s.id)
                          const w = latestWeightMap.get(s.id)
                          return (
                            <button
                              key={s.id}
                              onClick={() => toggleSite(s.id)}
                              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                activeSelected.includes(s.id)
                                  ? 'border-transparent text-white font-medium'
                                  : activeSelected.length > 0
                                    ? 'border-gray-200 text-gray-400 hover:text-gray-600'
                                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                              }`}
                              style={activeSelected.includes(s.id) ? { backgroundColor: color } : {}}
                            >
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: isActive ? color : '#d1d5db' }}
                              />
                              <span className="flex flex-col items-start leading-tight">
                                <span>{s.domain}</span>
                                {w && (
                                  <span className={`text-[10px] ${activeSelected.includes(s.id) ? 'text-white/70' : 'text-gray-400'}`}>
                                    PC{w.pc} · M{w.mobile}
                                  </span>
                                )}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {groupActiveIds.length > 0 && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pl-11">
                        <div>
                          <p className="text-sm font-semibold text-gray-600 mb-3">收录趋势</p>
                          <CompareChart
                            key={activeCategory + g.label + '-index'}
                            data={getIndexData(groupActiveIds)}
                            siteIds={groupActiveIds}
                            colorMap={Object.fromEntries(groupActiveIds.map(id => [id, siteColor(activeCategory, id)]))}
                            siteMap={siteMap}
                            yFormatter={fmtNum}
                          />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-600 mb-3">移动 IP 均值趋势</p>
                          <CompareChart
                            key={activeCategory + g.label + '-mobile'}
                            data={getMobileIPData(groupActiveIds)}
                            siteIds={groupActiveIds}
                            colorMap={Object.fromEntries(groupActiveIds.map(id => [id, siteColor(activeCategory, id)]))}
                            siteMap={siteMap}
                            yFormatter={fmtNum}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

        </div>
      </div>

    </div>

    {/* ── 权重变动详情 Modal ─────────────────────────────────────────────── */}
    {weightModalSite && (() => {
      const siteRecs = weightRecs
        .filter(r => r.site_id === weightModalSite.site_id)
        .sort((a, b) => a.record_date.localeCompare(b.record_date))
      const latest = siteRecs.length > 0 ? siteRecs[siteRecs.length - 1] : null
      const prev = siteRecs.length > 1 ? siteRecs[siteRecs.length - 2] : null
      const pcAvgChange = prev ? Math.round((latest!.pc_ip + latest!.pc_ip_max) / 2) - Math.round((prev.pc_ip + prev.pc_ip_max) / 2) : 0
      const mobileAvgChange = prev ? Math.round((latest!.mobile_ip + latest!.mobile_ip_max) / 2) - Math.round((prev.mobile_ip + prev.mobile_ip_max) / 2) : 0
      const siteSnaps = indexSnaps.filter(s => s.site_id === weightModalSite.site_id).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      const latestSnap = siteSnaps.length > 0 ? siteSnaps[siteSnaps.length - 1] : null
      const prevSnap = siteSnaps.length > 1 ? siteSnaps[siteSnaps.length - 2] : null
      const indexChange = (latestSnap && prevSnap) ? latestSnap.index_count - prevSnap.index_count : 0
      const weightTrend = siteRecs.map(r => ({ date: r.record_date.slice(5), pc: r.pc_weight, mobile: r.mobile_weight }))
      const ipTrend = siteRecs.map(r => ({ date: r.record_date.slice(5), pcAvg: Math.round((r.pc_ip + r.pc_ip_max) / 2), mobileAvg: Math.round((r.mobile_ip + r.mobile_ip_max) / 2) }))
      const indexTrend = siteSnaps.map(s => ({ date: s.snapshot_date.slice(5), count: s.index_count }))
      const fmt = (n: number) => n >= 10000 ? (n / 10000).toFixed(1).replace('.0', '') + 'w' : n.toLocaleString()
      const chg = (v: number) => v === 0 ? null : <span className={`text-xs font-medium ${v > 0 ? 'text-green-600' : 'text-red-500'}`}>{v > 0 ? '+' : ''}{v >= 1000 || v <= -1000 ? fmt(v) : v}</span>
      const tiles = [
        { label: 'PC权重',   value: String(latest?.pc_weight ?? 0),                                                chg: weightModalSite.pcChange },
        { label: '移动权重', value: String(latest?.mobile_weight ?? 0),                                            chg: weightModalSite.mobileChange },
        { label: 'PC日均IP', value: latest ? `${fmt(latest.pc_ip)}~${fmt(latest.pc_ip_max)}` : '-',               chg: pcAvgChange },
        { label: '移动IP',   value: latest ? `${fmt(latest.mobile_ip)}~${fmt(latest.mobile_ip_max)}` : '-',       chg: mobileAvgChange },
        { label: '收录量',   value: latestSnap ? latestSnap.index_count.toLocaleString() : '-',                   chg: indexChange },
      ]
      const TAB_LABELS: Record<string, string> = { weight: '权重趋势', ip: 'IP趋势', index: '收录趋势', keywords: '最近新增', rank: '排名波动', unstable: '不稳定词' }
      const noData = <div className="flex items-center justify-center h-44 text-gray-400 text-sm">暂无足够趋势数据</div>
      const loadingEl = <div className="flex items-center justify-center h-44 text-gray-400 text-sm">加载中…</div>
      const kwList = weightModalKwTab === 'app' ? (weightModalExtra?.appKw ?? []) : (weightModalExtra?.gameKw ?? [])
      const rankList = weightModalRankTab === 'up' ? (weightModalExtra?.rankupAll ?? []) : (weightModalExtra?.rankdownAll ?? [])
      return (
        <div role="dialog" aria-modal="true" aria-label="站点权重详情" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setWeightModalSite(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-bold text-gray-900">{weightModalSite.domain}</h2>
              <button type="button" aria-label="关闭权重详情" onClick={() => setWeightModalSite(null)} className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            {/* 5 compact metric tiles */}
            <div className="grid grid-cols-5 gap-2 px-6 py-4 flex-shrink-0">
              {tiles.map(m => (
                <div key={m.label} className="bg-gray-50 rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-xs text-gray-400 truncate">{m.label}</span>
                    {chg(m.chg)}
                  </div>
                  <p className="text-sm font-bold text-gray-900 tabular-nums leading-tight">{m.value}</p>
                </div>
              ))}
            </div>
            {/* 6 Tabs */}
            <div className="flex gap-0.5 px-6 border-b border-gray-100 flex-shrink-0">
              {(['weight', 'ip', 'index', 'keywords', 'rank', 'unstable'] as const).map(t => (
                <button key={t} onClick={() => setWeightModalTab(t)}
                  className={`px-2.5 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${weightModalTab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>
            {/* Tab content */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              {weightModalTab === 'weight' && (
                weightTrend.length >= 2 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={weightTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11 }} width={30} />
                        <Tooltip formatter={(v: unknown) => String(v)} />
                        <Line type="monotone" dataKey="pc" name="PC权重" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                        <Line type="monotone" dataKey="mobile" name="移动权重" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block" />PC权重</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-orange-500 inline-block" />移动权重</span>
                    </div>
                  </>
                ) : noData
              )}
              {weightModalTab === 'ip' && (
                ipTrend.length >= 2 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={ipTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11 }} width={50} tickFormatter={(v: number) => v >= 10000 ? (v / 10000).toFixed(1) + 'w' : v.toLocaleString()} />
                        <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v)} />
                        <Line type="monotone" dataKey="pcAvg" name="PC均值" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                        <Line type="monotone" dataKey="mobileAvg" name="移动均值" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block" />PC均值</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-orange-500 inline-block" />移动均值</span>
                    </div>
                  </>
                ) : noData
              )}
              {weightModalTab === 'index' && (
                indexTrend.length >= 2 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={indexTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={(v: number) => v >= 10000 ? (v / 10000).toFixed(1) + 'w' : v.toLocaleString()} />
                        <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v)} />
                        <Line type="monotone" dataKey="count" name="百度收录" stroke="#22c55e" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-green-500 inline-block" />百度收录</span>
                    </div>
                  </>
                ) : noData
              )}
              {weightModalTab === 'keywords' && (
                weightModalExtra?.loading ? loadingEl : (
                  <>
                    <div className="flex items-center gap-1.5 mb-3">
                      <button onClick={() => setWeightModalKwTab('app')}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${weightModalKwTab === 'app' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                        应用{weightModalKwTab === 'app' && weightModalExtra ? ` (${weightModalExtra.appCount})` : ''}
                      </button>
                      <button onClick={() => setWeightModalKwTab('game')}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${weightModalKwTab === 'game' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                        游戏{weightModalKwTab === 'game' && weightModalExtra ? ` (${weightModalExtra.gameCount})` : ''}
                      </button>
                      {weightModalExtra?.kwDate && <span className="ml-auto text-xs text-gray-400">{weightModalExtra.kwDate}</span>}
                    </div>
                    {kwList.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">暂无数据</div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0 space-y-1.5">
                          {kwList.slice(0, 6).map((k, i) => (
                            <div key={i} className="h-6 flex items-center text-xs text-gray-800 truncate">{k.keyword}</div>
                          ))}
                        </div>
                        {kwList.length > 6 && (
                          <div className="flex-1 min-w-0 space-y-1.5">
                            {kwList.slice(6, 12).map((k, i) => (
                              <div key={i + 6} className="h-6 flex items-center text-xs text-gray-800 truncate">{k.keyword}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )
              )}
              {weightModalTab === 'rank' && (
                weightModalExtra?.loading ? loadingEl : (
                  <>
                    <div className="flex items-center gap-1.5 mb-3">
                      <button onClick={() => setWeightModalRankTab('up')}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${weightModalRankTab === 'up' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                        涨入{weightModalExtra ? ` (${weightModalExtra.rankupCount})` : ''}
                      </button>
                      <button onClick={() => setWeightModalRankTab('down')}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${weightModalRankTab === 'down' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                        跌出{weightModalExtra ? ` (${weightModalExtra.rankdownCount})` : ''}
                      </button>
                      {weightModalExtra?.rankDate && <span className="ml-auto text-xs text-gray-400">{weightModalExtra.rankDate}</span>}
                    </div>
                    {rankList.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">暂无数据</div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0 space-y-1.5">
                          {rankList.slice(0, 6).map((r, i) => (
                            <div key={i} className="h-6 flex items-center gap-1.5 text-xs">
                              <span className="text-gray-800 flex-1 truncate">{r.keyword}</span>
                              {r.volume > 0 && <span className="text-gray-400 flex-shrink-0">{r.volume.toLocaleString()}</span>}
                            </div>
                          ))}
                        </div>
                        {rankList.length > 6 && (
                          <div className="flex-1 min-w-0 space-y-1.5">
                            {rankList.slice(6, 12).map((r, i) => (
                              <div key={i + 6} className="h-6 flex items-center gap-1.5 text-xs">
                                <span className="text-gray-800 flex-1 truncate">{r.keyword}</span>
                                {r.volume > 0 && <span className="text-gray-400 flex-shrink-0">{r.volume.toLocaleString()}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )
              )}
              {weightModalTab === 'unstable' && (
                weightModalExtra?.loading ? loadingEl : (
                  (weightModalExtra?.unstableAll ?? []).length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-gray-400 text-sm">近30天无反复波动词</div>
                  ) : (
                    <div className="flex gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {(weightModalExtra?.unstableAll ?? []).slice(0, 6).map((u, i) => (
                          <div key={i} className="h-6 flex items-center gap-1.5 text-xs">
                            <span className="text-gray-800 flex-1 truncate">{u.keyword}</span>
                            <span className="text-green-600 flex-shrink-0">↑{u.upDays}</span>
                            <span className="text-red-500 flex-shrink-0">↓{u.downDays}</span>
                          </div>
                        ))}
                      </div>
                      {(weightModalExtra?.unstableAll ?? []).length > 6 && (
                        <div className="flex-1 min-w-0 space-y-1.5">
                          {(weightModalExtra?.unstableAll ?? []).slice(6, 12).map((u, i) => (
                            <div key={i + 6} className="h-6 flex items-center gap-1.5 text-xs">
                              <span className="text-gray-800 flex-1 truncate">{u.keyword}</span>
                              <span className="text-green-600 flex-shrink-0">↑{u.upDays}</span>
                              <span className="text-red-500 flex-shrink-0">↓{u.downDays}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )
              )}
            </div>
          </div>
        </div>
      )
    })()}

    {/* ── 新增异常详情 Modal ─────────────────────────────────────────────── */}
    {kwModalSite && (() => {
      const targetDate = kwModalSite.date
      const ss = kwStatsAll.filter(r => r.site_id === kwModalSite.site_id)
      const trend = ss
        .map(r => ({ date: (r.stat_date ?? '').slice(5), count: (r.app_count ?? 0) + (r.game_count ?? 0) }))
        .filter(p => p.date)
        .sort((a, b) => a.date.localeCompare(b.date))
      const targetStat = ss.find(r => (r.stat_date ?? '').slice(0, 10) === targetDate)
      const targetVal = (targetStat?.app_count ?? 0) + (targetStat?.game_count ?? 0)
      const weekdayVals: number[] = [], weekendVals: number[] = []
      for (const r of ss) {
        const d = (r.stat_date ?? '').slice(0, 10)
        if (!d || d === targetDate) continue
        const dow = new Date(d).getDay()
        const v = (r.app_count ?? 0) + (r.game_count ?? 0)
        if (dow === 0 || dow === 6) weekendVals.push(v)
        else weekdayVals.push(v)
      }
      const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
      return (
        <div role="dialog" aria-modal="true" aria-label="关键词详情" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setKwModalSite(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">{kwModalSite.domain} · 新增趋势</h3>
                <p className="text-xs text-gray-400 mt-0.5">近30天每日新增关键词数量</p>
              </div>
              <button type="button" aria-label="关闭关键词详情" onClick={() => setKwModalSite(null)} className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700 text-lg leading-none">×</button>
            </div>
            <div className="mt-4">
              {trend.length < 2 ? (
                <p className="text-sm text-gray-400 text-center py-8">暂无趋势数据</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trend}>
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
              <span>工作日均值参考：<span className="font-semibold text-gray-800">{avg(weekdayVals).toLocaleString()}</span></span>
              <span>周末均值参考：<span className="font-semibold text-gray-800">{avg(weekendVals).toLocaleString()}</span></span>
              <span>{targetDate.slice(5)} 新增：<span className="font-semibold text-gray-800">{targetVal.toLocaleString()}</span></span>
            </div>
          </div>
        </div>
      )
    })()}

    {/* ── 收录异常详情 Modal ─────────────────────────────────────────────── */}
    {indexModalSite && (() => {
      const d30 = getMY(-30)
      const siteSnaps = indexSnaps
        .filter(r => r.site_id === indexModalSite.site_id && r.snapshot_date >= d30)
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      const allSnaps = indexSnaps
        .filter(r => r.site_id === indexModalSite.site_id)
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      const trend = siteSnaps.map(s => ({ date: s.snapshot_date.slice(5), count: s.index_count }))
      const latest = allSnaps.length > 0 ? allSnaps[allSnaps.length - 1].index_count : 0
      const snap7 = [...allSnaps].reverse().find(r => r.snapshot_date <= getMY(-7))
      const weeklyChange = snap7 ? latest - snap7.index_count : 0
      return (
        <div role="dialog" aria-modal="true" aria-label="收录详情" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIndexModalSite(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">{indexModalSite.domain} · 收录趋势</h3>
                <p className="text-xs text-gray-400 mt-0.5">近30天百度收录变化</p>
              </div>
              <button type="button" aria-label="关闭收录详情" onClick={() => setIndexModalSite(null)} className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="p-6">
              <div className="flex gap-6 mb-4 items-end">
                <div>
                  <span className="text-xs text-gray-400">当前收录</span>
                  <p className="text-2xl font-bold text-gray-900">{latest.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">周变化</span>
                  <p className={`text-2xl font-bold ${weeklyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {weeklyChange !== 0 ? (weeklyChange >= 0 ? '+' : '') + weeklyChange.toLocaleString() : '-'}
                  </p>
                </div>
              </div>
              {trend.length >= 2 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} width={60} tickFormatter={(v: number) => v >= 10000 ? (v / 10000).toFixed(1) + 'w' : String(v)} />
                    <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v)} />
                    <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">暂无足够趋势数据</div>
              )}
            </div>
          </div>
        </div>
      )
    })()}
    </>
  )
}

// ─── KeywordSearchCard ────────────────────────────────────────────────────────

interface KwVolRow { keyword: string; volume: number; latest_trend?: string | null; volume_change?: number | null }

function KeywordSearchCard() {
  const { role, id } = useUser()
  const isAdmin = role !== 'super'
  const canExport = isKeywordExportOwner(id)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<KwVolRow[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  // Export auth dialog
  const [showDialog, setShowDialog] = useState(false)
  const [exportType, setExportType] = useState<'all' | 'today'>('all')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  async function handleSearch(pg = 0) {
    if (isAdmin && !query.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/keyword-volume?q=${encodeURIComponent(query)}&page=${pg}`)
      const data = await res.json()
      setRows(data.keywords || [])
      setTotal(data.total ?? 0)
      setPage(pg)
      setSearched(true)
    } finally {
      setLoading(false)
    }
  }

  function openExportDialog(type: 'all' | 'today' = 'all') {
    setExportType(type)
    setUsername('')
    setPassword('')
    setVerifyError(null)
    setShowDialog(true)
  }

  async function handleVerifyAndExport() {
    setVerifying(true)
    setVerifyError(null)
    try {
      const verifyRes = await fetch('/api/keyword-volume/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, purpose: 'keyword-volume' }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyRes.ok) {
        setVerifyError(verifyData.error || '验证失败')
        return
      }

      // Credentials valid — proceed with download
      setShowDialog(false)
      const apiUrl = exportType === 'today' ? '/api/keyword-volume?export=today' : '/api/keyword-volume?export=1'
      const res = await fetch(apiUrl)
      const data = await res.json()
      const all: KwVolRow[] = data.keywords || []
      const csv = ['关键词,搜索量', ...all.map(r => `"${r.keyword}",${r.volume}`)].join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const dateStr = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
      a.download = exportType === 'today' ? `keywords-today-${dateStr}.csv` : `keywords-${dateStr}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <div className="rounded-xl border border-green-300 bg-white p-4 flex flex-col h-[272px]">
        <div className="flex items-center justify-between mb-3 flex-shrink-0 h-8">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0 bg-green-400" />
            <span className="text-sm font-medium text-gray-600">搜索量查询</span>
          </div>
          {canExport && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => openExportDialog('today')}
                className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
              >
                导出今日
              </button>
              <span className="text-gray-300 select-none">|</span>
              <button
                onClick={() => openExportDialog('all')}
                className="text-xs text-gray-400 hover:text-green-600 transition-colors"
              >
                导出全部
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-1.5 mb-3 flex-shrink-0">
          <input aria-label="输入内容"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch(0)}
            placeholder="搜索词..."
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={() => handleSearch(0)}
            disabled={loading}
            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {loading ? '...' : '搜索'}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {!searched ? (
            <p className="text-xs text-gray-400">输入关键词后搜索</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-400">未找到「{query}」</p>
          ) : (
            <div className="space-y-0.5">
              {rows.map(r => (
                <div key={r.keyword} className="flex items-center justify-between py-0.5">
                  <span className="text-xs text-gray-700 truncate mr-2">{r.keyword}</span>
                  <span className="text-xs font-medium text-gray-500 flex-shrink-0 tabular-nums flex items-center gap-0.5">
                    {r.volume > 0 ? r.volume.toLocaleString() : '—'}
                    {r.latest_trend === 'rankup' && <span className="text-green-500 leading-none" title="近期排名上升">↑</span>}
                    {r.latest_trend === 'rankdown' && <span className="text-red-400 leading-none" title="近期排名下降">↓</span>}
                    {(r.volume_change ?? 0) > 0 && (
                      <span className="text-green-500 leading-none font-bold cursor-help" title={`搜索量较上次 +${r.volume_change}`}>+</span>
                    )}
                    {(r.volume_change ?? 0) < 0 && (
                      <span className="text-red-400 leading-none font-bold cursor-help" title={`搜索量较上次 ${r.volume_change}`}>−</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {searched && total > 0 && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 flex-shrink-0">
            <button
              onClick={() => handleSearch(page - 1)}
              disabled={page === 0 || loading}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 px-1.5 py-0.5 rounded transition-colors"
            >
              ← 上一页
            </button>
            <span className="text-xs text-gray-400 tabular-nums">
              {page + 1} / {Math.ceil(total / 50)} 页 · 共 {total} 个
            </span>
            <button
              onClick={() => handleSearch(page + 1)}
              disabled={(page + 1) * 50 >= total || loading}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 px-1.5 py-0.5 rounded transition-colors"
            >
              下一页 →
            </button>
          </div>
        )}
      </div>

      {/* Export auth dialog */}
      {showDialog && (
        <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">验证身份</h3>
            <p className="text-xs text-gray-400 mb-5">{exportType === 'today' ? '导出今日新词需要验证账号权限' : '导出全部数据需要验证账号权限'}</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">用户名</label>
                <input aria-label="输入内容"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoFocus
                  placeholder="输入用户名"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">密码</label>
                <input aria-label="输入密码"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleVerifyAndExport()}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              {verifyError && (
                <p className="text-xs text-red-500">{verifyError}</p>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowDialog(false)}
                className="flex-1 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleVerifyAndExport}
                disabled={verifying || !username || !password}
                className="flex-1 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-medium"
              >
                {verifying ? '验证中...' : '确认导出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── RankupExportButton ───────────────────────────────────────────────────────

function RankupExportButton() {
  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'verifying' | 'crawling' | 'done'>('idle')
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function openDialog() {
    setDomain('')
    setStartDate(getMY(-6))
    setEndDate(getMY())
    setUsername('')
    setPassword('')
    setStatus('idle')
    setProgress('')
    setErr(null)
    setOpen(true)
  }

  async function handleStart() {
    if (!domain || !startDate || !endDate) { setErr('请填写网站和日期'); return }

    setStatus('verifying')
    setErr(null)
    const verRes = await fetch('/api/keyword-volume/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, purpose: 'rank-history' }),
    })
    if (!verRes.ok) {
      const d = await verRes.json()
      setErr(d.error || '验证失败')
      setStatus('idle')
      return
    }

    const dates: string[] = []
    let cur = new Date(startDate + 'T12:00:00+08:00')
    const end = new Date(endDate + 'T12:00:00+08:00')
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10))
      cur = new Date(cur.getTime() + 86400000)
    }
    if (dates.length === 0) { setErr('日期范围无效'); setStatus('idle'); return }

    setStatus('crawling')
    const t0 = Date.now()
    const allData: Record<string, { keyword: string; volume: number; title: string }[]> = {}

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      let items: { keyword: string; volume: number; title: string }[] = []

      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          setProgress(`${date} 无数据，第 ${attempt} 次重试（等待 30 秒）...`)
          await new Promise(r => setTimeout(r, 30000))
        } else {
          setProgress(`正在抓取 ${date} (${i + 1}/${dates.length})...`)
        }
        try {
          const res = await fetch(`/api/export-rankup-history?domain=${encodeURIComponent(domain)}&date=${date}`)
          const data = await res.json()
          items = data.items || []
          if (items.length > 0) break
        } catch {
          items = []
        }
      }

      allData[date] = items
      if (i < dates.length - 1) {
        setProgress(`${date} 完成，等待 5 秒...`)
        await new Promise(r => setTimeout(r, 5000))
      }
    }

    setProgress('生成 Excel 文件...')
    const XLSX = createCsvWorkbookApi()
    const wb = XLSX.utils.book_new()
    let totalKw = 0
    for (const [date, items] of Object.entries(allData)) {
      totalKw += items.length
      const rows = items.map(r => ({ 关键词: r.keyword, 搜索量: r.volume, 标题: r.title }))
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 关键词: '', 搜索量: 0, 标题: '无数据' }])
      XLSX.utils.book_append_sheet(wb, ws, date)
    }
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `涨词-${domain}-${startDate}至${endDate}.xlsx`
    a.download = a.download.replace(/\.xlsx$/i, '.csv')
    a.click()
    URL.revokeObjectURL(url)
    fetch('/api/log-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'rankup-export', domain, ok: totalKw, durationMs: Date.now() - t0, summary: `涨词导出 ${domain} ${startDate}至${endDate}，共 ${totalKw} 个词` }),
    }).catch(() => {})
    setStatus('done')
    setProgress('导出完成')
  }

  const busy = status === 'verifying' || status === 'crawling'
  const dayDiff = startDate && endDate
    ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
    : 0
  const rangeExceeds = dayDiff > 6

  return (
    <>
      <button
        onClick={openDialog}
        className="text-xs text-gray-400 hover:text-green-600 transition-colors"
      >
        涨词导出
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">涨词导出</h3>
            <p className="text-xs text-gray-400 mb-4">从爱站抓取指定站点的涨入关键词并导出 Excel</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">网站域名</label>
                <input aria-label="输入内容"
                  type="text"
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  disabled={busy}
                  placeholder="例如 xxx.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">开始日期</label>
                  <input aria-label="选择日期"
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    disabled={busy}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">结束日期</label>
                  <input aria-label="选择日期"
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    disabled={busy}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50"
                  />
                </div>
              </div>
              {rangeExceeds && (
                <p className="text-xs text-red-500">抓取范围超出 7 天（爱站最多保留 7 天数据）</p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">用户名</label>
                <input aria-label="输入内容"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={busy}
                  placeholder="输入用户名"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">密码</label>
                <input aria-label="输入密码"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50"
                />
              </div>

              {err && <p className="text-xs text-red-500">{err}</p>}
              {progress && <p className="text-xs text-blue-500">{progress}</p>}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                {status === 'done' ? '关闭' : '取消'}
              </button>
              {status !== 'done' && (
                <button
                  onClick={handleStart}
                  disabled={busy || !domain || !username || !password || rangeExceeds}
                  className="flex-1 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 font-medium"
                >
                  {status === 'verifying' ? '验证中...' : status === 'crawling' ? '抓取中...' : '开始导出'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── RankdownExportButton ─────────────────────────────────────────────────────

function RankdownExportButton() {
  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'verifying' | 'crawling' | 'done'>('idle')
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function openDialog() {
    setDomain('')
    setStartDate(getMY(-6))
    setEndDate(getMY())
    setUsername('')
    setPassword('')
    setStatus('idle')
    setProgress('')
    setErr(null)
    setOpen(true)
  }

  async function handleStart() {
    if (!domain || !startDate || !endDate) { setErr('请填写网站和日期'); return }

    setStatus('verifying')
    setErr(null)
    const verRes = await fetch('/api/keyword-volume/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, purpose: 'rank-history' }),
    })
    if (!verRes.ok) {
      const d = await verRes.json()
      setErr(d.error || '验证失败')
      setStatus('idle')
      return
    }

    // Build list of dates from start to end
    const dates: string[] = []
    let cur = new Date(startDate + 'T12:00:00+08:00')
    const end = new Date(endDate + 'T12:00:00+08:00')
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10))
      cur = new Date(cur.getTime() + 86400000)
    }
    if (dates.length === 0) { setErr('日期范围无效'); setStatus('idle'); return }

    setStatus('crawling')
    const t0 = Date.now()
    const allData: Record<string, { keyword: string; volume: number; title: string }[]> = {}

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      let items: { keyword: string; volume: number; title: string }[] = []

      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          setProgress(`${date} 无数据，第 ${attempt} 次重试（等待 30 秒）...`)
          await new Promise(r => setTimeout(r, 30000))
        } else {
          setProgress(`正在抓取 ${date} (${i + 1}/${dates.length})...`)
        }
        try {
          const res = await fetch(`/api/export-rank-history?domain=${encodeURIComponent(domain)}&date=${date}`)
          const data = await res.json()
          items = data.items || []
          if (items.length > 0) break
        } catch {
          items = []
        }
      }

      allData[date] = items
      if (i < dates.length - 1) {
        setProgress(`${date} 完成，等待 5 秒...`)
        await new Promise(r => setTimeout(r, 5000))
      }
    }

    setProgress('生成 Excel 文件...')
    const XLSX = createCsvWorkbookApi()
    const wb = XLSX.utils.book_new()
    let totalKw = 0
    for (const [date, items] of Object.entries(allData)) {
      totalKw += items.length
      const rows = items.map(r => ({ 关键词: r.keyword, 搜索量: r.volume, 标题: r.title }))
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 关键词: '', 搜索量: 0, 标题: '无数据' }])
      XLSX.utils.book_append_sheet(wb, ws, date)
    }
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `跌词-${domain}-${startDate}至${endDate}.xlsx`
    a.download = a.download.replace(/\.xlsx$/i, '.csv')
    a.click()
    URL.revokeObjectURL(url)
    fetch('/api/log-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'rankdown-export', domain, ok: totalKw, durationMs: Date.now() - t0, summary: `跌词导出 ${domain} ${startDate}至${endDate}，共 ${totalKw} 个词` }),
    }).catch(() => {})
    setStatus('done')
    setProgress('导出完成')
  }

  const busy = status === 'verifying' || status === 'crawling'
  const dayDiff = startDate && endDate
    ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
    : 0
  const rangeExceeds = dayDiff > 6

  return (
    <>
      <button
        onClick={openDialog}
        className="text-xs text-gray-400 hover:text-red-600 transition-colors"
      >
        跌词导出
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">跌词导出</h3>
            <p className="text-xs text-gray-400 mb-4">从爱站抓取指定站点的跌出关键词并导出 Excel</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">网站域名</label>
                <input aria-label="输入内容"
                  type="text"
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  disabled={busy}
                  placeholder="例如 xxx.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-50"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">开始日期</label>
                  <input aria-label="选择日期"
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    disabled={busy}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-50"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">结束日期</label>
                  <input aria-label="选择日期"
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    disabled={busy}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-50"
                  />
                </div>
              </div>
              {rangeExceeds && (
                <p className="text-xs text-red-500">抓取范围超出 7 天（爱站最多保留 7 天数据）</p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">用户名</label>
                <input aria-label="输入内容"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={busy}
                  placeholder="输入用户名"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">密码</label>
                <input aria-label="输入密码"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-50"
                />
              </div>

              {err && <p className="text-xs text-red-500">{err}</p>}
              {progress && <p className="text-xs text-blue-500">{progress}</p>}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                {status === 'done' ? '关闭' : '取消'}
              </button>
              {status !== 'done' && (
                <button
                  onClick={handleStart}
                  disabled={busy || !domain || !username || !password || rangeExceeds}
                  className="flex-1 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 font-medium"
                >
                  {status === 'verifying' ? '验证中...' : status === 'crawling' ? '抓取中...' : '开始导出'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── AlertCard ────────────────────────────────────────────────────────────────

const PALETTE = {
  yellow: { border: 'border-yellow-300', count: 'text-yellow-500', pulse: 'bg-yellow-400' },
  orange: { border: 'border-orange-300', count: 'text-orange-500', pulse: 'bg-orange-400' },
  red:    { border: 'border-red-300',    count: 'text-red-500',    pulse: 'bg-red-400'    },
  teal:   { border: 'border-teal-300',   count: 'text-teal-500',   pulse: 'bg-teal-400'   },
  green:  { border: 'border-green-300',  count: 'text-green-500',  pulse: 'bg-green-400'  },
  gray:   { border: 'border-gray-200',   count: 'text-gray-300',   pulse: 'bg-gray-300'   },
}

function AlertCard({
  title, count, badgeCount, color, empty, children, action,
}: {
  title: string
  count: number
  // 角标数字默认就是 count（列表总条数）；权重变动/新增变动这两张卡要求角标
  // 只显示某一天（今日/昨日）的数量，不是列表里7天累计的条数——传 badgeCount
  // 单独覆盖显示的数字，count 还是继续控制"有没有内容可展开"这个判断，不然
  // 今天/昨天刚好是0条时，会把本来有数据的整个列表也一起隐藏掉。
  badgeCount?: number
  color: keyof typeof PALETTE
  empty: string
  children: ReactNode
  action?: ReactNode
}) {
  const c = PALETTE[color]
  const isPlaceholder = count < 0
  const hasAlerts = count > 0
  const displayCount = badgeCount ?? count

  return (
    <div className={`rounded-xl border ${c.border} bg-white p-4 flex flex-col h-[272px]`}>
      <div className="flex items-center justify-between mb-3 flex-shrink-0 h-8">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.pulse}`} />
          <span className="text-sm font-medium text-gray-600">{title}</span>
        </div>
        {action ?? (
          <span className={`text-xl font-bold ${c.count}`}>
            {isPlaceholder ? '—' : displayCount}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {isPlaceholder || !hasAlerts ? (
          <p className="text-xs text-gray-400">{empty}</p>
        ) : (
          <div className="h-full overflow-y-auto pr-1">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SortedTooltip ───────────────────────────────────────────────────────────

function SortedTooltip({
  active, payload, label, siteMap, siteIds, colorMap, hoveredId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  active?: boolean; payload?: readonly any[]; label?: string | number
  siteMap: Map<string, Site>
  siteIds?: string[]
  colorMap?: Record<string, string>
  hoveredId?: string | null
}) {
  if (!active || !payload) return null

  // Build value map from payload for quick lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const valueMap = new Map<string, any>()
  for (const p of payload) {
    if (p.name != null) valueMap.set(String(p.name), p)
  }

  // Use siteIds as the definitive order (sorted by value desc, nulls last)
  const ids = siteIds ?? payload.map(p => String(p.name))
  const withData = ids.filter(id => valueMap.get(id)?.value != null).sort((a, b) => (valueMap.get(b)?.value ?? 0) - (valueMap.get(a)?.value ?? 0))
  const noData = ids.filter(id => valueMap.get(id)?.value == null)
  const all = [...withData, ...noData]
  if (all.length === 0) return null

  const cols = all.length <= 8 ? 1 : all.length <= 18 ? 2 : 3
  const perCol = Math.ceil(all.length / cols)
  const chunks = Array.from({ length: cols }, (_, c) => all.slice(c * perCol, (c + 1) * perCol))

  const renderItem = (id: string, i: number) => {
    const p = valueMap.get(id)
    const color = p?.color ?? colorMap?.[id] ?? '#9ca3af'
    const hasValue = p?.value != null
    const isHovered = id === hoveredId
    return (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
        <span style={{ color: hasValue ? '#374151' : '#9ca3af', whiteSpace: 'nowrap', fontWeight: isHovered ? 700 : 400 }}>
          {siteMap.get(id)?.domain ?? id}
          <span style={{ color: '#9ca3af', fontWeight: isHovered ? 700 : 400 }}> : </span>
          {hasValue ? (typeof p.value === 'number' ? p.value.toLocaleString() : p.value) : '—'}
        </span>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>日期：{label}</p>
      <div style={{ display: 'flex', gap: 20 }}>
        {chunks.map((chunk, ci) => (
          <div key={ci}>{chunk.map((id, i) => renderItem(id, i))}</div>
        ))}
      </div>
    </div>
  )
}

// ─── CompareChart ─────────────────────────────────────────────────────────────

function CompareChart({
  data, siteIds, colorMap, siteMap, yFormatter,
}: {
  data: Record<string, string | number>[]
  siteIds: string[]
  colorMap: Record<string, string>
  siteMap: Map<string, Site>
  yFormatter: (v: number) => string
}) {
  const [focusedIds, setFocusedIds] = useState<Set<string>>(new Set())
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const lineClickedRef = useRef(false)
  const siteIdsKey = siteIds.join(',')

  useEffect(() => {
    setFocusedIds(new Set())
    setHoveredId(null)
  }, [siteIdsKey])

  function toggleFocus(id: string) {
    setFocusedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (siteIds.length === 0 || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-44 rounded-lg bg-gray-50 text-gray-400 text-sm">
        {siteIds.length === 0 ? '该分类暂无站点' : '暂无数据'}
      </div>
    )
  }

  let rawMax = 0
  for (const row of data) {
    for (const id of siteIds) {
      const v = row[id]
      if (typeof v === 'number' && v > rawMax) rawMax = v
    }
  }
  const maxVal = niceMax(rawMax)
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round(maxVal * i / 4))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart
        data={data}
        margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
        onClick={() => { if (!lineClickedRef.current) setFocusedIds(new Set()); lineClickedRef.current = false }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          width={46}
          domain={[0, maxVal]}
          ticks={yTicks}
          tickFormatter={(v: number) => yFormatter(v)}
        />
        <Tooltip
          content={(props) => <SortedTooltip {...props} siteMap={siteMap} siteIds={siteIds} colorMap={colorMap} hoveredId={hoveredId} />}
          position={{ x: 5, y: 8 }}
          wrapperStyle={{ pointerEvents: 'none' }}
        />
        {siteIds.map(id => {
          const dimmed = focusedIds.size > 0 && !focusedIds.has(id)
          return (
            <Line
              key={id}
              type="monotone"
              dataKey={id}
              name={id}
              stroke={colorMap[id]}
              strokeWidth={2}
              strokeOpacity={dimmed ? 0.15 : 1}
              connectNulls
              dot={false}
              activeDot={(props: { cx?: number; cy?: number }) => {
                const { cx, cy } = props
                if (cx == null || cy == null) return <g />
                return (
                  <circle
                    cx={cx} cy={cy} r={5}
                    fill={colorMap[id]} stroke="white" strokeWidth={2}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredId(id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={(e) => { e.stopPropagation(); lineClickedRef.current = true; toggleFocus(id) }}
                  />
                )
              }}
              onClick={() => { lineClickedRef.current = true; toggleFocus(id) }}
              onMouseEnter={() => setHoveredId(id)}
              onMouseLeave={() => setHoveredId(null)}
            />
          )
        })}
      </LineChart>
    </ResponsiveContainer>
  )
}
