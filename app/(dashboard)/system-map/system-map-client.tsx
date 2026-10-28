'use client'

import Link from 'next/link'
import { useState } from 'react'
import { COLLECTION_GROUPS, type CollectionSource } from '@/lib/system-map'

const colors: Record<string, string> = {
  bilibili: 'bg-sky-100 text-sky-700', 'xhh-guide': 'bg-slate-800 text-white',
  'xhh-ns': 'bg-slate-800 text-white', xiaohongshu: 'bg-rose-100 text-rose-700',
  '52pojie': 'bg-amber-100 text-amber-800', '4399': 'bg-lime-100 text-lime-800',
  ccplay: 'bg-violet-100 text-violet-700',
}
const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600'

function Arrow() {
  return <div aria-hidden="true" className="flex items-center justify-center text-emerald-500"><svg className="hidden h-6 w-8 xl:block" viewBox="0 0 32 24" fill="none"><path d="M0 12h29m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" /></svg><span className="py-1 xl:hidden">↓</span></div>
}

export default function SystemMapClient({ maps }: { maps: CollectionSource[] }) {
  const [group, setGroup] = useState('content')
  const [selectedId, setSelectedId] = useState('bilibili')
  const [query, setQuery] = useState('')
  const category = COLLECTION_GROUPS.find(item => item.id === group)!
  const sources = maps.filter(item => item.group === group && [item.name, item.entry, ...item.fields, item.destination].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const selected = sources.find(item => item.id === selectedId) ?? sources[0]
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-widest text-emerald-700">系统地图 / 采集资料</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">资料从哪里来</h1>
          <p className="mt-2 text-sm text-slate-500">选一个来源，沿着连线看它采到了什么、如何处理、最后用在哪里。</p>
        </div>
        <div className="text-xs leading-6 text-slate-500"><span className="font-medium text-slate-700">2026/10/28</span> 代码核对<br />计划时间均为 MYT · 非实时运行状态</div>
      </header>

      <nav aria-label="资料类型" className="flex flex-wrap gap-1 border-b border-slate-200">
        {COLLECTION_GROUPS.map(item => <button key={item.id} type="button" aria-pressed={group === item.id}
          onClick={() => { setGroup(item.id); setSelectedId(maps.find(row => row.group === item.id)!.id); setQuery('') }}
          className={`min-h-12 border-b-2 px-3 text-sm font-medium ${focus} ${group === item.id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
          {item.title}<span className="ml-2 text-xs opacity-60">{maps.filter(row => row.group === item.id).length}</span>
        </button>)}
      </nav>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="选择资料来源" className="border-b border-slate-200 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-800">资料来源</h2><span className="text-xs text-slate-400">{sources.length} 条链路</span></div>
          <label className="sr-only" htmlFor="source-search">筛选当前分类的来源或资料</label>
          <input id="source-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索来源或资料…"
            className={`mb-3 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 ${focus}`} />
          <label className="sr-only" htmlFor="mobile-source">选择资料来源</label>
          <select id="mobile-source" value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)} className={`min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 lg:hidden ${focus}`}>
            {!sources.length && <option value="">没有匹配来源</option>}
            {sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <div className="hidden grid-cols-1 gap-1.5 lg:grid">
            {sources.map(item => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} aria-controls="collection-flow"
              onClick={() => setSelectedId(item.id)}
              className={`flex min-h-16 items-center gap-3 rounded-xl border p-2.5 text-left ${focus} ${selected?.id === item.id ? 'border-emerald-300 bg-white shadow-sm' : 'border-transparent hover:bg-white'}`}>
              <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${colors[item.id] ?? 'bg-emerald-100 text-emerald-800'}`}>{item.mark}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">{item.name}</span><span className="mt-0.5 block text-[11px] text-slate-500">{item.executor === '这台 Windows 电脑' ? 'Windows 电脑采集' : item.executor.startsWith('GitHub') ? 'GitHub 云端采集' : '页面按需查询'}</span></span>
              {selected?.id === item.id && <span aria-hidden="true" className="text-emerald-600">→</span>}
            </button>)}
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">{category.description}</p>
        </aside>

        <section id="collection-flow" aria-label="采集资料流向" className="min-w-0">
          {!selected ? <div className="p-10 text-center"><p className="text-sm text-slate-600">此分类没有匹配的资料来源</p><button type="button" onClick={() => setQuery('')} className={`mt-4 min-h-11 px-4 text-sm text-emerald-700 ${focus}`}>清除搜索</button></div> : <>
            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
              <div className="flex items-center gap-3"><span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${colors[selected.id] ?? 'bg-emerald-100 text-emerald-800'}`}>{selected.mark}</span>
                <div><h2 className="text-lg font-bold text-slate-900">{selected.name}</h2><p className="mt-1 break-words text-xs text-slate-500">{selected.entry}</p></div>
              </div>
            </div>
            <div className="px-5 py-6 sm:px-6" style={{ backgroundImage: 'radial-gradient(#cbd5e1 0.6px, transparent 0.6px)', backgroundSize: '16px 16px', backgroundColor: '#f8fafc' }}>
              <p className="mb-4 text-xs font-medium text-slate-500">从来源到使用页面</p>
              <div className="grid grid-cols-1 items-stretch xl:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)]">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-400">01 · 采到的资料</p>
                  <ul className="mt-3 space-y-2">{selected.fields.map(field => <li key={field} className="flex gap-2 text-sm text-slate-700"><span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{field}</li>)}</ul>
                </div>
                <Arrow />
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-400">02 · 处理过程</p>
                  <ol className="mt-3 space-y-2">{selected.process.split(' → ').map((step, index) => <li key={step} className="flex items-start gap-2 text-sm text-slate-700"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-500">{index + 1}</span>{step}</li>)}</ol>
                </div>
                <Arrow />
                <div className="flex flex-col rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                  <p className="text-[11px] font-semibold tracking-wide text-emerald-700">03 · 在哪里使用</p>
                  <p className="mt-3 text-base font-semibold leading-7 text-emerald-950">{selected.destination}</p>
                  <Link href={selected.href} className={`mt-auto inline-flex min-h-11 items-center gap-2 pt-3 text-xs font-medium text-emerald-700 underline-offset-4 hover:underline ${focus}`}>查看使用页面 <span aria-hidden="true">↗</span></Link>
                </div>
              </div>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <div><dt className="text-xs text-slate-500">在哪里执行</dt><dd className="mt-1 text-sm font-medium text-slate-800">{selected.executor}</dd></div>
                <div><dt className="text-xs text-slate-500">何时采集</dt><dd className="mt-1 text-sm font-medium text-slate-800">{selected.schedule}</dd></div>
              </dl>
              <div className="border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2.5"><h3 className="text-xs font-semibold text-amber-900">理解这份资料时要注意</h3><p className="mt-1 text-xs leading-6 text-slate-700">{selected.note}</p></div>
              <details key={selected.id} className="border-t border-slate-100 pt-3">
                <summary className={`cursor-pointer py-2 text-xs font-medium text-slate-500 ${focus}`}>查看存储位置与代码依据</summary>
                <p className="mt-2 break-words text-xs leading-6 text-slate-600">存储：{selected.storage}</p>
                <ul className="mt-2 space-y-1">{selected.evidence.map(path => <li key={path} className="break-all font-mono text-[11px] leading-5 text-slate-500">{path}</li>)}</ul>
              </details>
            </div>
          </>}
        </section>
      </div>
      <p className="text-xs leading-5 text-slate-500">这里解释资料来源，不展示实时成功率。计划任务可能排队；Windows 夜间任务的开关配置也会影响实际排程。查看地图不会触发采集。</p>
    </div>
  )
}
