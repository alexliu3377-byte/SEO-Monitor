'use client'

import { useCallback, useEffect, useState } from 'react'
import { SimplePagination } from '@/components/simple-pagination'

type ContentFeedItem = {
  id: string
  source: string
  sourceId: string
  category: string
  title: string
  url: string
  coverUrl: string | null
  author: string | null
  summary: string | null
  publishedAt: string | null
  firstSeenAt: string
}

type ContentFeedResponse = {
  items: ContentFeedItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const PAGE_SIZE = 20

const SOURCE_OPTIONS = [
  { value: '52pojie,xiaohongshu,xiaoheihe_guide,xiaoheihe_ns,bilibili,ccplay', label: '全部' },
  { value: '52pojie', label: '吾爱破解' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'xiaoheihe_guide', label: '小黑盒攻略' },
  { value: 'xiaoheihe_ns', label: '小黑盒 NS' },
  { value: 'bilibili', label: 'B站' },
  { value: 'ccplay', label: '虫虫助手' },
]

const CATEGORY_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'software', label: '软件' },
  { value: 'game_news', label: '资讯' },
  { value: 'game_activity', label: '活动' },
  { value: 'game_review', label: '评测' },
  { value: 'game_guide', label: '攻略' },
  { value: 'resource_share', label: '资源分享' },
  { value: 'ns_game', label: 'NS 游戏' },
  { value: 'video', label: '视频' },
]

