'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { SimplePagination } from './simple-pagination'
import { DiscoveryFilterButton, DiscoverySourceLink } from './game-discovery-controls'
import {
  GAME_DISCOVERY_SOURCES, MOMORANK_TABS, MOMORANK_RISING, WECHAT_DATASETS, isMomoOverview, isMomoRising,
  type GameDiscoveryDataset, type GameDiscoveryHighlights, type MomoPlatform,
} from '@/lib/game-discovery-sources'

type Row = { position: number; source_id: string; title: string; summary: string | null; url: string | null; metric: string | null; change: string | null; tags: string[] }
type Data = { items: Row[]; total: number; metadata: { source_date: string | null; collected_at: string; source_modified_at: string | null; highlights?: GameDiscoveryHighlights } | null }
type Source = 'momorank' | 'wechat' | 'hotwords'
const EMPTY: Data = { items: [], total: 0, metadata: null }
const NO_HIGHLIGHTS: GameDiscoveryHighlights = { changes: [], rising: [] }
function time(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function ChangeValue({ value, streak = false }: { value: string | null; streak?: boolean }) {
  const color = streak ? 'text-amber-700' : value?.startsWith('+') || value?.startsWith('日升') ? 'text-emerald-700' : value?.startsWith('-') ? 'text-red-600' : 'text-slate-500'
  return <span title={value || undefined} className={`shrink-0 truncate text-xs tabular-nums ${color}`}>{value || '—'}</span>
}

function GameName({ title, url }: { title: string; url: string | null }) {
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" title={title} className="block min-w-0 truncate text-blue-600 hover:underline">{title}</a>
    : <span title={title} className="block min-w-0 truncate font-medium text-slate-900">{title}</span>
}

function Changes({ groups }: { groups: GameDiscoveryHighlights['changes'] }) {
  if (!groups.length) return <p className="py-2 text-xs text-slate-500">来源未提供本日变化摘要</p>
  return <div className="space-y-1">{groups.map(group => <div key={group.label} className="flex min-w-0 items-start gap-3" role="group" aria-label={`${group.label}游戏`}>
    <p className={`w-10 shrink-0 py-1 text-xs font-medium leading-5 ${group.label === '连升' ? 'text-amber-700' : 'text-slate-600'}`}>{group.label}</p>
    <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">{group.items.map((row, index) => <li key={`${row.url || row.title}-${index}`} className="inline-flex max-w-full items-center gap-1 py-1 text-xs leading-5 [@media(pointer:coarse)]:min-h-11">
      <GameName title={row.title} url={row.url} /><ChangeValue value={row.change || (group.label === '新进榜' ? '新上榜' : null)} streak={group.label === '连升'} />
      {index < group.items.length - 1 && <span aria-hidden="true" className="text-slate-400">、</span>}
    </li>)}</ul>
  </div>)}</div>
}

