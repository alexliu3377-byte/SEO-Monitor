'use client'

import React, { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SimplePagination } from '@/components/simple-pagination'

const ContentFeedTab = dynamic(() => import('@/components/content-feed-tab'), {
  loading: () => <PanelLoading label="正在读取内容动态" />,
})
const TrendDiscoveryClient = dynamic(() => import('../trend-discovery/trend-discovery-client'), {
  loading: () => <PanelLoading label="正在读取 SEO 趋势" />,
})

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-20 text-center text-sm text-slate-500" role="status">
      <span className="mx-auto mb-3 block h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </div>
  )
}

// ── Helper components ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      <span className="sr-only">加载中</span>
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

function ExternalSourceLink({ href, label, randomTapTapSearch = false }: {
  href: string
  label: string
  randomTapTapSearch?: boolean
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label}（新窗口）`}
      title={label}
      onClick={randomTapTapSearch ? event => {
        event.currentTarget.href = `https://www.taptap.cn/search/${Math.floor(Math.random() * 99_999) + 1}`
      } : undefined}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-semibold text-blue-500 transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      <span aria-hidden="true">↗</span>
    </a>
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

function Card({ title, subtitle, icon, list, footer, accent, sourceUrl, sourceLabel }: {
  title: string; subtitle?: string; icon: string
  list: React.ReactNode; footer?: React.ReactNode; accent?: string
  sourceUrl?: string; sourceLabel?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className={`px-4 py-3 border-b border-gray-100 ${accent || 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
              {sourceUrl && (
                <ExternalSourceLink
                  href={sourceUrl}
                  label={sourceLabel || `打开 ${title} 来源页面`}
                />
              )}
            </div>
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
    <div role="dialog" aria-modal="true" aria-label="详情窗口" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
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

// ── 新游动态（TapTap + 好游快爆）──────────────────────────────────────────

interface HotItem { rank: number; name: string; labels: string[] }
interface TodayGame { title: string; tag: string; startDate: string; startTime: string; endDate: string; rating: number | null; labels: string[]; icon: string }
interface HaoyouItem { name: string; tags: string[]; score: string; status: string; url: string; btnText: string; date: string }
interface HaoyouHotItem { rank: number; name: string; tags: string[]; score: string; url: string }
interface SearchTrendItem { rank: number; name: string; source: 'TapTap' | '好游快爆'; labels?: string[]; url?: string }
interface ModalState { title: string; items: React.ReactNode[] }
interface ContentFeedItem {
  id: string
  source: string
  sourceId: string
  category: string | null
  title: string
  url: string
  coverUrl: string | null
  author: string | null
  summary: string | null
  publishedAt: string | null
  firstSeenAt: string
}

interface ContentFeedResponse {
  items: ContentFeedItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  types?: string[]
}

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

function SourceRankingTab({ source }: { source: 'taptap' | 'haoyou' }) {
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
    const controller = new AbortController()
    const now = new Date()
    const ts = `${String(now.getMonth() + 1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    if (source === 'taptap') {
      fetch('/api/charts/taptap-hot', { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => { setHotItems(d.items ?? []); setHotUpdatedAt(ts) })
        .catch(() => {})
        .finally(() => setHotLoading(false))

      fetch('/api/charts/taptap-today', { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => {
          setTodayGames(d.todayGames ?? [])
          setUpcomingGames(d.upcomingGames ?? [])
          setTopEvents(d.topEvents ?? [])
        })
        .catch(() => {})
        .finally(() => setTodayLoading(false))
      return () => controller.abort()
    }

    fetch('/api/charts/haoyou', { signal: controller.signal })
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
    return () => controller.abort()
  }, [source])

  function openModal(title: string, items: React.ReactNode[]) {
    setModal({ title, items })
  }

  const PREVIEW = 20

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
      <a href={g.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-xs font-medium text-gray-800 hover:text-green-700" title={g.name}>{g.name}</a>
      {g.score && <span className="flex-shrink-0 text-[11px] font-semibold text-green-600">{g.score}</span>}
      {g.tags[0] && (
        <span className="text-xs px-1.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">{g.tags[0]}</span>
      )}
    </li>
  ))

  return (
    <div className="space-y-10">
      {/* ── TapTap ── */}
      {source === 'taptap' && <div>
        <SectionHeader title="TapTap" color="bg-teal-500" updatedAt={hotUpdatedAt || '加载中…'} />
        <div className="grid gap-5 xl:grid-cols-3">

          {/* 今日游戏 */}
          <Card
            sourceUrl="https://www.taptap.cn/upcoming"
            sourceLabel="打开 TapTap 今日游戏来源页面"
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
            sourceUrl="https://www.taptap.cn/upcoming"
            sourceLabel="打开 TapTap 即将上线来源页面"
            title={`即将上线${upcomingGames.length ? ` · ${upcomingGames.length} 款` : ''}`}
            subtitle="未来 30 天预约 / 首发" icon="📅" accent="bg-teal-50"
            list={todayLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p>
              : upcomingGames.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
              : <ul>{upcomingGames.slice(0, PREVIEW).map((g, i) => <GameItem key={i} g={g} showDate />)}</ul>}
            footer={!todayLoading && upcomingGames.length > PREVIEW
              ? <MoreButton total={upcomingGames.length} shown={PREVIEW} onClick={() => openModal(`即将上线 · ${upcomingGames.length} 款`, upcomingGames.map((g, i) => <GameItem key={i} g={g} showDate />))} />
              : undefined}
          />

          {/* 热门榜 */}
          <Card
            sourceUrl="https://www.taptap.cn/top/download"
            sourceLabel="打开 TapTap 热门榜来源页面"
            title="热门榜 TOP 10" subtitle="本系统每 6 小时更新" icon="🔥" accent="bg-teal-50"
            list={hotLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p>
              : hotItems.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
              : <ul>{hotItemNodes.slice(0, PREVIEW)}</ul>}
            footer={!hotLoading && hotItemNodes.length > PREVIEW
              ? <MoreButton total={hotItemNodes.length} shown={PREVIEW} onClick={() => openModal('TapTap 热门榜', hotItemNodes)} />
              : undefined}
          />

        </div>
      </div>}

      {/* ── 好游快爆 ── */}
      {source === 'haoyou' && <div>
        <SectionHeader title="好游快爆" color="bg-green-500" updatedAt={haoyouUpdatedAt || '加载中…'} />
        <div className="grid gap-5 xl:grid-cols-3">

          {/* 即将上线 */}
          {(() => {
            const allUpcoming = [...haoyouUpcomingToday, ...haoyouUpcoming]
            const hasBaoliao = haoyouBaoliao.length > 0
            const preview = hasBaoliao ? PREVIEW - 1 : PREVIEW
            return (
              <Card
                sourceUrl="https://www.3839.com/timeline.html"
                sourceLabel="打开好游快爆即将上线来源页面"
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
            sourceUrl="https://www.3839.com/timeline.html"
            sourceLabel="打开好游快爆即将更新来源页面"
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
            sourceUrl="https://www.3839.com/top/hot.html"
            sourceLabel="打开好游快爆热门榜来源页面"
            title="免费热门榜 TOP 20" subtitle="已排除付费与买断制游戏 · 每 6 小时更新" icon="🔥" accent="bg-green-50"
            list={haoyouLoading ? <p className="text-xs text-gray-400 py-4 text-center">加载中…</p>
              : haoyouHotItems.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">暂无数据</p>
              : <ul>{haoyouHotNodes.slice(0, PREVIEW)}</ul>}
            footer={!haoyouLoading && haoyouHotNodes.length > PREVIEW
              ? <MoreButton total={haoyouHotNodes.length} shown={PREVIEW} onClick={() => openModal('好游快爆 热门榜', haoyouHotNodes)} />
              : undefined}
          />

        </div>
      </div>}

      {modal && <MoreModal title={modal.title} items={modal.items} onClose={() => setModal(null)} />}
    </div>
  )
}

function SearchTrendList({ items, loading, emptyText, tone }: {
  items: SearchTrendItem[]
  loading: boolean
  emptyText: string
  tone: 'teal' | 'green'
}) {
  if (loading) return <Spinner />
  if (items.length === 0) return <div className="flex min-h-48 items-center justify-center px-5 text-sm text-gray-400">{emptyText}</div>

  return (
    <ol className="divide-y divide-gray-100 px-4 py-2">
      {items.map((item) => (
        <li key={`${item.source}-${item.rank}-${item.name}`} className="flex min-h-9 items-center gap-3 py-1.5">
          <RankBadge rank={item.rank} />
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className={`min-w-0 flex-1 truncate text-sm text-gray-800 ${tone === 'teal' ? 'hover:text-teal-700' : 'hover:text-green-700'}`} title={item.name}>
              {item.name}
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm text-gray-800" title={item.name}>{item.name}</span>
          )}
          {item.labels?.[0] && <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{item.labels[0]}</span>}
        </li>
      ))}
    </ol>
  )
}

function SearchTrendsTab() {
  const [tapTapItems, setTapTapItems] = useState<SearchTrendItem[]>([])
  const [haoyouItems, setHaoyouItems] = useState<SearchTrendItem[]>([])
  const [tapTapLoading, setTapTapLoading] = useState(true)
  const [haoyouLoading, setHaoyouLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/charts/taptap-search-trends', { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => setTapTapItems(Array.isArray(data.items) ? data.items : []))
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setTapTapLoading(false) })

    fetch('/api/charts/haoyou?view=search', { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => setHaoyouItems(Array.isArray(data.searchItems) ? data.searchItems : []))
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setHaoyouLoading(false) })
    return () => controller.abort()
  }, [])

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-teal-100 bg-teal-50 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
              <h2 className="truncate text-sm font-semibold text-gray-900">TapTap 热门搜索</h2>
              <ExternalSourceLink
                href="https://www.taptap.cn/search/1"
                label="打开 TapTap 热门搜索来源页面"
                randomTapTapSearch
              />
            </div>
            <span className="whitespace-nowrap text-[11px] text-teal-700">每日读取一次</span>
          </div>
        </div>
        <SearchTrendList items={tapTapItems} loading={tapTapLoading} emptyText="今日暂未取得 TapTap 热门搜索" tone="teal" />
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-green-100 bg-green-50 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
              <h2 className="truncate text-sm font-semibold text-gray-900">好游快爆热门搜索</h2>
              <ExternalSourceLink
                href="https://www.3839.com/top/hot.html"
                label="打开好游快爆热门搜索来源页面"
              />
            </div>
            <span className="whitespace-nowrap text-[11px] text-green-700">每 6 小时更新</span>
          </div>
        </div>
        <SearchTrendList items={haoyouItems} loading={haoyouLoading} emptyText="暂未取得好游快爆热门搜索" tone="green" />
      </section>

      <section className="overflow-hidden rounded-xl border border-dashed border-gray-200 bg-white">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-500">其他来源</h2>
        </div>
        <div className="flex min-h-48 items-center justify-center px-4 text-sm text-gray-300">暂未接入</div>
      </section>
    </div>
  )
}

