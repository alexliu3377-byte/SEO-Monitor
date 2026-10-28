'use client'

import { useState } from 'react'
import type { SystemMapView } from '@/lib/system-map'

export default function SystemMapClient({ maps }: { maps: SystemMapView[] }) {
  const [viewId, setViewId] = useState(maps[0].id)
  const [selectedId, setSelectedId] = useState(maps[0].lanes[0].nodes[0].id)
  const view = maps.find(map => map.id === viewId) ?? maps[0]
  const selected = view.lanes.flatMap(lane => lane.nodes).find(node => node.id === selectedId) ?? view.lanes[0].nodes[0]

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">系统地图</h1>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">仅超级管理员</span>
        </div>
        <p className="mt-2 text-sm text-slate-500">了解系统在哪里运行、资料如何流动，以及代码如何发布。点击节点查看职责与代码依据。</p>
        <p className="mt-1 text-xs text-slate-500">整理日期：2026/10/28（MYT） · 代码结构快照，非线上运行状态</p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="地图视图">
        {maps.map(map => (
          <button key={map.id} type="button" aria-pressed={view.id === map.id}
            onClick={() => { setViewId(map.id); setSelectedId(map.lanes[0].nodes[0].id) }}
            className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${view.id === map.id ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {map.title}
          </button>
        ))}
      </div>

      <section aria-label={view.title} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold text-slate-900">{view.title}</h2>
        <p className="mt-1 text-sm text-slate-500">{view.description}</p>
        <div className="mt-6 space-y-6">
          {view.lanes.map(lane => (
            <div key={lane.title}>
              <h3 className="mb-3 text-xs font-semibold tracking-wide text-slate-500">{lane.title}</h3>
              <ol className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
                {lane.nodes.map((node, index) => (
                  <li key={node.id} className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row">
                    {index > 0 && <span aria-hidden="true" className="self-center text-slate-400"><span className="lg:hidden">↓</span><span className="hidden lg:inline">→</span></span>}
                    <button type="button" aria-pressed={selected.id === node.id} aria-controls="system-map-detail" onClick={() => setSelectedId(node.id)}
                      className={`w-full min-w-0 flex-1 rounded-lg border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${selected.id === node.id ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-slate-200 bg-slate-50 hover:border-emerald-300'}`}>
                      <span className="block text-xs text-slate-500">{node.location}</span>
                      <span className="mt-2 block text-sm font-semibold text-slate-900">{node.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">{node.summary}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">{view.note}</p>
      </section>

      <section id="system-map-detail" aria-live="polite" aria-atomic="true" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold text-slate-900">{selected.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{selected.details}</p>
        <h3 className="mt-4 text-xs font-medium text-slate-500">代码 / 文档依据（仓库相对路径）</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {selected.evidence.map(path => <li key={path} className="max-w-full break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">{path}</li>)}
        </ul>
      </section>
    </div>
  )
}
