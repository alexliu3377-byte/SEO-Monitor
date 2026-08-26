'use client'

import { useMemo, useState } from 'react'

const SITE_COLORS = [
  '#22c55e', '#3b82f6', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#f59e0b', '#ef4444',
]

export interface AZPickerSite {
  id: string
  domain: string
  name: string
  pcWeight?: number | null
  mobileWeight?: number | null
  // 2026-08-26 研究报告"各站点分析"加的——数据量明显更多的站点用浅色底+
  // 描边区分一下，不影响其它调用方（不传就是原来的纯灰边样式）。
  highlighted?: boolean
}

const GROUPS = [
  { label: 'a–m', test: (d: string) => /^[a-m]/i.test(d) },
  { label: 'n–z', test: (d: string) => /^[n-z]/i.test(d) },
  { label: '0–9', test: (d: string) => /^\d/.test(d) },
]

// 抽自首页"首页快报"的 a-m/n-z/0-9 分组卡片选择器（app/(dashboard)/page.tsx），
// 站点多的场景（研究中心的竞品成效/各站点分析）复用同一套视觉，额外加了搜索框
// （首页那版原本没有）。
export default function SiteAZPicker({ sites, selectedId, onSelect }: {
  sites: AZPickerSite[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sites
    return sites.filter(s => s.domain.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
  }, [sites, query])

  const sortedAll = useMemo(() => [...sites].sort((a, b) => a.domain.localeCompare(b.domain)), [sites])
  function siteColor(siteId: string): string {
    const idx = sortedAll.findIndex(s => s.id === siteId)
    return SITE_COLORS[idx % SITE_COLORS.length]
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="搜索域名或站点名…"
        className="w-full max-w-xs text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-300 py-6 text-center">没有匹配的站点</p>
      ) : (
        <div className="space-y-2">
          {GROUPS.map(g => {
            const groupSites = filtered.filter(s => g.test(s.domain)).sort((a, b) => a.domain.localeCompare(b.domain))
            if (groupSites.length === 0) return null
            return (
              <div key={g.label} className="flex items-start gap-3">
                <span className="text-xs text-gray-400 font-mono w-8 flex-shrink-0 pt-1.5">{g.label}</span>
                <div className="w-px self-stretch bg-gray-200 flex-shrink-0" />
                <div className="flex flex-wrap gap-2">
                  {groupSites.map(s => {
                    const color = siteColor(s.id)
                    const isSelected = selectedId === s.id
                    return (
                      <button
                        key={s.id}
                        onClick={() => onSelect(s.id)}
                        className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          isSelected
                            ? 'border-transparent text-white font-medium'
                            : s.highlighted
                              ? 'border-amber-200 bg-amber-50 text-gray-600 hover:border-amber-300'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                        style={isSelected ? { backgroundColor: color } : {}}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isSelected ? '#fff' : color }} />
                        <span className="flex flex-col items-start leading-tight">
                          <span>{s.domain}</span>
                          {(s.pcWeight != null || s.mobileWeight != null) && (
                            <span className={`text-[10px] ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>
                              PC{s.pcWeight ?? '—'} · M{s.mobileWeight ?? '—'}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
