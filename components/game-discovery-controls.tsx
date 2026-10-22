'use client'

import type { ReactNode } from 'react'

export function DiscoveryFilterButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={selected} onClick={onClick}
    className={`h-8 whitespace-nowrap rounded-md border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [@media(pointer:coarse)]:h-11 ${selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
    {children}
  </button>
}

export function DiscoverySourceLink({ href, label }: { href: string; label: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`打开${label}来源（新窗口）`} title="打开资料来源"
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
    <span aria-hidden="true">↗</span>
  </a>
}
