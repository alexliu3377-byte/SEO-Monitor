'use client'

import { useMemo, useState } from 'react'
import { SimplePagination, PAGE_SIZE } from './simple-pagination'
import { buildGroupMaps, groupSortedRows } from '@/lib/company-groups'

interface Site {
  id: string
  domain: string
  name: string
  category: 'large' | 'medium' | 'small'
  crawl_type: 'html'
  focus_level: number
  list_url: string
  title_selector: string
  date_selector: string
  source_types: string
  url_selectors: string
  capture_source_url: boolean
  crawl_frequency: 'daily'
  enable_version_clean: boolean
  version_suffixes: string[]
  friend_links: string[]
  is_enabled: boolean
  has_rank_data: boolean
  has_rank_title: boolean
  track_pc_rank: boolean | null
  has_index_pages: boolean
  created_at: string
}

interface SiteTableProps {
  sites: Site[]
  allSites?: Site[]
  onEdit: (site: Site) => void
  onDelete: (site: Site) => void
  onToggle: (site: Site) => void
  onToggleRank: (site: Site) => void
  onToggleRankTitle: (site: Site) => void
  onTogglePcRank: (site: Site) => void
  onToggleIndexPages: (site: Site) => void
}

const categoryLabel: Record<string, string> = {
  large: '大站',
  medium: '中站',
  small: '小站',
}

const focusConfig: Record<number, { label: string; className: string }> = {
  1: { label: '重点', className: 'bg-red-50 text-red-600' },
  2: { label: '侧重', className: 'bg-orange-50 text-orange-600' },
  3: { label: '普通', className: 'bg-gray-50 text-gray-400' },
}

const frequencyLabel: Record<string, string> = {
  daily: '每天',
}