function OverviewCard({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={title}>
    <div className="flex items-center gap-1 border-b border-teal-100 bg-teal-50 px-4 py-3">
      <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3><DiscoverySourceLink href={href} label={title} />
    </div><div className="px-4 py-2">{children}</div>
  </section>
}

function Overview({ data, dataset, platform }: { data: Data; dataset: GameDiscoveryDataset; platform: MomoPlatform }) {
  const highlights = data.metadata?.highlights || NO_HIGHLIGHTS
  const topDataset = platform === 'wechat' ? 'momo_bestseller' : 'momo_douyin_popularity'
  const risingDataset = platform === 'wechat' ? 'momo_rising' : 'momo_douyin_rising_popularity'
  return <div className="grid gap-5 xl:grid-cols-3" aria-label="排行榜概览卡片">
    <OverviewCard title="今日变化" href={GAME_DISCOVERY_SOURCES[dataset].url}><Changes groups={highlights.changes} /></OverviewCard>
    <OverviewCard title={platform === 'wechat' ? '畅销榜 Top 10' : '热门榜 Top 10'} href={GAME_DISCOVERY_SOURCES[topDataset].url}>
      <ol>{data.items.map(row => <li key={row.source_id} className="flex min-w-0 items-center gap-2 border-b border-slate-50 py-2 text-xs">
        <span className="w-5 shrink-0 rounded bg-slate-100 text-center tabular-nums text-slate-600">{row.position}</span>
        <div className="min-w-0 flex-1"><GameName title={row.title} url={row.url} /></div><ChangeValue value={row.change} />
      </li>)}</ol>
    </OverviewCard>
    <OverviewCard title="排名上升 Top 10" href={GAME_DISCOVERY_SOURCES[risingDataset].url}>
      {highlights.rising.length ? <ol>{highlights.rising.map(row => <li key={row.sourceId} className="flex min-w-0 items-center gap-2 border-b border-slate-50 py-2 text-xs">
        <span className="w-5 shrink-0 text-center tabular-nums text-slate-500">{row.position}</span>
        <div className="min-w-0 flex-1"><GameName title={row.title} url={row.url} /></div>
        <span className="shrink-0 text-slate-500" title="当前名次">{row.metric}</span><ChangeValue value={row.change} />
      </li>)}</ol> : <p className="py-6 text-center text-xs text-slate-500">来源未提供本日上升摘要</p>}
    </OverviewCard>
  </div>
}

function DatasetPanel({ source, dataset, platform, platformSwitch, filters }: {
  source: Source; dataset: GameDiscoveryDataset; platform: MomoPlatform; platformSwitch: ReactNode; filters: ReactNode;
}) {
  const [page, setPage] = useState(0), [retry, setRetry] = useState(0)
  const [data, setData] = useState<Data>(EMPTY), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const config = GAME_DISCOVERY_SOURCES[dataset], compact = source === 'hotwords', overview = isMomoOverview(dataset), rising = isMomoRising(dataset)
  const total = data.total
  const title = compact ? 'MomoRank 热搜访问' : source === 'wechat' ? '微信小游戏' : 'MomoRank'
  const highlights = data.metadata?.highlights || NO_HIGHLIGHTS
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setData(EMPTY)
    fetch(`/api/charts/game-discovery?dataset=${dataset}&page=${page + 1}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || '来源资料读取失败')
        if (!controller.signal.aborted) setData(result)
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '来源资料读取失败') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [dataset, page, retry])
  if (compact) return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={title}>
    <div className="border-b border-teal-100 bg-teal-50 px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1"><h2 title={config.note} className="truncate text-sm font-semibold text-slate-900">{title}</h2><DiscoverySourceLink href={config.url} label={title} /></div>
        <span className="whitespace-nowrap text-[11px] text-teal-700">每日读取一次</span>
      </div>
    </div>
    {data.metadata && <p className="px-4 pt-2 text-[11px] text-slate-400">{time(data.metadata.collected_at)} 更新</p>}
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-slate-600"><span>{error}</span><button type="button" className="btn-secondary whitespace-nowrap" onClick={() => setRetry(value => value + 1)}>重试</button></div>
      : loading ? <div role="status" className="px-4 py-16 text-center text-sm text-slate-500">正在读取资料…</div>
        : !data.items.length ? <div role="status" className="flex min-h-48 items-center justify-center px-5 text-sm text-slate-400">尚未采集到此来源资料</div>
          : <ol className="divide-y divide-slate-100 px-4 py-2">{data.items.map(row => <li key={row.source_id} className="flex min-h-9 items-center gap-3 py-1.5 text-sm">
            <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold ${row.position === 1 ? 'bg-yellow-400 text-yellow-900' : row.position === 2 ? 'bg-gray-300 text-gray-700' : row.position === 3 ? 'bg-orange-400 text-white' : 'bg-gray-100 text-gray-500'}`}>{row.position}</span>
            {row.url ? <a href={row.url} target="_blank" rel="noopener noreferrer" title={row.title} className="min-w-0 flex-1 truncate text-slate-800 hover:text-teal-700">{row.title}</a>
              : <span title={row.title} className="min-w-0 flex-1 truncate text-slate-800">{row.title}</span>}
          </li>)}</ol>}
  </section>
  return <section className={overview ? 'space-y-4' : 'overflow-hidden rounded-xl border border-slate-200 bg-white'} aria-label={title}>
    <div className={`px-5 py-4 ${overview ? 'rounded-xl border border-slate-200 bg-white' : 'border-b border-slate-100'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-1"><h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2><DiscoverySourceLink href={config.url} label={`${title}${config.label}`} /></div>
          {platformSwitch}
        </div>
        <span className="text-xs text-slate-500">{data.metadata ? `${time(data.metadata.collected_at)} 采集` : '暂无采集时间'}</span>
      </div>
      <div className="mt-1 text-xs leading-5 text-slate-500">
        <p>{config.note}{config.provider === 'momorank' ? ' 仅展示免费公开资料。' : ''}</p>
      </div>
      {filters}
    </div>
    {error ? <div role="alert" className="flex items-center justify-center gap-3 px-4 py-12 text-sm text-slate-600"><span>{error}</span><button type="button" className="btn-secondary whitespace-nowrap" onClick={() => setRetry(value => value + 1)}>重试</button></div>
      : loading ? <div role="status" className="min-h-64 px-4 py-16 text-center text-sm text-slate-500">正在读取资料…</div>
        : !data.items.length ? <div role="status" className="px-4 py-16 text-center text-sm text-slate-500">{data.metadata ? '当前页暂无资料' : '尚未采集到此来源资料'}</div>
          : overview ? <Overview data={data} dataset={dataset} platform={platform} />
            : <>
                {source === 'momorank' && !rising && dataset !== 'momo_hot_search' && <section className="border-b border-slate-100 px-5 py-3" aria-label="今日变化"><h3 className="mb-2 text-xs font-semibold text-slate-900">今日变化 · {data.metadata?.source_date?.replaceAll('-', '/')}</h3><Changes groups={highlights.changes} /></section>}
                <div className="overflow-x-auto"><table className="w-full min-w-[560px] table-fixed text-left text-sm">
                  <thead><tr className="bg-slate-50"><th scope="col" className="table-th w-16">{rising ? '序号' : '排名'}</th><th scope="col" className="table-th w-2/5">游戏名称</th>{rising && <th scope="col" className="table-th w-24">当前名次</th>}{source === 'momorank' && dataset !== 'momo_hot_search' && <th scope="col" className="table-th w-24">{rising ? '今日上升' : '今日变化'}</th>}<th scope="col" className="table-th">简介／补充</th></tr></thead>
                  <tbody>{data.items.map(row => <tr key={row.source_id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="table-td tabular-nums text-slate-500">{row.position}</td><td className="table-td"><GameName title={row.title} url={row.url} /></td>
                    {rising && <td className="table-td tabular-nums">{row.metric || '—'}</td>}{source === 'momorank' && dataset !== 'momo_hot_search' && <td className="table-td"><ChangeValue value={row.change} /></td>}
                    <td className="table-td"><span title={[row.summary, ...row.tags].filter(Boolean).join(' · ')} className="block truncate text-slate-500">{[row.summary, ...row.tags].filter(Boolean).join(' · ') || '—'}</span></td>
                  </tr>)}</tbody>
                </table></div><SimplePagination page={page} total={total} disabled={loading} onChange={setPage} />
              </>}
  </section>
}

export default function GameDiscoverySourceTab({ source }: { source: Source }) {
  const [platform, setPlatform] = useState<MomoPlatform>('wechat')
  const [dataset, setDataset] = useState<GameDiscoveryDataset>(source === 'wechat' ? 'wechat_popularity' : source === 'hotwords' ? 'momo_hot_search' : 'momo_overview')
  const tabs: readonly GameDiscoveryDataset[] = source === 'wechat' ? WECHAT_DATASETS : MOMORANK_TABS[platform]
  const platformSwitch = source === 'momorank' ? <div className="inline-flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1" role="group" aria-label="MomoRank平台">
    {(['wechat', 'douyin'] as const).map(key => <button key={key} type="button" aria-pressed={platform === key}
      onClick={() => { setPlatform(key); setDataset(MOMORANK_TABS[key][0]) }}
      className={`h-7 rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [@media(pointer:coarse)]:h-11 ${platform === key ? key === 'wechat' ? 'bg-white text-emerald-700 shadow-sm' : 'bg-slate-700 text-white shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}>
      {key === 'wechat' ? '微信' : '抖音'}
    </button>)}
  </div> : null
  const filters = source !== 'hotwords' ? <>
    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={source === 'wechat' ? '微信小游戏榜单类型' : 'MomoRank榜单类型'}>
      {tabs.map(key => <DiscoveryFilterButton key={key} selected={dataset === key || (isMomoRising(dataset) && isMomoRising(key))} onClick={() => setDataset(key)}>{GAME_DISCOVERY_SOURCES[key].label}</DiscoveryFilterButton>)}
    </div>
    {source === 'momorank' && isMomoRising(dataset) && <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="今日上升所属榜单">
      <span className="text-xs text-slate-500">今日上升</span>{MOMORANK_RISING[platform].map(row => <button key={row.dataset} type="button" aria-pressed={dataset === row.dataset} onClick={() => setDataset(row.dataset)}
        className={`h-8 rounded-md px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [@media(pointer:coarse)]:h-11 ${dataset === row.dataset ? 'bg-emerald-50 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200' : 'text-slate-600 hover:bg-slate-50'}`}>{row.label}</button>)}
    </div>}
  </> : null
  return <DatasetPanel key={dataset} source={source} dataset={dataset} platform={platform} platformSwitch={platformSwitch} filters={filters} />
}
