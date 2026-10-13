'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts'

interface SiteRow {
  id: string
  domain: string
  name: string
  has_rank_title: boolean
}

interface IndexedPageRow {
  id: string
  url: string
  title: string
  first_seen_date: string
  is_new: boolean
  is_reindexed: boolean
  is_disappeared: boolean
}

function fmt(n: number) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace('.0', '') + 'w'
  return n.toLocaleString()
}

function ChangeTag({ change }: { change: number }) {
  if (change === 0) return null
  return (
    <span className={`text-xs font-semibold ${change > 0 ? 'text-green-600' : 'text-red-500'}`}>
      {change > 0 ? `↑${fmt(Math.abs(change))}` : `↓${fmt(Math.abs(change))}`}
    </span>
  )
}

function MetricCard({ label, value, change }: { label: string; value: string; change: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 min-w-0">
      <p className="text-xs text-gray-400 mb-1.5">{label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-bold text-gray-900 tabular-nums">{value}</span>
        <ChangeTag change={change} />
      </div>
    </div>
  )
}

function SectionCard({ title, headerRight, children }: { title: string; headerRight?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {headerRight}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex items-center justify-center h-32 text-sm text-gray-400">{text}</div>
}

type ModalPageSize = 50 | 100 | 500
const MODAL_PAGE_SIZES: ModalPageSize[] = [50, 100, 500]

function PaginationBar({ page, total, pageSize, onPageChange, onPageSizeChange }: {
  page: number; total: number; pageSize: ModalPageSize
  onPageChange: (p: number) => void; onPageSizeChange: (s: ModalPageSize) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between px-5 py-2.5 border-t border-gray-100 bg-gray-50/50 flex-shrink-0 text-xs">
      <div className="flex items-center gap-1.5 text-gray-500">
        每页
        <select aria-label="选择选项" value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value) as ModalPageSize)} className="border border-gray-200 rounded px-1 py-0.5 text-xs">
          {MODAL_PAGE_SIZES.map(s => <option key={s} value={s}>{s} 条</option>)}
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

interface PageData {
  pcWeight: number
  mobileWeight: number
  pcIpMin: number
  pcIpMax: number
  mobileIpMin: number
  mobileIpMax: number
  indexCount: number
  pcWeightChange: number
  mobileWeightChange: number
  pcIpAvgChange: number
  mobileIpAvgChange: number
  indexChange: number
  weightTrend: { date: string; pc: number; mobile: number }[]
  indexTrend: { date: string; count: number }[]
  ipTrend: { date: string; pcAvg: number; mobileAvg: number }[]
  kwDate: string
  appKw: { keyword: string }[]
  gameKw: { keyword: string }[]
  appKwAll: { keyword: string }[]
  gameKwAll: { keyword: string }[]
  appCount: number
  gameCount: number
  rankDate: string
  rankupAll: { keyword: string; volume: number }[]
  rankdownAll: { keyword: string; volume: number }[]
  rankupCount: number
  rankdownCount: number
  unstableAll: { keyword: string; volume: number; upDays: number; downDays: number }[]
  unstableCount: number
}

interface RankOverview {
  rankDate: string | null
  rankup: PageData['rankupAll']; rankdown: PageData['rankdownAll']
  rankupCount: number; rankdownCount: number
  unstable: PageData['unstableAll']; unstableCount: number
}

export default function SiteIntelDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [site, setSite] = useState<SiteRow | null>(null)
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageRequest = useRef<AbortController | null>(null)
  const [modalError, setModalError] = useState('')
  const [indexedPagesError, setIndexedPagesError] = useState('')

  const [indexedPages, setIndexedPages] = useState<IndexedPageRow[]>([])
  const [indexedPagesTotal, setIndexedPagesTotal] = useState(0)
  const [indexedPagesLoading, setIndexedPagesLoading] = useState(true)

  const [kwTab, setKwTab] = useState<'app' | 'game'>('app')
  const [rankTab, setRankTab] = useState<'up' | 'down'>('up')

  const [modalPageSize, setModalPageSize] = useState<ModalPageSize>(50)

  const [kwModal, setKwModal] = useState(false)
  const [kwModalTab, setKwModalTab] = useState<'app' | 'game'>('app')
  const [kwModalPage, setKwModalPage] = useState(0)
  const [rankModal, setRankModal] = useState(false)
  const [rankModalTab, setRankModalTab] = useState<'up' | 'down'>('up')
  const [rankModalPage, setRankModalPage] = useState(0)
  const [unstableModal, setUnstableModal] = useState(false)
  const [unstableModalPage, setUnstableModalPage] = useState(0)

  const [kwModalDate, setKwModalDate] = useState('')
  const [kwModalLoading, setKwModalLoading] = useState(false)
  const [kwModalAppAll, setKwModalAppAll] = useState<{ keyword: string }[]>([])
  const [kwModalGameAll, setKwModalGameAll] = useState<{ keyword: string }[]>([])
  const [kwModalAppCount, setKwModalAppCount] = useState(0)
  const [kwModalGameCount, setKwModalGameCount] = useState(0)
  const [rankModalDate, setRankModalDate] = useState('')
  const [rankModalRows, setRankModalRows] = useState<PageData['rankupAll']>([])
  const [rankModalCounts, setRankModalCounts] = useState({ up: 0, down: 0 })
  const [rankModalLoading, setRankModalLoading] = useState(false)
  const [unstableModalRows, setUnstableModalRows] = useState<PageData['unstableAll']>([])
  const [unstableModalTotal, setUnstableModalTotal] = useState(0)
  const [unstableModalLoading, setUnstableModalLoading] = useState(false)
  const [modalRetry, setModalRetry] = useState(0)

  useEffect(() => {
    if (!id) return
    loadData()
    return () => pageRequest.current?.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function handleKwDateChange(date: string) {
    if (!date || !id) return
    setKwModalDate(date)
    setKwModalPage(0)
  }

  useEffect(() => {
    if (!kwModal || !id || !kwModalDate) return
    const controller = new AbortController()
    setKwModalLoading(true)
    setModalError('')
    async function load() {
      const supabase = getBrowserClient()
      let pageQuery = supabase.from('raw_keywords').select('id, keyword').eq('site_id', id).eq('content_date', kwModalDate).not('keyword', 'like', '%电脑版%')
      pageQuery = kwModalTab === 'game' ? pageQuery.eq('content_type', 'game') : pageQuery.or('content_type.eq.app,content_type.is.null')
      const [pageResult, appCnt, gameCnt] = await Promise.all([
        pageQuery.order('id').range(kwModalPage * modalPageSize, (kwModalPage + 1) * modalPageSize - 1).abortSignal(controller.signal),
        supabase.from('raw_keywords').select('id', { count: 'exact', head: true }).eq('site_id', id).eq('content_date', kwModalDate)
          .or('content_type.eq.app,content_type.is.null').not('keyword', 'like', '%电脑版%'),
        supabase.from('raw_keywords').select('id', { count: 'exact', head: true }).eq('site_id', id).eq('content_date', kwModalDate)
          .eq('content_type', 'game').not('keyword', 'like', '%电脑版%'),
      ])
      for (const response of [pageResult, appCnt, gameCnt]) if (response.error) throw new Error(response.error.message)
      if (controller.signal.aborted) return
      if (kwModalTab === 'app') setKwModalAppAll(pageResult.data ?? [])
      else setKwModalGameAll(pageResult.data ?? [])
      setKwModalAppCount(appCnt.count ?? 0)
      setKwModalGameCount(gameCnt.count ?? 0)
    }
    void load().catch(error => { if (!controller.signal.aborted) setModalError(error instanceof Error ? error.message : '关键词读取失败，请重试') })
      .finally(() => { if (!controller.signal.aborted) setKwModalLoading(false) })
    return () => controller.abort()
  }, [kwModal, id, kwModalDate, kwModalTab, kwModalPage, modalPageSize, modalRetry])

  useEffect(() => {
    if (!rankModal || !site || !rankModalDate) return
    const controller = new AbortController()
    setRankModalLoading(true); setModalError('')
    async function load() {
      const supabase = getBrowserClient()
      const table = site!.has_rank_title ? 'site_keyword_ranks' : 'rank_changes'
      const query = (countOnly: boolean) => {
        let result = countOnly ? supabase.from(table).select('id', { count: 'exact', head: true }) : supabase.from(table).select('id, keyword, volume')
        result = result.eq('site_id', id).eq('stat_date', rankModalDate)
        if (site!.has_rank_title) result = result.eq('platform', 'mobile').gt('volume', 0)
        return result.abortSignal(controller.signal)
      }
      const [up, down, page] = await Promise.all([
        query(true).eq('type', 'rankup'), query(true).eq('type', 'rankdown'),
        query(false).eq('type', rankModalTab === 'up' ? 'rankup' : 'rankdown')
          .order('volume', { ascending: false }).order('id').range(rankModalPage * modalPageSize, (rankModalPage + 1) * modalPageSize - 1),
      ])
      for (const response of [up, down, page]) if (response.error) throw new Error(response.error.message)
      if (controller.signal.aborted) return
      setRankModalRows((page.data ?? []) as PageData['rankupAll'])
      setRankModalCounts({ up: up.count ?? 0, down: down.count ?? 0 })
    }
    void load().catch(error => { if (!controller.signal.aborted) setModalError(error instanceof Error ? error.message : '排名读取失败，请重试') })
      .finally(() => { if (!controller.signal.aborted) setRankModalLoading(false) })
    return () => controller.abort()
  }, [rankModal, site, id, rankModalDate, rankModalTab, rankModalPage, modalPageSize, modalRetry])

  useEffect(() => {
    if (!unstableModal || !id) return
    const controller = new AbortController()
    setUnstableModalLoading(true); setModalError('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Promise.resolve((getBrowserClient() as any).rpc('get_site_rank_overview', {
      p_site_id: id, p_date_start: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
      p_date_end: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
      p_unstable_offset: unstableModalPage * modalPageSize, p_unstable_limit: modalPageSize,
    }).abortSignal(controller.signal)).then(response => {
      const result = response as { data: RankOverview; error: { message: string } | null }
      if (result.error) throw new Error(result.error.message)
      if (controller.signal.aborted) return
      setUnstableModalRows(result.data.unstable); setUnstableModalTotal(result.data.unstableCount)
    }).catch(error => { if (!controller.signal.aborted) setModalError(error instanceof Error ? error.message : '不稳定词读取失败，请重试') })
      .finally(() => { if (!controller.signal.aborted) setUnstableModalLoading(false) })
    return () => controller.abort()
  }, [unstableModal, id, unstableModalPage, modalPageSize, modalRetry])

  async function loadData() {
    pageRequest.current?.abort()
    const controller = new AbortController()
    pageRequest.current = controller
    setLoading(true)
    setIndexedPagesLoading(true)
    setError(null)
    try {
      const supabase = getBrowserClient()
      const d30ago = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

      const { data: siteRow, error: siteError } = await supabase.from('sites')
        .select('id, domain, name, has_rank_title').eq('id', id).abortSignal(controller.signal).maybeSingle() as { data: SiteRow | null; error: { message: string } | null }
      if (siteError) throw new Error(siteError.message)

      if (!siteRow) { setError('站点不存在'); setLoading(false); return }
      setSite(siteRow)

      const [
        weightResult, snapshotResult, rankResult, appResult, gameResult,
      ] = await Promise.all([
        supabase.from('weight_history')
          .select('record_date,pc_weight,mobile_weight,pc_ip,pc_ip_max,mobile_ip,mobile_ip_max')
          .eq('site_id', id).gte('record_date', d30ago).lte('record_date', new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)).order('record_date').abortSignal(controller.signal),
        supabase.from('index_snapshots')
          .select('snapshot_date,index_count')
          .eq('site_id', id).gte('snapshot_date', d30ago).lte('snapshot_date', new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)).order('snapshot_date').abortSignal(controller.signal),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc('get_site_rank_overview', { p_site_id: id, p_date_start: d30ago, p_date_end: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }).abortSignal(controller.signal),
        supabase.from('raw_keywords')
          .select('keyword,content_date,content_type')
          .eq('site_id', id)
          .or('content_type.eq.app,content_type.is.null')
          .not('keyword', 'like', '%电脑版%')
          .order('content_date', { ascending: false }).limit(12).abortSignal(controller.signal),
        supabase.from('raw_keywords')
          .select('keyword,content_date,content_type')
          .eq('site_id', id)
          .eq('content_type', 'game')
          .not('keyword', 'like', '%电脑版%')
          .order('content_date', { ascending: false }).limit(12).abortSignal(controller.signal),
      ])
      for (const response of [weightResult, snapshotResult, rankResult, appResult, gameResult]) {
        if (response.error) throw new Error(response.error.message)
      }
      if (controller.signal.aborted) return
      const wh = weightResult.data
      const is = snapshotResult.data
      const appRaw = appResult.data
      const gameRaw = gameResult.data
      const ranks = rankResult.data as RankOverview

      const result: PageData = {
        pcWeight: 0, mobileWeight: 0,
        pcIpMin: 0, pcIpMax: 0, mobileIpMin: 0, mobileIpMax: 0,
        indexCount: 0,
        pcWeightChange: 0, mobileWeightChange: 0,
        pcIpAvgChange: 0, mobileIpAvgChange: 0, indexChange: 0,
        weightTrend: [], indexTrend: [], ipTrend: [],
        kwDate: '', appKw: [], gameKw: [], appKwAll: [], gameKwAll: [],
        appCount: 0, gameCount: 0,
        rankDate: ranks.rankDate ?? '', rankupAll: ranks.rankup, rankdownAll: ranks.rankdown,
        rankupCount: ranks.rankupCount, rankdownCount: ranks.rankdownCount,
        unstableAll: ranks.unstable, unstableCount: ranks.unstableCount,
      }

      // Weight history
      type WH = { record_date: string; pc_weight: number; mobile_weight: number; pc_ip: number; pc_ip_max: number; mobile_ip: number; mobile_ip_max: number }
      const whArr = (wh || []) as WH[]
      if (whArr.length >= 1) {
        const latest = whArr[whArr.length - 1]
        const prev = whArr.length >= 2 ? whArr[whArr.length - 2] : null
        const lPcAvg = Math.round((latest.pc_ip + latest.pc_ip_max) / 2)
        const lMobAvg = Math.round((latest.mobile_ip + latest.mobile_ip_max) / 2)
        result.pcWeight = latest.pc_weight; result.mobileWeight = latest.mobile_weight
        result.pcIpMin = latest.pc_ip; result.pcIpMax = latest.pc_ip_max
        result.mobileIpMin = latest.mobile_ip; result.mobileIpMax = latest.mobile_ip_max
        result.pcWeightChange = prev ? latest.pc_weight - prev.pc_weight : 0
        result.mobileWeightChange = prev ? latest.mobile_weight - prev.mobile_weight : 0
        result.pcIpAvgChange = prev ? lPcAvg - Math.round((prev.pc_ip + prev.pc_ip_max) / 2) : 0
        result.mobileIpAvgChange = prev ? lMobAvg - Math.round((prev.mobile_ip + prev.mobile_ip_max) / 2) : 0
        result.weightTrend = whArr.map(h => ({ date: h.record_date.slice(5), pc: h.pc_weight, mobile: h.mobile_weight }))
        result.ipTrend = whArr.map(h => ({ date: h.record_date.slice(5), pcAvg: Math.round((h.pc_ip + h.pc_ip_max) / 2), mobileAvg: Math.round((h.mobile_ip + h.mobile_ip_max) / 2) }))
      }

      // Index history
      type IS = { snapshot_date: string; index_count: number }
      const isArr = (is || []) as IS[]
      if (isArr.length >= 1) {
        const latest = isArr[isArr.length - 1]
        const prev = isArr.length >= 2 ? isArr[isArr.length - 2] : null
        result.indexCount = latest.index_count
        result.indexChange = prev ? latest.index_count - prev.index_count : 0
        result.indexTrend = isArr.map(s => ({ date: s.snapshot_date.slice(5), count: s.index_count }))
      }

      // Keywords
      type KwRaw = { keyword: string; content_date: string; content_type: string }
      const latestAppDate = (appRaw || []).length > 0 ? (appRaw![0] as KwRaw).content_date : ''
      const latestGameDate = (gameRaw || []).length > 0 ? (gameRaw![0] as KwRaw).content_date : ''
      const latestKwDate = [latestAppDate, latestGameDate].filter(Boolean).sort().reverse()[0] || ''
      result.kwDate = latestKwDate

      const appAll = ((appRaw || []) as KwRaw[]).filter(k => k.content_date === latestKwDate).map(k => ({ keyword: k.keyword }))
      const gameAll = ((gameRaw || []) as KwRaw[]).filter(k => k.content_date === latestKwDate).map(k => ({ keyword: k.keyword }))
      result.appKwAll = appAll
      result.gameKwAll = gameAll
      result.appKw = appAll.slice(0, 12)
      result.gameKw = gameAll.slice(0, 12)

      if (latestKwDate) {
        const [appCnt, gameCnt] = await Promise.all([
          supabase.from('raw_keywords').select('id', { count: 'exact', head: true })
            .eq('site_id', id).eq('content_date', latestKwDate)
            .or('content_type.eq.app,content_type.is.null').not('keyword', 'like', '%电脑版%'),
          supabase.from('raw_keywords').select('id', { count: 'exact', head: true })
            .eq('site_id', id).eq('content_date', latestKwDate)
            .eq('content_type', 'game').not('keyword', 'like', '%电脑版%'),
        ])
        if (appCnt.error) throw new Error(appCnt.error.message)
        if (gameCnt.error) throw new Error(gameCnt.error.message)
        result.appCount = appCnt.count ?? appAll.length
        result.gameCount = gameCnt.count ?? gameAll.length
      }

      if (controller.signal.aborted) return
      setData(result)

      // Load indexed pages (12 most recent)
      setLoading(false)
      setIndexedPagesError('')
      void fetch(`/api/sites/index-pages?siteId=${id}&page=0&pageSize=12&timeFilter=all&statusFilter=all`, { signal: controller.signal })
        .then(async response => {
          const body = await response.json()
          if (!response.ok) throw new Error(body.error || '收录页面读取失败，请重试')
          if (controller.signal.aborted) return
          setIndexedPages(body.rows || []); setIndexedPagesTotal(body.total || 0)
        }).catch(error => { if (!controller.signal.aborted) setIndexedPagesError(error instanceof Error ? error.message : '收录页面读取失败，请重试') })
        .finally(() => { if (!controller.signal.aborted) setIndexedPagesLoading(false) })

    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center py-20 text-gray-400 gap-3">
        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        加载中…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 text-sm">{error}</div>
        <Link href="/content/site-intel" className="mt-4 inline-block text-sm text-green-600 hover:underline">← 返回站点情报</Link>
      </div>
    )
  }

  if (!data || !site) return null

  const kwList = kwTab === 'app' ? data.appKw : data.gameKw
  const kwCount = kwTab === 'app' ? data.appCount : data.gameCount
  const rankList = rankTab === 'up' ? data.rankupAll.slice(0, 12) : data.rankdownAll.slice(0, 12)
  const rankCount = rankTab === 'up' ? data.rankupCount : data.rankdownCount

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/content/site-intel" className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{site.domain}</h1>
          {site.name && <p className="text-gray-500 text-sm mt-0.5">{site.name}</p>}
        </div>
      </div>

      <div className="space-y-5">
        {/* Metric cards */}
        <div className="grid grid-cols-3 xl:grid-cols-5 gap-3">
          <MetricCard label="PC权重" value={String(data.pcWeight)} change={data.pcWeightChange} />
          <MetricCard label="移动权重" value={String(data.mobileWeight)} change={data.mobileWeightChange} />
          <MetricCard
            label="PC日均IP"
            value={data.pcIpMin === 0 && data.pcIpMax === 0 ? '-' : `${fmt(data.pcIpMin)}~${fmt(data.pcIpMax)}`}
            change={data.pcIpAvgChange}
          />
          <MetricCard
            label="移动日均IP"
            value={data.mobileIpMin === 0 && data.mobileIpMax === 0 ? '-' : `${fmt(data.mobileIpMin)}~${fmt(data.mobileIpMax)}`}
            change={data.mobileIpAvgChange}
          />
          <MetricCard
            label="百度收录"
            value={data.indexCount > 0 ? data.indexCount.toLocaleString() : '-'}
            change={data.indexChange}
          />
        </div>

        {/* Row 1: Weight trend + Index trend */}
        <div className="grid grid-cols-2 gap-5">
          <SectionCard title="权重趋势（近30天）">
            {data.weightTrend.length >= 2 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={data.weightTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={24} />
                    <Tooltip />
                    <Line type="monotone" dataKey="pc" name="PC权重" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="mobile" name="移动权重" stroke="#f97316" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block" />PC权重</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-orange-500 inline-block" />移动权重</span>
                </div>
              </>
            ) : (
              <EmptyState text="数据积累中…" />
            )}
          </SectionCard>

          <SectionCard title="收录趋势（近30天）">
            {data.indexTrend.length >= 2 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data.indexTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} width={52} tickFormatter={v => fmt(v)} />
                  <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v)} />
                  <Line type="monotone" dataKey="count" name="百度收录" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="数据积累中…" />
            )}
          </SectionCard>
        </div>

        {/* Row 2: IP trend + New keywords */}
        <div className="grid grid-cols-2 gap-5">
          <SectionCard title="来路IP趋势（近30天）">
            {data.ipTrend.length >= 2 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={data.ipTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={52} tickFormatter={v => fmt(v)} />
                    <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v)} />
                    <Line type="monotone" dataKey="pcAvg" name="PC均值" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="mobileAvg" name="移动均值" stroke="#f97316" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block" />PC均值</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-orange-500 inline-block" />移动均值</span>
                </div>
              </>
            ) : (
              <EmptyState text="数据积累中…" />
            )}
          </SectionCard>

          <SectionCard
            title={`最近新增关键词${data.kwDate ? ` · ${data.kwDate}` : ''}`}
            headerRight={
              <div className="flex gap-1">
                <button onClick={() => setKwTab('app')}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${kwTab === 'app' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  应用{kwTab === 'app' ? ` (${data.appCount})` : ''}
                </button>
                <button onClick={() => setKwTab('game')}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${kwTab === 'game' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  游戏{kwTab === 'game' ? ` (${data.gameCount})` : ''}
                </button>
              </div>
            }
          >
            {kwList.length === 0 ? (
              <EmptyState text="暂无数据" />
            ) : (
              <>
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
                {kwCount > 12 && (
                  <div className="mt-3 flex justify-center">
                    <button onClick={() => {
                      setKwModal(true); setKwModalTab(kwTab); setKwModalPage(0)
                      setKwModalDate(data.kwDate)
                      setKwModalAppAll(data.appKwAll)
                      setKwModalGameAll(data.gameKwAll)
                      setKwModalAppCount(data.appCount)
                      setKwModalGameCount(data.gameCount)
                    }}
                      className="text-xs border rounded px-2 py-0.5 transition-colors text-green-500 hover:text-green-700 border-green-100 hover:border-green-200">
                      查看全部 {kwCount} 条
                    </button>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        </div>

        {/* Row 3: Rank changes + Unstable */}
        <div className="grid grid-cols-2 gap-5">
          <SectionCard
            title={`排名波动${data.rankDate ? ` · ${data.rankDate}` : ''}`}
            headerRight={
              <div className="flex gap-1">
                <button onClick={() => setRankTab('up')}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${rankTab === 'up' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  涨入{rankTab === 'up' ? ` (${data.rankupCount})` : ''}
                </button>
                <button onClick={() => setRankTab('down')}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${rankTab === 'down' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  跌出{rankTab === 'down' ? ` (${data.rankdownCount})` : ''}
                </button>
              </div>
            }
          >
            {rankList.length === 0 ? (
              <EmptyState text="暂无数据" />
            ) : (
              <>
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
                {rankCount > 12 && (
                  <div className="mt-3 flex justify-center">
                    <button onClick={() => { setRankModal(true); setRankModalTab(rankTab); setRankModalPage(0); setRankModalDate(data.rankDate) }}
                      className="text-xs border rounded px-2 py-0.5 transition-colors text-green-500 hover:text-green-700 border-green-100 hover:border-green-200">
                      查看全部 {rankCount} 条
                    </button>
                  </div>
                )}
              </>
            )}
          </SectionCard>

          <SectionCard title="不稳定词（近30天反复涨跌）">
            {data.unstableAll.length === 0 ? (
              <EmptyState text="近30天无反复波动词" />
            ) : (
              <>
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {data.unstableAll.slice(0, 6).map((u, i) => (
                      <div key={i} className="h-6 flex items-center gap-1.5 text-xs">
                        <span className="text-gray-800 flex-1 truncate">{u.keyword}</span>
                        <span className="text-green-600 flex-shrink-0">↑{u.upDays}</span>
                        <span className="text-red-500 flex-shrink-0">↓{u.downDays}</span>
                      </div>
                    ))}
                  </div>
                  {data.unstableAll.length > 6 && (
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {data.unstableAll.slice(6, 12).map((u, i) => (
                        <div key={i + 6} className="h-6 flex items-center gap-1.5 text-xs">
                          <span className="text-gray-800 flex-1 truncate">{u.keyword}</span>
                          <span className="text-green-600 flex-shrink-0">↑{u.upDays}</span>
                          <span className="text-red-500 flex-shrink-0">↓{u.downDays}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {data.unstableCount > 12 && (
                  <div className="mt-3 flex justify-center">
                    <button onClick={() => { setUnstableModal(true); setUnstableModalPage(0) }}
                      className="text-xs border rounded px-2 py-0.5 transition-colors text-green-500 hover:text-green-700 border-green-100 hover:border-green-200">
                      查看全部 {data.unstableCount} 条
                    </button>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        </div>

        {/* Row 4: Indexed pages large card */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">收录页面</h3>
            {indexedPagesTotal > 0 && (
              <Link
                href={`/content/index-pages?siteId=${id}`}
                className="text-xs border rounded px-2 py-0.5 transition-colors text-green-500 hover:text-green-700 border-green-100 hover:border-green-200"
              >
                查看全部 {indexedPagesTotal.toLocaleString()} 条
              </Link>
            )}
          </div>
          {indexedPagesLoading ? <EmptyState text="正在读取收录页面…" /> : indexedPagesError ? <p role="status" className="py-5 text-xs text-red-600">{indexedPagesError}</p> : indexedPages.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-sm text-gray-400">暂无收录页面数据</div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {indexedPages.map((p, i) => (
                <div key={i} className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-green-600 hover:underline truncate flex-1 min-w-0"
                    >
                      {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                    </a>
                    {p.is_new && <span className="flex-shrink-0 text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-medium">新</span>}
                    {p.is_reindexed && <span className="flex-shrink-0 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">复</span>}
                    {p.is_disappeared && <span className="flex-shrink-0 text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-medium">脱</span>}
                  </div>
                  {p.title && (
                    <p className="text-xs text-gray-400 truncate mt-0.5">{p.title}</p>
                  )}
                  <p className="text-xs text-gray-300 mt-0.5">{p.first_seen_date}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 关键词 Modal */}
      {kwModal && (() => {
        const list = kwModalTab === 'app' ? kwModalAppAll : kwModalGameAll
        const paged = list
        const total = kwModalTab === 'app' ? kwModalAppCount : kwModalGameCount
        return (
          <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-gray-900">{site.domain} · 最近新增关键词</h3>
                  {kwModalLoading ? (
                    <span className="text-xs text-gray-400">加载中…</span>
                  ) : (
                    <input aria-label="选择日期" type="date" value={kwModalDate}
                      onChange={e => handleKwDateChange(e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none" />
                  )}
                </div>
                <button onClick={() => setKwModal(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex border-b border-gray-200 px-5 flex-shrink-0">
                {(['app', 'game'] as const).map(t => (
                  <button key={t} onClick={() => { setKwModalTab(t); setKwModalPage(0) }}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors mr-2 ${kwModalTab === t ? (t === 'app' ? 'border-blue-500 text-blue-600' : 'border-purple-500 text-purple-600') : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                    {t === 'app' ? '应用' : '游戏'}
                    <span className="ml-1.5 text-xs text-gray-400">({t === 'app' ? kwModalAppCount : kwModalGameCount})</span>
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-3">
                {modalError && <div role="status" className="flex items-center gap-3 py-3 text-xs text-red-600">{modalError}<button type="button" className="btn-secondary" onClick={() => setModalRetry(value => value + 1)}>重试</button></div>}
                {kwModalLoading ? (
                  <div className="flex items-center justify-center py-16 text-gray-400 gap-2 text-sm">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    加载中…
                  </div>
                ) : paged.length === 0 && !modalError ? (
                  <p className="text-center text-gray-400 py-10 text-sm">暂无数据</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {paged.map((k, i) => (
                      <li key={i} className="py-2 text-sm text-gray-900">{k.keyword}</li>
                    ))}
                  </ul>
                )}
              </div>
              <PaginationBar page={kwModalPage} total={total} pageSize={modalPageSize}
                onPageChange={p => setKwModalPage(p)}
                onPageSizeChange={s => { setModalPageSize(s); setKwModalPage(0) }} />
            </div>
          </div>
        )
      })()}

      {/* 排名波动 Modal */}
      {rankModal && (() => {
        const paged = rankModalRows
        const total = rankModalCounts[rankModalTab]
        return (
          <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-gray-900">{site.domain} · 排名波动</h3>
                  <input aria-label="选择日期" type="date" value={rankModalDate}
                    onChange={e => { setRankModalDate(e.target.value); setRankModalPage(0) }}
                    className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none" />
                </div>
                <button onClick={() => setRankModal(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex border-b border-gray-200 px-5 flex-shrink-0">
                {(['up', 'down'] as const).map(t => (
                  <button key={t} onClick={() => { setRankModalTab(t); setRankModalPage(0) }}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors mr-2 ${rankModalTab === t ? (t === 'up' ? 'border-green-500 text-green-600' : 'border-red-500 text-red-600') : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                    {t === 'up' ? '涨入' : '跌出'}
                    <span className="ml-1.5 text-xs text-gray-400">({rankModalCounts[t]})</span>
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                {modalError && <div role="status" className="flex items-center gap-3 px-5 py-3 text-xs text-red-600">{modalError}<button type="button" className="btn-secondary" onClick={() => setModalRetry(value => value + 1)}>重试</button></div>}
                {rankModalLoading ? <EmptyState text="正在读取排名…" /> : paged.length === 0 && !modalError ? (
                  <p className="text-center text-gray-400 py-16 text-sm">暂无数据</p>
                ) : (
                  <table aria-label="数据表格" className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-5 py-2.5 text-left font-medium text-gray-500">关键词</th>
                        <th className="px-5 py-2.5 text-right font-medium text-gray-500">搜索量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paged.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-5 py-2 text-gray-900">{r.keyword}</td>
                          <td className="px-5 py-2 text-right text-gray-600">{r.volume > 0 ? r.volume.toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <PaginationBar page={rankModalPage} total={total} pageSize={modalPageSize}
                onPageChange={p => setRankModalPage(p)}
                onPageSizeChange={s => { setModalPageSize(s); setRankModalPage(0) }} />
            </div>
          </div>
        )
      })()}

      {/* 不稳定词 Modal */}
      {unstableModal && (() => {
        const paged = unstableModalRows
        return (
          <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
                <div>
                  <h3 className="font-semibold text-gray-900">{site.domain} · 不稳定词</h3>
                  <p className="text-xs text-gray-400 mt-0.5">近30天在涨入和跌出均出现过的词，按搜索量排序</p>
                </div>
                <button onClick={() => setUnstableModal(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {modalError && <div role="status" className="flex items-center gap-3 px-5 py-3 text-xs text-red-600">{modalError}<button type="button" className="btn-secondary" onClick={() => setModalRetry(value => value + 1)}>重试</button></div>}
                {unstableModalLoading ? <EmptyState text="正在读取不稳定词…" /> : paged.length === 0 && !modalError ? (
                  <p className="text-center text-gray-400 py-16 text-sm">暂无不稳定词</p>
                ) : (
                  <table aria-label="数据表格" className="w-full text-sm">
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
                      {paged.map((u, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-5 py-2 text-gray-900">{u.keyword}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{u.volume > 0 ? u.volume.toLocaleString() : '—'}</td>
                          <td className="px-4 py-2 text-right text-green-600">{u.upDays}</td>
                          <td className="px-4 py-2 text-right text-red-500">{u.downDays}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{u.upDays + u.downDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <PaginationBar page={unstableModalPage} total={unstableModalTotal} pageSize={modalPageSize}
                onPageChange={p => setUnstableModalPage(p)}
                onPageSizeChange={s => { setModalPageSize(s); setUnstableModalPage(0) }} />
            </div>
          </div>
        )
      })()}
    </div>
  )
}