export default function SiteTable({ sites, allSites, onEdit, onDelete, onToggle, onToggleRank, onToggleRankTitle, onTogglePcRank, onToggleIndexPages }: SiteTableProps) {
  const [page, setPage] = useState(0)
  const [sortCol, setSortCol] = useState<'isEnabled' | 'hasRankData' | 'hasRankTitle' | 'hasIndexPages' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(col: 'isEnabled' | 'hasRankData' | 'hasRankTitle' | 'hasIndexPages', dir: 'asc' | 'desc') {
    if (sortCol === col && sortDir === dir) { setSortCol(null) }
    else { setSortCol(col); setSortDir(dir) }
    setPage(0)
  }

  const { idMap, colorMap: groupColorMap } = useMemo(() => buildGroupMaps(allSites ?? sites), [allSites, sites])
  const CAT_ORDER: Record<string, number> = { large: 1, medium: 2, small: 3 }
  const sorted = groupSortedRows(
    [...sites].sort((a, b) => {
      if (a.focus_level !== b.focus_level) return a.focus_level - b.focus_level
      return (CAT_ORDER[a.category] ?? 3) - (CAT_ORDER[b.category] ?? 3)
    }),
    idMap,
    r => [r.focus_level, CAT_ORDER[r.category] ?? 3]
  )
  const sortedDisplay = sortCol === null ? sorted : [...sorted].sort((a, b) => {
    const valOf = (s: typeof sorted[0]) =>
      sortCol === 'isEnabled' ? (s.is_enabled ? 1 : 0)
      : sortCol === 'hasRankTitle' ? (s.has_rank_title ? 1 : 0)
      : sortCol === 'hasIndexPages' ? (s.has_index_pages ? 1 : 0)
      : (s.has_rank_data ? 1 : 0)
    return sortDir === 'asc' ? valOf(a) - valOf(b) : valOf(b) - valOf(a)
  })
  // page 是本组件内部状态，筛选/搜索导致父组件传入的 sites 变短时不会自动
  // 归零——如果用户之前翻到了后面的页码，再搜出一个只有几条结果的小列表，
  // 原来的页码会指向结果范围之外，slice 出来是空数组，表格直接一行都不
  // 显示（而且 sorted.length 不为0，连"暂无网站"的兜底提示都不会出现，
  // 表现就是搜索框显示"共N条"但表格完全空白）。渲染时钳到合法范围内。
  const maxPage = Math.max(0, Math.ceil(sortedDisplay.length / PAGE_SIZE) - 1)
  const clampedPage = Math.min(page, maxPage)
  const paged = sortedDisplay.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)

  const sortIcons = (col: 'isEnabled' | 'hasRankData' | 'hasRankTitle' | 'hasIndexPages') => {
    const isAsc = sortCol === col && sortDir === 'asc'
    const isDesc = sortCol === col && sortDir === 'desc'
    return (
      <span className="flex flex-col items-center gap-px select-none">
        <svg onClick={() => handleSort(col, 'asc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor" className={`cursor-pointer ${isAsc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 0L8 5H0Z"/></svg>
        <svg onClick={() => handleSort(col, 'desc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor" className={`cursor-pointer ${isDesc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}><path d="M4 5L0 0H8Z"/></svg>
      </span>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        暂无网站，点击右上角按钮新增
      </div>
    )
  }

  return (
    <>
    <div className="overflow-x-auto">
      <table aria-label="数据表格" className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="table-th">域名</th>
            <th className="table-th">名称</th>
            <th className="table-th text-center">分类</th>
            <th className="table-th text-center">关注</th>
            <th className="table-th text-center">版本清洗</th>
            <th className="table-th"><div className="flex items-center justify-center gap-1">关键词{sortIcons('isEnabled')}</div></th>
            <th className="table-th"><div className="flex items-center justify-center gap-1">涨跌{sortIcons('hasRankData')}</div></th>
            <th className="table-th"><div className="flex items-center justify-center gap-1">排名{sortIcons('hasRankTitle')}</div></th>
            <th className="table-th"><div className="flex items-center justify-center gap-1">收录页面{sortIcons('hasIndexPages')}</div></th>
            <th className="table-th text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {paged.map((site) => (
            <tr key={site.id} className="hover:bg-gray-100 transition-colors" style={{ borderLeft: groupColorMap.has(site.domain) ? `4px solid ${groupColorMap.get(site.domain)}` : '4px solid transparent' }}>
              <td className="table-td">
                <a
                  href={`https://${site.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-600 hover:underline font-medium"
                >
                  {site.domain}
                </a>
              </td>
              <td className="table-td text-gray-500">{site.name}</td>
              <td className="table-td text-center">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium bg-blue-50 text-blue-600">
                  {categoryLabel[site.category]}
                </span>
              </td>
              <td className="table-td text-center">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium ${focusConfig[site.focus_level]?.className ?? 'bg-gray-50 text-gray-400'}`}>
                  {focusConfig[site.focus_level]?.label ?? '普通'}
                </span>
              </td>
              <td className="table-td text-center">
                {site.enable_version_clean
                  ? <span className="text-green-600 font-medium">启用</span>
                  : <span className="text-gray-300">—</span>}
              </td>
              <td className="table-td text-center">
                <button
                  onClick={() => onToggle(site)}
                  className={`relative w-9 h-[18px] rounded-full transition-colors ${site.is_enabled ? 'bg-green-600' : 'bg-gray-200'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${site.is_enabled ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                </button>
              </td>
              <td className="table-td text-center">
                <button
                  onClick={() => onToggleRank(site)}
                  className={`relative w-9 h-[18px] rounded-full transition-colors ${site.has_rank_data ? 'bg-purple-500' : 'bg-gray-200'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${site.has_rank_data ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                </button>
              </td>
              <td className="table-td text-center">
                {/* 固定宽度盒子居中，PC小按钮的位置用一个固定宽度的槽位占好——
                   不管这个槽位里有没有渲染按钮，主开关都锚定在盒子左边，不会
                   因为PC按钮出不出现而左右跑位（2026-08-26 用户反馈对齐问题）。 */}
                <div className="inline-flex items-center gap-1.5 w-[58px]">
                  <button
                    onClick={() => onToggleRankTitle(site)}
                    className={`relative w-9 h-[18px] rounded-full transition-colors flex-shrink-0 ${site.has_rank_title ? 'bg-orange-500' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${site.has_rank_title ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                  </button>
                  <span className="w-6 flex-shrink-0">
                    {site.has_rank_title && (
                      <button
                        onClick={() => onTogglePcRank(site)}
                        title={site.track_pc_rank ? '同时抓PC端排名，点击关闭（只保留移动端）' : '目前只抓移动端，点击开启PC端'}
                        className={`text-[10px] leading-none px-1 py-0.5 rounded border transition-colors ${site.track_pc_rank ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}
                      >
                        PC
                      </button>
                    )}
                  </span>
                </div>
              </td>
              <td className="table-td text-center">
                <button
                  onClick={() => onToggleIndexPages(site)}
                  className={`relative w-9 h-[18px] rounded-full transition-colors ${site.has_index_pages ? 'bg-teal-500' : 'bg-gray-200'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${site.has_index_pages ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                </button>
              </td>
              <td className="table-td text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => onEdit(site)}
                    className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => onDelete(site)}
                    className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded px-1.5 py-0.5 hover:border-red-200 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <SimplePagination page={clampedPage} total={sortedDisplay.length} onChange={setPage} />
    </>
  )
}
