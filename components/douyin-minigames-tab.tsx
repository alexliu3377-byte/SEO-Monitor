'use client'

import { useEffect, useState } from 'react'
import { SimplePagination } from './simple-pagination'
import { DOUYIN_MINIGAME_SOURCE_URL, MINIGAME_BOARDS, MINIGAME_BOARD_LABELS, type MinigameBoard } from '@/lib/douyin-minigames'

type Result = { items: Array<{ rank: number; game_id: string; title: string; summary: string | null }>; total: number; collectedAt: string | null }
const EMPTY: Result = { items: [], total: 0, collectedAt: null }
function localTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

export default function DouyinMinigamesTab() {
  const [board, setBoard] = useState<MinigameBoard>('new')
  const [page, setPage] = useState(0), [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result>(EMPTY)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const total = result.total
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setResult(EMPTY)
    fetch(`/api/charts/douyin-minigames?board=${board}&page=${page + 1}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '小游戏榜单读取失败')
        if (!controller.signal.aborted) setResult(data)
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '小游戏榜单读取失败') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [board, page, attempt])
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="抖音小游戏榜单">
    <div className="border-b border-slate-100 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold text-slate-900">抖音小游戏</h2>
          <a href={DOUYIN_MINIGAME_SOURCE_URL} target="_blank" rel="noopener noreferrer" aria-label="打开抖音小游戏官方榜单来源（新窗口）" title="打开官方榜单来源" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><span aria-hidden="true">↗</span></a>
        </div>
        <span className="text-xs text-slate-500">{result.collectedAt ? `${localTime(result.collectedAt)} 采集` : '暂无采集时间'}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">官方榜单，每榜最多前 100 款；排名不代表百度搜索量，小游戏不一定有独立安装包。</p>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="小游戏榜单类型">
        {MINIGAME_BOARDS.map(key => <button key={key} type="button" aria-pressed={board === key} onClick={() => { setBoard(key); setPage(0) }} className={`h-8 whitespace-nowrap rounded-md border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [@media(pointer:coarse)]:h-11 ${board === key ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{MINIGAME_BOARD_LABELS[key]}</button>)}
      </div>
    </div>
    {error ? <div role="alert" className="flex items-center justify-center gap-3 px-5 py-12 text-sm text-slate-600"><span>{error}</span><button type="button" className="btn-secondary whitespace-nowrap" onClick={() => setAttempt(value => value + 1)}>重试</button></div>
      : loading ? <div role="status" className="px-5 py-16 text-center text-sm text-slate-500">正在读取小游戏榜单…</div>
        : result.items.length === 0 ? <div role="status" className="px-5 py-16 text-center text-sm text-slate-500">{result.collectedAt ? '当前页暂无资料' : '尚未采集到小游戏榜单'}</div>
          : <>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left text-sm">
                <thead><tr className="bg-slate-50"><th scope="col" className="table-th w-16">排名</th><th scope="col" className="table-th w-2/5">游戏名称</th><th scope="col" className="table-th">简介</th></tr></thead>
                <tbody>{result.items.map(item => <tr key={item.game_id} className="border-t border-slate-100 hover:bg-slate-50"><td className="table-td tabular-nums text-slate-500">{item.rank}</td><td className="table-td"><span title={item.title} className="block truncate font-medium text-slate-900">{item.title}</span></td><td className="table-td"><span title={item.summary || undefined} className="block truncate text-slate-500">{item.summary || '—'}</span></td></tr>)}</tbody>
              </table>
            </div>
            <SimplePagination page={page} total={total} disabled={loading} onChange={setPage} />
          </>}
  </section>
}