// 4399 的“近期收录”只表示内容近期出现在来源页面，不等同于游戏刚发布。
function Recent4399Tab() {
  const [items, setItems] = useState<ContentFeedItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [itemType, setItemType] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')

    const params = new URLSearchParams({ sources: '4399', page: String(page), pageSize: '20', includeTypes: '1' })
    if (itemType) params.set('type', itemType)
    fetch(`/api/content-feed?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          if (response.status === 401) throw new Error('登录已失效，请重新登录后再试')
          throw new Error(data?.error || '读取 4399 近期收录失败')
        }
        if (!data || !Array.isArray(data.items)) throw new Error('4399 近期收录返回格式异常')
        return data as ContentFeedResponse
      })
      .then((data) => {
        const nextTotalPages = Math.max(1, Number(data.totalPages) || 1)
        setItems(Array.isArray(data.items) ? data.items : [])
        setTotal(Number(data.total) || 0)
        setTotalPages(nextTotalPages)
        setTypes(Array.isArray(data.types) ? data.types : [])
        // 数据刷新后总页数可能缩小，避免停在已经不存在、且无法返回的空白页。
        if (page > nextTotalPages) setPage(nextTotalPages)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name === 'AbortError') return
        setItems([])
        setError(requestError instanceof Error ? requestError.message : '读取 4399 近期收录失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [itemType, page, retryKey])

  function formatDate(value: string | null) {
    if (!value) return '日期未知'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white" aria-busy={loading}>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h2 className="truncate text-sm font-semibold text-gray-900">4399近期收录</h2>
            <ExternalSourceLink
              href="https://a.4399.cn/game-new.html"
              label="打开 4399 近期收录来源页面"
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">按 4399 页面近期出现时间整理，仅代表近期收录，不代表游戏刚发布。</p>
        </div>
        <select
          aria-label="筛选游戏类型"
          value={itemType}
          onChange={(event) => { setItemType(event.target.value); setPage(1) }}
          className="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-700 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 sm:w-36"
        >
          <option value="">全部类型</option>
          {types.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
          <p className="text-sm text-red-600" role="alert">{error}</p>
          <div className="flex items-center gap-2">
            {page > 1 && (
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:border-green-300 hover:text-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                返回上一页
              </button>
            )}
            <button
              type="button"
              onClick={() => setRetryKey((key) => key + 1)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:border-green-300 hover:text-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              重新读取
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-52 items-center justify-center px-5 py-10 text-sm text-gray-400" role="status">
          暂无 4399 近期收录资料
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <caption className="sr-only">4399近期收录列表</caption>
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th scope="col" className="px-5 py-3">游戏名称</th>
                  <th scope="col" className="w-40 px-4 py-3">类型</th>
                  <th scope="col" className="w-32 px-4 py-3">收录日期</th>
                  <th scope="col" className="w-24 px-5 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => {
                  const itemType = item.summary?.trim() || (item.category === 'new_game' ? '游戏' : '')
                  return (
                    <tr key={item.id || item.sourceId} className="text-sm text-gray-700 hover:bg-gray-50/70">
                      <td className="px-5 py-3">
                        <p className="max-w-[620px] truncate font-medium text-gray-900" title={item.title}>{item.title}</p>
                      </td>
                      <td className="px-4 py-3">
                        {itemType ? (
                          <span className="inline-flex max-w-36 truncate rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600" title={itemType}>{itemType}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(item.publishedAt || item.firstSeenAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`查看 ${item.title} 原文（新窗口）`}
                          className="inline-flex h-8 min-w-[72px] shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:border-green-300 hover:text-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                        >
                          查看原文
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <SimplePagination page={page - 1} total={total} disabled={loading} onChange={(nextPage) => setPage(nextPage + 1)} />
        </>
      )}
    </section>
  )
}

type Role = 'normal' | 'admin' | 'super'
type DiscoverySection = 'game' | 'app' | 'research'
type GameView = 'search' | 'rankings' | 'content'
type RankingSource = 'taptap' | 'haoyou' | '4399'

const SECTIONS: Array<{ id: DiscoverySection; label: string }> = [
  { id: 'game', label: '游戏' },
  { id: 'app', label: '应用' },
  { id: 'research', label: 'SEO 趋势' },
]
const GAME_VIEWS: Array<{ id: GameView; label: string }> = [
  { id: 'search', label: '搜索趋势' },
  { id: 'rankings', label: '平台榜单' },
  { id: 'content', label: '资讯动态' },
]
const RANKING_SOURCES: Array<{ id: RankingSource; label: string }> = [
  { id: 'taptap', label: 'TapTap' },
  { id: 'haoyou', label: '好游快爆' },
  { id: '4399', label: '4399' },
]

function oneOf<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback
}

export default function ChartsClient({ initialRole }: { initialRole: Role }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const section = oneOf(searchParams.get('section'), SECTIONS.map(item => item.id), 'game')
  const gameView = oneOf(searchParams.get('view'), GAME_VIEWS.map(item => item.id), 'search')
  const rankingSource = oneOf(searchParams.get('source'), RANKING_SOURCES.map(item => item.id), 'taptap')

  function navigate(next: { section?: DiscoverySection; view?: GameView; source?: RankingSource }) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.section) params.set('section', next.section)
    if (next.view) params.set('view', next.view)
    if (next.source) params.set('source', next.source)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="p-5 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">内容发现</h1>
        <p className="mt-1 text-sm text-gray-500">按游戏、应用或 SEO 趋势查看值得关注的内容</p>
      </div>

      <div className="mb-5 flex gap-7 overflow-x-auto border-b border-slate-200" aria-label="内容类型">
        {SECTIONS.map(item => (
          <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => navigate({ section: item.id })} className={`relative h-11 flex-none whitespace-nowrap px-1 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${section === item.id ? 'text-emerald-700 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-emerald-600' : 'text-slate-500 hover:text-slate-800'}`}>{item.label}</button>
        ))}
      </div>

      {section === 'game' && (
        <>
          <div className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" aria-label="游戏发现栏目">
            {GAME_VIEWS.map(item => <button key={item.id} type="button" aria-pressed={gameView === item.id} onClick={() => navigate({ view: item.id })} className={`h-9 flex-none whitespace-nowrap rounded-md px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${gameView === item.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{item.label}</button>)}
          </div>
          {gameView === 'search' && <SearchTrendsTab />}
          {gameView === 'content' && <ContentFeedTab key="game-feed" kind="game" />}
          {gameView === 'rankings' && (
            <>
              <div className="mb-4 flex flex-wrap gap-2" aria-label="榜单来源">
                {RANKING_SOURCES.map(item => <button key={item.id} type="button" aria-pressed={rankingSource === item.id} onClick={() => navigate({ source: item.id })} className={`h-9 rounded-lg border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${rankingSource === item.id ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>)}
              </div>
              {rankingSource === '4399' ? <Recent4399Tab /> : <SourceRankingTab source={rankingSource} />}
            </>
          )}
        </>
      )}
      {section === 'app' && <ContentFeedTab key="app-feed" kind="app" />}
      {section === 'research' && <TrendDiscoveryClient initialRole={initialRole} embedded includeContent={false} />}
    </div>
  )
}