const SOURCE_META: Record<string, { label: string; className: string }> = {
  '52pojie': { label: '吾爱破解', className: 'border-violet-200 bg-violet-50 text-violet-700' },
  xiaohongshu: { label: '小红书', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  xiaoheihe_guide: { label: '小黑盒攻略', className: 'border-slate-300 bg-slate-100 text-slate-700' },
  xiaoheihe_ns: { label: '小黑盒 NS', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  bilibili: { label: 'B站', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  ccplay: { label: '虫虫助手', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
}

const CATEGORY_META: Record<string, { label: string; className: string }> = {
  software: { label: '软件', className: 'bg-blue-50 text-blue-700' },
  game_news: { label: '资讯', className: 'bg-sky-50 text-sky-700' },
  game_activity: { label: '活动', className: 'bg-orange-50 text-orange-700' },
  game_review: { label: '评测', className: 'bg-violet-50 text-violet-700' },
  game_guide: { label: '攻略', className: 'bg-emerald-50 text-emerald-700' },
  resource_share: { label: '资源分享', className: 'bg-rose-50 text-rose-700' },
  ns_game: { label: 'NS 游戏', className: 'bg-indigo-50 text-indigo-700' },
  video: { label: '视频', className: 'bg-sky-50 text-sky-700' },
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`
}

function sourceMeta(source: string) {
  return SOURCE_META[source] ?? { label: source || '其他来源', className: 'border-slate-200 bg-slate-50 text-slate-600' }
}

function categoryMeta(category: string) {
  return CATEGORY_META[category] ?? { label: category || '其他', className: 'bg-slate-100 text-slate-600' }
}

export default function ContentFeedTab() {
  const [sources, setSources] = useState(SOURCE_OPTIONS[0].value)
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<ContentFeedItem[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryToken, setRetryToken] = useState(0)

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    let needsPageReload = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({
      sources,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (category) params.set('category', category)

    try {
      const response = await fetch(`/api/content-feed?${params}`, { signal, cache: 'no-store' })
      const data = await response.json().catch(() => null) as (ContentFeedResponse & { error?: string }) | null
      if (signal?.aborted) return
      if (!response.ok) throw new Error(data?.error || `内容动态读取失败（${response.status}）`)
      if (!data || !Array.isArray(data.items)) throw new Error('内容动态返回格式异常')

      const nextTotalPages = Math.max(1, Number(data.totalPages) || 1)
      const responsePage = Math.max(1, Number(data.page) || page)
      const nextPage = Math.min(responsePage, nextTotalPages)
      if (nextPage !== page) {
        needsPageReload = true
        setPage(nextPage)
        return
      }

      setItems(data.items)
      setTotal(Number(data.total) || 0)
      setTotalPages(nextTotalPages)
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') {
        setItems([])
        setError((loadError as Error).message || '内容动态读取失败')
      }
    } finally {
      if (!signal?.aborted && !needsPageReload) setLoading(false)
    }
  }, [category, page, sources])

  useEffect(() => {
    const controller = new AbortController()
    loadItems(controller.signal)
    return () => controller.abort()
  }, [loadItems, retryToken])

  return (
    <section aria-busy={loading} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">内容趋势</h2>
          <p className="mt-1 text-xs text-slate-400">按来源查看软件、资源分享、攻略和视频更新；页面只读取已缓存资料。</p>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-1 overflow-x-auto pb-1" role="tablist" aria-label="内容来源">
            {SOURCE_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={sources === option.value}
                onClick={() => { setSources(option.value); setPage(1) }}
                className={`h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${sources === option.value ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="min-w-0 flex-1 sm:w-32 sm:flex-none">
            <span className="sr-only">类型</span>
            <select
              value={category}
              onChange={event => {
                setCategory(event.target.value)
                setPage(1)
              }}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            >
              {CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed">
          <caption className="sr-only">公开内容动态列表</caption>
          <thead className="bg-slate-50/80">
            <tr className="text-left text-xs font-medium text-slate-500">
              <th className="w-32 px-4 py-2.5 sm:px-5">来源</th>
              <th className="px-3 py-2.5">标题</th>
              <th className="w-24 px-3 py-2.5">类型</th>
              <th className="w-32 px-3 py-2.5">作者</th>
              <th className="w-48 px-3 py-2.5">发布时间</th>
              <th className="w-24 px-4 py-2.5 text-right sm:px-5">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 7 }).map((_, index) => (
                <tr key={index} className="animate-pulse motion-reduce:animate-none">
                  <td colSpan={6} className="px-5 py-3">
                    {index === 0 && <span className="sr-only" role="status">正在读取内容动态</span>}
                    <div className="h-4 rounded bg-slate-100" />
                  </td>
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={6} className="px-5 py-16 text-center">
                  <p role="alert" className="text-sm font-medium text-red-600">{error}</p>
                  <button
                    type="button"
                    onClick={() => setRetryToken(value => value + 1)}
                    className="mt-3 h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    重新读取
                  </button>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-20 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8l6 6v8a2 2 0 0 1-2 2ZM13 4v6h6M7 14h8M7 17h5" /></svg>
                  </div>
                  <p className="mt-3 text-sm font-medium text-slate-700">没有符合条件的内容</p>
                  <p className="mt-1 text-xs text-slate-400">可以切换来源或类型，稍后也会继续补充新资料。</p>
                </td>
              </tr>
            ) : items.map(item => {
              const source = sourceMeta(item.source)
              const itemCategory = categoryMeta(item.category)
              const dateIsPublished = Boolean(item.publishedAt)
              return (
                <tr key={item.id} className="group hover:bg-emerald-50/30">
                  <td className="px-4 py-2.5 sm:px-5">
                    <span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium ${source.className}`}>{source.label}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={[item.title, item.summary].filter(Boolean).join('\n')}
                      className="block truncate text-sm font-semibold text-slate-900 transition group-hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      {item.title}
                    </a>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${itemCategory.className}`}>{itemCategory.label}</span>
                  </td>
                  <td className="truncate px-3 py-2.5 text-xs text-slate-600" title={item.author || undefined}>{item.author || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-600" title={dateIsPublished ? '原文发布时间' : '系统首次发现时间'}>
                    {!dateIsPublished && <span className="mr-1 text-slate-400">发现</span>}{formatDate(item.publishedAt || item.firstSeenAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-5">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 min-w-[72px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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

      {!loading && !error && <SimplePagination page={page - 1} total={total} disabled={loading} onChange={nextPage => setPage(nextPage + 1)} />}
    </section>
  )
}
