'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useUser } from '@/lib/user-context'
import { getBrowserClient } from '@/lib/supabase-browser'
import { buildGroupColorMap } from '@/lib/company-groups'
import { BaiduCookiePoolManager } from '@/components/baidu-cookie-pool'

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface TaskMember { user_id: string; username: string; member_type?: 'app' | 'game' | 'both' }
interface TaskGroup { id: string; name: string; type: string; created_at: string; members: TaskMember[]; rank_domains: string[]; new_domains: string[]; associated_domains: string[]; site_domains: string[] }
interface UserOption { id: string; email: string; username: string | null; role: string }
interface SiteInfo { id: string; domain: string; name: string; category: 'large' | 'medium' | 'small'; is_enabled: boolean; has_rank_data: boolean; friend_links?: string[] | null }

interface NewWord { keyword: string; count: number; siteCount: number; sites: string[]; last_date: string; first_date: string }
interface WordLibEntry extends NewWord { longTailCount: number }
interface RankWord { keyword: string; siteCount: number; volume: number; sites: string[]; last_date: string; first_date: string; rankDays: number }
interface StreakWord { keyword: string; streak: number; domain: string; volume: number; first_date: string; last_date: string }
interface CrossWord { keyword: string; volume: number; last_date: string; first_date: string; newSites: string[]; rankSites: string[] }

interface ClaimedKeyword {
  id: string; keyword: string; source: string
  search_volume: number; status: string; created_at: string
  operation_type: string | null; final_keyword: string | null; page_url: string | null
}

type RightTab = 'recommend' | 'search' | 'cross' | 'rank' | 'streak' | 'newWords' | 'wordLib' | 'rankdown'
type RecSubTab = 'rankdown' | 'rankup'
type Badge = 'new' | 'updated' | null
interface DetailRow { date: string; domain: string }

const PAGE_SIZE = 20

// ── Pure helpers ───────────────────────────────────────────────────────────────

function getMYDate(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}
function fmtVol(v: number) {
  if (!v || v <= 0) return '—'
  return v.toLocaleString()
}
function fmtDate(d: string) { return d ? d.slice(5).replace('-', '/') : '—' }
function normalizeUrl(raw: string): string {
  return raw.trim().replace(/^https?:\/\/(www\.|m\.)?/, '')
}

function getBadge(first_date: string, last_date: string, yesterday: string): Badge {
  if (!last_date || last_date < yesterday) return null
  if (first_date >= yesterday) return 'new'
  return 'updated'
}
function getStreakBadge(streak: number, last_date: string, yesterday: string): Badge {
  if (!last_date || last_date < yesterday) return null
  return streak <= 2 ? 'new' : 'updated'
}
function badgePriority(first_date: string, last_date: string, yesterday: string): number {
  if (!last_date || last_date < yesterday) return 2
  if (first_date >= yesterday) return 0
  return 1
}
function sortByDate<T extends { last_date: string; first_date: string }>(
  list: T[], yesterday: string, secondary: (a: T, b: T) => number
): T[] {
  return [...list].sort((a, b) => {
    if (a.last_date !== b.last_date) return b.last_date.localeCompare(a.last_date)
    const bp = badgePriority(a.first_date, a.last_date, yesterday) - badgePriority(b.first_date, b.last_date, yesterday)
    if (bp !== 0) return bp
    return secondary(a, b)
  })
}
function dedupDetailRows(rows: DetailRow[]): DetailRow[] {
  const seen = new Set<string>()
  return rows
    .filter(r => { const k = `${r.date}|${r.domain}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => b.date.localeCompare(a.date) || a.domain.localeCompare(b.domain))
}

// ── UI components (defined outside to avoid remounting) ────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10 text-gray-400 gap-2 text-sm">
      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      加载中...
    </div>
  )
}

function BadgeChip({ badge }: { badge: Badge }) {
  if (!badge) return null
  if (badge === 'new')
    return <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold bg-green-500 text-white leading-none">今日</span>
  return <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold bg-amber-400 text-white leading-none">更新</span>
}

function DateCell({ date, today, yesterday, badge, includeYesterday }: {
  date: string; today: string; yesterday: string; badge: Badge; includeYesterday?: boolean
}) {
  const isRecent = date === today || (!!includeYesterday && date === yesterday)
  return (
    <td className="px-3 py-2 w-24 whitespace-nowrap">
      <div className={`flex items-center gap-1 flex-wrap ${isRecent ? 'text-green-600' : 'text-gray-400'}`}>
        <span className={`text-xs ${isRecent ? 'font-semibold' : ''}`}>{fmtDate(date)}</span>
        <BadgeChip badge={badge} />
      </div>
    </td>
  )
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-50 text-sm">
      <button onClick={() => onPage(page - 1)} disabled={page === 0}
        className="px-3 py-1 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 disabled:opacity-30 text-xs">上一页</button>
      <span className="text-gray-400 text-xs">{page + 1} / {pages}　共 {total} 条</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= pages - 1}
        className="px-3 py-1 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 disabled:opacity-30 text-xs">下一页</button>
    </div>
  )
}

interface KwRowProps {
  keyword: string; today: string; yesterday: string; badge: Badge
  dateCell: React.ReactNode; claimed: boolean
  onClaim: () => void; onView: () => void
  children: React.ReactNode
}
function KwRow({ keyword, claimed, onClaim, onView, dateCell, children }: KwRowProps) {
  return (
    <tr onDoubleClick={onClaim}
      className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
      title={claimed ? '已认领' : '双击认领'}>
      {dateCell}
      <td className="px-2 py-2 max-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-sm text-gray-800 truncate select-text cursor-text" title={keyword}
            onDoubleClick={e => { e.stopPropagation(); onClaim() }}>{keyword}</span>
          {claimed && <span className="text-[10px] text-green-500 flex-shrink-0">✓</span>}
        </div>
      </td>
      {children}
      <td className="px-2 py-2 text-right whitespace-nowrap">
        <button onClick={e => { e.stopPropagation(); onView() }}
          className="text-xs text-blue-400 hover:text-blue-600 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-300 transition-colors">查看</button>
      </td>
    </tr>
  )
}

// ── MemberModal ─────────────────────────────────────────────────────────────────

interface MemberModalProps {
  mode: 'create' | 'edit'
  onClose: () => void
  userOptions: UserOption[]
  allSites: SiteInfo[]
  name: string
  onNameChange: (v: string) => void
  siteDomains: Set<string>
  onSiteDomainsChange: (s: Set<string>) => void
  selUsers: Set<string>
  onSelUsersChange: (s: Set<string>) => void
  mTypes: Record<string, 'app' | 'game'>
  onMTypesChange: (t: Record<string, 'app' | 'game'>) => void
  rankDomains: Set<string>
  onRankDomainsChange: (s: Set<string>) => void
  newDomains: Set<string>
  onNewDomainsChange: (s: Set<string>) => void
  onSubmit: () => void
  busy: boolean
}

function MemberModal({
  mode, onClose, userOptions, allSites,
  name, onNameChange,
  siteDomains, onSiteDomainsChange,
  selUsers, onSelUsersChange,
  mTypes, onMTypesChange,
  rankDomains, onRankDomainsChange,
  newDomains, onNewDomainsChange,
  onSubmit, busy,
}: MemberModalProps) {
  const isCreate = mode === 'create'
  const [siteSearch, setSiteSearch] = useState('')
  const CAT_LABELS: Record<string, string> = { large: '大站', medium: '中站', small: '小站' }
  const cats = ['large', 'medium', 'small'] as const

  function toggleSite(domain: string) {
    const next = new Set(siteDomains)
    if (next.has(domain)) next.delete(domain); else next.add(domain)
    onSiteDomainsChange(next)
  }
  function toggleRank(domain: string) {
    const next = new Set(rankDomains)
    if (next.has(domain)) next.delete(domain); else next.add(domain)
    onRankDomainsChange(next)
  }
  function toggleNew(domain: string) {
    const next = new Set(newDomains)
    if (next.has(domain)) next.delete(domain); else next.add(domain)
    onNewDomainsChange(next)
  }
  function toggleBoth(domain: string, canRank: boolean, canNew: boolean) {
    const bothSelected = rankDomains.has(domain) && newDomains.has(domain)
    const nextR = new Set(rankDomains)
    const nextN = new Set(newDomains)
    if (bothSelected) {
      nextR.delete(domain); nextN.delete(domain)
    } else {
      if (canRank) nextR.add(domain)
      if (canNew) nextN.add(domain)
    }
    onRankDomainsChange(nextR); onNewDomainsChange(nextN)
  }
  function toggleCatBoth(catSites: SiteInfo[]) {
    const rankable = catSites.filter(s => s.has_rank_data)
    const newable = catSites.filter(s => s.is_enabled)
    const allRankSel = rankable.every(s => rankDomains.has(s.domain))
    const allNewSel = newable.every(s => newDomains.has(s.domain))
    const allSel = allRankSel && allNewSel
    const nextR = new Set(rankDomains); const nextN = new Set(newDomains)
    if (allSel) {
      catSites.forEach(s => { nextR.delete(s.domain); nextN.delete(s.domain) })
    } else {
      rankable.forEach(s => nextR.add(s.domain)); newable.forEach(s => nextN.add(s.domain))
    }
    onRankDomainsChange(nextR); onNewDomainsChange(nextN)
  }

  function CheckBox({ checked, disabled, onClick }: { checked: boolean; disabled?: boolean; onClick?: () => void }) {
    if (disabled) return (
      <span className="w-5 h-5 flex items-center justify-center" title="该站点未开启此抓取">
        <span className="w-3 h-px bg-gray-300 rounded-full block" />
      </span>
    )
    return (
      <span className={`w-5 h-5 flex-shrink-0 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 ${checked ? 'bg-green-500 border-2 border-green-500 shadow-sm shadow-green-200' : 'border-2 border-gray-200 bg-white hover:border-green-400 hover:bg-green-50'}`}
        onClick={onClick}>
        {checked && <svg viewBox="0 0 10 8" className="w-3 h-2.5"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-semibold text-gray-900">{isCreate ? '新增分组' : '编辑分组'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">分组名称</label>
            <input type="text" value={name} onChange={e => onNameChange(e.target.value)}
              placeholder="留空则自动使用成员名称"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              本组站点
              <span className="ml-2 text-xs text-gray-400 font-normal">用于站点目标等功能</span>
            </label>
            {siteDomains.size > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {Array.from(siteDomains).map(d => (
                  <span key={d} className="inline-flex items-center gap-1 text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2 py-0.5">
                    {d}
                    <button type="button" onClick={() => toggleSite(d)} className="text-sky-400 hover:text-sky-600 leading-none">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input type="text" value={siteSearch} onChange={e => setSiteSearch(e.target.value)}
                placeholder="搜索并添加站点…"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400" />
              {siteSearch && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto max-h-40">
                  {allSites.filter(s => s.domain.includes(siteSearch) || (s.name || '').includes(siteSearch)).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400">无匹配站点</div>
                  ) : allSites.filter(s => s.domain.includes(siteSearch) || (s.name || '').includes(siteSearch)).map(s => (
                    <button key={s.id} type="button"
                      onClick={() => { toggleSite(s.domain); setSiteSearch('') }}
                      className={`w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors ${siteDomains.has(s.domain) ? 'text-sky-600' : 'text-gray-700'}`}>
                      <span className="text-sm">{s.domain}</span>
                      {s.name && <span className="text-xs text-gray-400">{s.name}</span>}
                      {siteDomains.has(s.domain) && <span className="ml-auto text-sky-500 text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              组员{selUsers.size > 0 && <span className="ml-1.5 text-green-600">（已选 {selUsers.size} 人）</span>}
            </label>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
              {userOptions.length === 0 ? <div className="px-3 py-3 text-sm text-gray-400">加载中...</div> : userOptions.map(u => {
                const isSelected = selUsers.has(u.id)
                const mType = mTypes[u.id] || 'app'
                return (
                  <div key={u.id} className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${isSelected ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={isSelected}
                      onChange={e => {
                        const next = new Set(selUsers); const nextTypes = { ...mTypes }
                        if (e.target.checked) { next.add(u.id); nextTypes[u.id] = nextTypes[u.id] || 'app' }
                        else { next.delete(u.id); delete nextTypes[u.id] }
                        onSelUsersChange(next); onMTypesChange(nextTypes)
                      }}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900">{u.username || u.email.split('@')[0]}</span>
                      <span className="ml-1.5 text-xs text-gray-400">{u.email}</span>
                    </div>
                    {isSelected && (
                      <div className="flex gap-1 flex-shrink-0">
                        {(['app', 'game'] as const).map(t => (
                          <button key={t} onClick={() => onMTypesChange({ ...mTypes, [u.id]: t })}
                            className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${mType === t ? t === 'app' ? 'bg-blue-500 text-white border-blue-500' : 'bg-purple-500 text-white border-purple-500' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                            {t === 'app' ? '应用' : '游戏'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              站点过滤
              <span className="ml-1.5 font-normal text-xs text-gray-400">不选则显示全部</span>
            </label>
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
              <div className="grid grid-cols-[1fr_48px_48px] items-center px-3 py-1.5 bg-gray-100 border-b border-gray-200 sticky top-0 z-10">
                <span className="text-xs text-gray-500">站点</span>
                <span className="text-xs text-gray-500 text-center">排名</span>
                <span className="text-xs text-gray-500 text-center">新增</span>
              </div>
              {allSites.length === 0
                ? <div className="px-3 py-3 text-sm text-gray-400">加载中...</div>
                : cats.map(cat => {
                  const catSites = allSites.filter(s => s.category === cat)
                  if (catSites.length === 0) return null
                  const rankable = catSites.filter(s => s.has_rank_data)
                  const newable = catSites.filter(s => s.is_enabled)
                  const allRankSel = rankable.length > 0 && rankable.every(s => rankDomains.has(s.domain))
                  const someRankSel = rankable.some(s => rankDomains.has(s.domain))
                  const allNewSel = newable.length > 0 && newable.every(s => newDomains.has(s.domain))
                  const someNewSel = newable.some(s => newDomains.has(s.domain))
                  const allBothSel = allRankSel && allNewSel
                  const someBothSel = someRankSel || someNewSel
                  return (
                    <div key={cat} className="border-b border-gray-100 last:border-0">
                      <div className="grid grid-cols-[1fr_48px_48px] items-center px-3 py-2 bg-gray-50">
                        <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleCatBoth(catSites)}>
                          <span className={`w-4 h-4 flex-shrink-0 rounded-md flex items-center justify-center transition-all duration-150 ${allBothSel ? 'bg-green-500 border-2 border-green-500 shadow-sm shadow-green-200' : someBothSel ? 'bg-green-100 border-2 border-green-400' : 'border-2 border-gray-200 bg-white'}`}>
                            {allBothSel && <svg viewBox="0 0 10 8" className="w-2.5 h-2"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                            {!allBothSel && someBothSel && <span className="w-1.5 h-px bg-green-600 rounded-full block" />}
                          </span>
                          <span className="text-xs font-semibold text-gray-700">{CAT_LABELS[cat]}</span>
                          <span className="text-xs text-gray-400">({catSites.length})</span>
                        </div>
                        <div className="flex justify-center">
                          {rankable.length === 0
                            ? <span className="w-4 h-4 flex items-center justify-center"><span className="w-2.5 h-px bg-gray-300 rounded-full block" /></span>
                            : <span className={`w-4 h-4 flex-shrink-0 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 ${allRankSel ? 'bg-purple-500 border-2 border-purple-500 shadow-sm shadow-purple-200' : someRankSel ? 'bg-purple-100 border-2 border-purple-400' : 'border-2 border-gray-200 bg-white hover:border-purple-400 hover:bg-purple-50'}`}
                              onClick={() => {
                                const next = new Set(rankDomains)
                                if (allRankSel) rankable.forEach(s => next.delete(s.domain)); else rankable.forEach(s => next.add(s.domain))
                                onRankDomainsChange(next)
                              }}>
                              {allRankSel && <svg viewBox="0 0 10 8" className="w-2.5 h-2"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                              {!allRankSel && someRankSel && <span className="w-1.5 h-px bg-purple-600 rounded-full block" />}
                            </span>
                          }
                        </div>
                        <div className="flex justify-center">
                          <span className={`w-4 h-4 flex-shrink-0 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 ${allNewSel ? 'bg-blue-500 border-2 border-blue-500 shadow-sm shadow-blue-200' : someNewSel ? 'bg-blue-100 border-2 border-blue-400' : 'border-2 border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50'}`}
                            onClick={() => {
                              const next = new Set(newDomains)
                              if (allNewSel) newable.forEach(s => next.delete(s.domain)); else newable.forEach(s => next.add(s.domain))
                              onNewDomainsChange(next)
                            }}>
                            {allNewSel && <svg viewBox="0 0 10 8" className="w-2.5 h-2"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                            {!allNewSel && someNewSel && <span className="w-1.5 h-px bg-blue-600 rounded-full block" />}
                          </span>
                        </div>
                      </div>
                      {catSites.map(site => {
                        const rankSel = rankDomains.has(site.domain)
                        const newSel = newDomains.has(site.domain)
                        const rowHighlight = rankSel || newSel
                        return (
                          <div key={site.id} className={`grid grid-cols-[1fr_48px_48px] items-center px-3 py-2 pl-7 transition-colors ${rowHighlight ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}>
                            <div className="flex items-center gap-2 cursor-pointer min-w-0"
                              onClick={() => toggleBoth(site.domain, site.has_rank_data, site.is_enabled)}>
                              <span className={`w-4 h-4 flex-shrink-0 rounded-md flex items-center justify-center transition-all duration-150 ${rankSel && newSel ? 'bg-green-500 border-2 border-green-500 shadow-sm shadow-green-200' : rankSel || newSel ? 'bg-green-100 border-2 border-green-400' : 'border-2 border-gray-200 bg-white'}`}>
                                {rankSel && newSel && <svg viewBox="0 0 10 8" className="w-2.5 h-2"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                {(rankSel || newSel) && !(rankSel && newSel) && <span className="w-1.5 h-px bg-green-600 rounded-full block" />}
                              </span>
                              <span className="text-sm text-gray-700 truncate">{site.domain}</span>
                              {site.name && <span className="text-xs text-gray-400 truncate">{site.name}</span>}
                            </div>
                            <div className="flex justify-center">
                              <CheckBox checked={rankSel} disabled={!site.has_rank_data} onClick={site.has_rank_data ? () => toggleRank(site.domain) : undefined} />
                            </div>
                            <div className="flex justify-center">
                              <CheckBox checked={newSel} disabled={!site.is_enabled} onClick={site.is_enabled ? () => toggleNew(site.domain) : undefined} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              }
            </div>
            {(rankDomains.size > 0 || newDomains.size > 0) && (
              <p className="text-xs text-gray-400 mt-1">排名过滤 {rankDomains.size} 站 · 新增过滤 {newDomains.size} 站</p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="btn-ghost">取消</button>
          <button onClick={onSubmit} disabled={busy || selUsers.size === 0} className="btn-primary disabled:opacity-50">
            {busy ? (isCreate ? '创建中...' : '保存中...') : (isCreate ? '创建分组' : '保存')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function TaskGroupsPage() {
  const { role, id: currentUserId } = useUser()
  const canManage = role === 'super' || role === 'admin'
  const today = useMemo(() => getMYDate(), [])
  const yesterday = useMemo(() => getMYDate(-1), [])

  const [groups, setGroups] = useState<TaskGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)

  const [viewingMemberId, setViewingMemberId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(today)
  const [claimedKeywords, setClaimedKeywords] = useState<ClaimedKeyword[]>([])
  const [claimedLoading, setClaimedLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submittingOneId, setSubmittingOneId] = useState<string | null>(null)
  const [claimErrorMsg, setClaimErrorMsg] = useState<string | null>(null)

  const [rightTab, setRightTab] = useState<RightTab>(role === 'super' || role === 'admin' ? 'recommend' : 'cross')
  const [tabPage, setTabPage] = useState<Record<RightTab, number>>({ recommend: 0, search: 0, cross: 0, rank: 0, streak: 0, newWords: 0, wordLib: 0, rankdown: 0 })
  const [recSubTab, setRecSubTab] = useState<RecSubTab>('rankdown')
  // 点×移除某个跌排/涨排更新推荐词——持久化到数据库、7天冷却，不再是刷新页面
  // 就重新出现的临时前端状态，2026-07-29 加入。
  const [dismissedRecMap, setDismissedRecMap] = useState<Map<string, string>>(new Map())
  const [dismissedRecKey, setDismissedRecKey] = useState<string | null>(null)
  const [siteRankdownData, setSiteRankdownData] = useState<{ keyword: string; stat_date: string; rank_position: number; prev_rank: number | null; volume: number; url: string | null; title: string | null }[]>([])
  const [siteRankdownLoading, setSiteRankdownLoading] = useState(false)
  const [siteRankdownGroupId, setSiteRankdownGroupId] = useState<string | null>(null)
  const [siteRankupData, setSiteRankupData] = useState<{ keyword: string; stat_date: string; rank_position: number; prev_rank: number | null; volume: number; url: string | null; title: string | null }[]>([])
  const [siteRankupLoading, setSiteRankupLoading] = useState(false)
  const [siteRankupGroupId, setSiteRankupGroupId] = useState<string | null>(null)
  // 组员对某个词最近一次"新增/更新"提交时间 + 历史"更新"次数 —— 用于给
  // 跌排更新/涨排更新推荐做冷却（7天内提交过的词不再重复推荐）和优先级
  // （反复更新过的词优先级更低）排序，2026-07-29 加入。
  const [submissionHistoryMap, setSubmissionHistoryMap] = useState<Map<string, { lastSubmittedAt: string; updateCount: number }>>(new Map())
  const [submissionHistoryKey, setSubmissionHistoryKey] = useState<string | null>(null)
  const [rdPage, setRdPage] = useState(0)
  const [rankdownDate, setRankdownDate] = useState('')

  const [radarData, setRadarData] = useState<{ newWords: NewWord[]; rankWords: RankWord[]; streakWords: StreakWord[] } | null>(null)
  const [radarLoaded, setRadarLoaded] = useState(false)
  const [radarLoading, setRadarLoading] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ keyword: string; volume: number; latest_trend?: string | null }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchPage, setSearchPage] = useState(0)

  // Detail modal
  const [siteIdMap, setSiteIdMap] = useState<Map<string, string>>(new Map())
  const [detailKw, setDetailKw] = useState<string | null>(null)
  const [detailSource, setDetailSource] = useState<string>('')
  const [detailNewRows, setDetailNewRows] = useState<DetailRow[]>([])
  const [detailRankRows, setDetailRankRows] = useState<DetailRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [wordLibSiteKws, setWordLibSiteKws] = useState<{domain: string; keywords: string[]}[]>([])
  const [wordLibData, setWordLibData] = useState<WordLibEntry[]>([])
  const [wordLibLoading, setWordLibLoading] = useState(false)
  const [wordLibLoaded, setWordLibLoaded] = useState(false)
  const [wordLibSearch, setWordLibSearch] = useState('')
  const [sortCol, setSortCol]           = useState('')
  const [sortDir, setSortDir]           = useState<'asc'|'desc'|''>('')

  // Group management
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [memberTypes, setMemberTypes] = useState<Record<string, 'app' | 'game'>>({})
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [editName, setEditName] = useState('')
  const [editMemberTypes, setEditMemberTypes] = useState<Record<string, 'app' | 'game'>>({})
  const [editSelectedUsers, setEditSelectedUsers] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [allSites, setAllSites] = useState<SiteInfo[]>([])
  const [domainWeightMap, setDomainWeightMap] = useState<Map<string, { pc: number; mobile: number }>>(new Map())
  const [domainColorMap, setDomainColorMap] = useState<Map<string, string>>(new Map())
  const [selectedRankDomains, setSelectedRankDomains] = useState<Set<string>>(new Set())
  const [selectedNewDomains, setSelectedNewDomains] = useState<Set<string>>(new Set())
  const [editSelectedRankDomains, setEditSelectedRankDomains] = useState<Set<string>>(new Set())
  const [editSelectedNewDomains, setEditSelectedNewDomains] = useState<Set<string>>(new Set())
  const [editSelectedSiteDomains, setEditSelectedSiteDomains] = useState<Set<string>>(new Set())
  const [selectedSiteDomains, setSelectedSiteDomains] = useState<Set<string>>(new Set())

  const [expandedClaimIds, setExpandedClaimIds] = useState<Set<string>>(new Set())
  const [invalidClaimIds, setInvalidClaimIds] = useState<Set<string>>(new Set())
  const [showAddForm, setShowAddForm] = useState(false)
  const [addKw, setAddKw] = useState('')
  const [addOpType, setAddOpType] = useState<'新增' | '更新'>('新增')
  const [addFinalKw, setAddFinalKw] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addingManual, setAddingManual] = useState(false)

  const claimingRef = useRef<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const claimedListRef = useRef<HTMLDivElement>(null)
  const detailCacheRef = useRef<Map<string, { newRows: DetailRow[]; rankRows: DetailRow[]; wordLibSiteKws: { domain: string; keywords: string[] }[] }>>(new Map())

  const activeGroup = groups.find(g => g.id === activeGroupId) ?? null
  const effectiveViewingId = viewingMemberId || currentUserId || ''
  const isViewingOwn = effectiveViewingId === currentUserId

  const claimedSet = useMemo(() => new Set(claimedKeywords.map(k => k.keyword)), [claimedKeywords])
  const submittedSet = useMemo(() => new Set(claimedKeywords.filter(k => k.status === 'submitted').map(k => k.keyword)), [claimedKeywords])
  // Dedup by keyword — DB race condition can create duplicates; show only one per keyword
  const displayedClaims = useMemo(() => {
    const seen = new Set<string>()
    return claimedKeywords.filter(k => !seen.has(k.keyword) && !!seen.add(k.keyword))
  }, [claimedKeywords])
  const pendingCount = displayedClaims.filter(k => k.status === 'pending').length
  const submittedCount = displayedClaims.filter(k => k.status === 'submitted').length

  const groupRankDomains = useMemo(() => new Set(activeGroup?.rank_domains || []), [activeGroup])
  const groupNewDomains = useMemo(() => new Set(activeGroup?.new_domains || []), [activeGroup])

  // ── Derived radar data ──────────────────────────────────────────────────────

  const crossWords = useMemo((): CrossWord[] => {
    if (!radarData) return []
    const nwMap = new Map(radarData.newWords.map(w => [w.keyword, w]))
    const rwMap = new Map(radarData.rankWords.map(w => [w.keyword, w]))
    const allKws = new Set([...Array.from(nwMap.keys()), ...Array.from(rwMap.keys())])
    const cw = Array.from(allKws).map(keyword => {
      const nwe = nwMap.get(keyword)
      const rwe = rwMap.get(keyword)
      if (!nwe || !rwe) return null
      const last_date = [nwe.last_date, rwe.last_date].filter(Boolean).sort().reverse()[0] ?? ''
      const first_date = [nwe.first_date, rwe.first_date].filter(Boolean).sort()[0] ?? ''
      return { keyword, volume: rwe.volume ?? 0, last_date, first_date, newSites: nwe.sites, rankSites: rwe.sites }
    }).filter((w): w is CrossWord => w !== null)
    const sorted = sortByDate(cw, yesterday, (a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    return sorted.filter(w =>
      (!groupRankDomains.size || w.rankSites.some(s => groupRankDomains.has(s))) &&
      (!groupNewDomains.size || w.newSites.some(s => groupNewDomains.has(s)))
    )
  }, [radarData, yesterday, groupRankDomains, groupNewDomains])

  const rankWordsSorted = useMemo(() => {
    if (!radarData) return []
    const sorted = sortByDate(radarData.rankWords, yesterday, (a, b) => b.volume - a.volume || b.rankDays - a.rankDays)
    if (!groupRankDomains.size) return sorted
    return sorted.filter(w => w.sites.some(s => groupRankDomains.has(s)))
  }, [radarData, yesterday, groupRankDomains])

  // Group streak words by keyword (same as hot-radar): streak>=2, single-domain only
  const streakWords = useMemo(() => {
    if (!radarData) return []
    const grouped = new Map<string, { keyword: string; streak: number; domains: string[]; volume: number; first_date: string; last_date: string }>()
    for (const w of radarData.streakWords) {
      if (w.streak < 2) continue
      const g = grouped.get(w.keyword)
      if (!g) {
        grouped.set(w.keyword, { keyword: w.keyword, streak: w.streak, domains: [w.domain], volume: w.volume, first_date: w.first_date, last_date: w.last_date })
      } else {
        if (!g.domains.includes(w.domain)) g.domains.push(w.domain)
        if (w.streak > g.streak) g.streak = w.streak
        if (w.volume > g.volume) g.volume = w.volume
        if (w.last_date > g.last_date) g.last_date = w.last_date
        if (!g.first_date || w.first_date < g.first_date) g.first_date = w.first_date
      }
    }
    let single = Array.from(grouped.values()).filter(g => g.domains.length === 1)
    if (groupRankDomains.size) single = single.filter(g => g.domains.some(d => groupRankDomains.has(d)))
    return [...single].sort((a, b) => {
      if (a.last_date !== b.last_date) return b.last_date.localeCompare(a.last_date)
      const pa = getStreakBadge(a.streak, a.last_date, yesterday) === 'new' ? 0 : getStreakBadge(a.streak, a.last_date, yesterday) === 'updated' ? 1 : 2
      const pb = getStreakBadge(b.streak, b.last_date, yesterday) === 'new' ? 0 : getStreakBadge(b.streak, b.last_date, yesterday) === 'updated' ? 1 : 2
      if (pa !== pb) return pa - pb
      return b.streak - a.streak || b.volume - a.volume
    })
  }, [radarData, yesterday, groupRankDomains])

  const allNewWords = useMemo(() => {
    if (!radarData) return []
    const sorted = sortByDate(radarData.newWords, yesterday, (a, b) => b.count - a.count || b.siteCount - a.siteCount)
    if (!groupNewDomains.size) return sorted
    return sorted.filter(w => w.sites.some(s => groupNewDomains.has(s)))
  }, [radarData, yesterday, groupNewDomains])

  const wordLibWords = useMemo((): WordLibEntry[] => {
    if (!wordLibData.length) return []
    if (!groupNewDomains.size) return wordLibData
    // Filter entries to only those with at least one site in the group's new_domains
    return wordLibData
      .filter(w => w.sites.some(s => groupNewDomains.has(s)))
      .map(w => {
        const filtered = w.sites.filter(s => groupNewDomains.has(s))
        return { ...w, sites: filtered, siteCount: filtered.length }
      })
  }, [wordLibData, groupNewDomains])

  // ── 跌排更新 / 涨排更新（自有站m端排名变化，供更新词库展示 + 今日推荐筛选） ──

  async function loadSiteRankdown() {
    if (!activeGroup || siteRankdownGroupId === activeGroup.id || siteRankdownLoading) return
    const ownDomains = activeGroup.site_domains
    if (ownDomains.length === 0) { setSiteRankdownGroupId(activeGroup.id); return }
    setSiteRankdownLoading(true)
    try {
      const supabase = getBrowserClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: siteData } = await (supabase.from('sites') as any)
        .select('id').in('domain', ownDomains)
      const siteIds = ((siteData || []) as { id: string }[]).map(s => s.id)
      if (siteIds.length > 0) {
        const since = getMYDate(-30)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase.from('site_keyword_ranks') as any)
          .select('keyword, stat_date, rank_position, prev_rank, volume, url, title')
          .in('site_id', siteIds)
          .eq('type', 'rankdown')
          .eq('platform', 'mobile')
          .gte('stat_date', since)
          .order('stat_date', { ascending: false })
          .order('volume', { ascending: false })
          .limit(3000)
        const rows = (data || []) as { keyword: string; stat_date: string; rank_position: number; prev_rank: number | null; volume: number; url: string | null; title: string | null }[]
        setSiteRankdownData(rows)
        // Default date = most recent stat_date in data
        if (rows.length > 0) setRankdownDate(prev => prev || rows[0].stat_date)
      }
      setSiteRankdownGroupId(activeGroup.id)
      setRdPage(0)
    } finally { setSiteRankdownLoading(false) }
  }

  async function loadSiteRankup() {
    if (!activeGroup || siteRankupGroupId === activeGroup.id || siteRankupLoading) return
    const ownDomains = activeGroup.site_domains
    if (ownDomains.length === 0) { setSiteRankupGroupId(activeGroup.id); return }
    setSiteRankupLoading(true)
    try {
      const supabase = getBrowserClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: siteData } = await (supabase.from('sites') as any)
        .select('id').in('domain', ownDomains)
      const siteIds = ((siteData || []) as { id: string }[]).map(s => s.id)
      if (siteIds.length > 0) {
        const since = getMYDate(-30)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase.from('site_keyword_ranks') as any)
          .select('keyword, stat_date, rank_position, prev_rank, volume, url, title')
          .in('site_id', siteIds)
          .eq('type', 'rankup')
          .eq('platform', 'mobile')
          .gte('stat_date', since)
          .order('stat_date', { ascending: false })
          .order('volume', { ascending: false })
          .limit(3000)
        const rows = (data || []) as { keyword: string; stat_date: string; rank_position: number; prev_rank: number | null; volume: number; url: string | null; title: string | null }[]
        setSiteRankupData(rows)
      }
      setSiteRankupGroupId(activeGroup.id)
      setRdPage(0)
    } finally { setSiteRankupLoading(false) }
  }

  // 组员对每个词最近一次"新增/更新"提交时间 + 历史"更新"次数，用于跌排/涨排更新
  // 推荐的冷却（7天内提交过的词不再推荐）和优先级（反复更新过的词优先级更低）。
  const RECOMMEND_COOLDOWN_UNIT_DAYS = 7
  async function loadSubmissionHistory() {
    if (!activeGroup || !effectiveViewingId) return
    const key = `${activeGroup.id}|${effectiveViewingId}`
    if (submissionHistoryKey === key) return
    try {
      const supabase = getBrowserClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('member_claimed_keywords') as any)
        .select('keyword, final_keyword, operation_type, submitted_at, claimed_date')
        .eq('group_id', activeGroup.id)
        .eq('user_id', effectiveViewingId)
        .eq('status', 'submitted')
      const map = new Map<string, { lastSubmittedAt: string; updateCount: number }>()
      for (const r of (data || []) as { keyword: string; final_keyword: string | null; operation_type: string | null; submitted_at: string | null; claimed_date: string }[]) {
        const kw = (r.final_keyword || r.keyword).toLowerCase()
        const at = r.submitted_at || r.claimed_date
        const isUpdate = r.operation_type === '更新' ? 1 : 0
        const existing = map.get(kw)
        if (!existing) map.set(kw, { lastSubmittedAt: at, updateCount: isUpdate })
        else map.set(kw, {
          lastSubmittedAt: at > existing.lastSubmittedAt ? at : existing.lastSubmittedAt,
          updateCount: existing.updateCount + isUpdate,
        })
      }
      setSubmissionHistoryMap(map)
      setSubmissionHistoryKey(key)
    } catch {
      // network error — recommendations just fall back to no-cooldown-info this render
    }
  }

  async function loadDismissedRec() {
    if (!activeGroup || !effectiveViewingId) return
    const key = `${activeGroup.id}|${effectiveViewingId}`
    if (dismissedRecKey === key) return
    try {
      const supabase = getBrowserClient()
      const since = new Date(Date.now() - RECOMMEND_COOLDOWN_UNIT_DAYS * 86400000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('member_rec_dismissals') as any)
        .select('keyword, dismissed_at')
        .eq('group_id', activeGroup.id)
        .eq('user_id', effectiveViewingId)
        .gte('dismissed_at', since)
      const map = new Map<string, string>()
      for (const r of (data || []) as { keyword: string; dismissed_at: string }[]) map.set(r.keyword, r.dismissed_at)
      setDismissedRecMap(map)
      setDismissedRecKey(key)
    } catch {
      // network error — dismissed items just won't be filtered this render
    }
  }

  // 冷却期按历史更新次数递增：新增后首次冷却7天；每被"更新"一次，下一次冷却再
  // +7天（更新1次=14天，更新2次=21天…），避免同一个词被短时间内反复更新。冷却期
  // 内的词直接不显示；冷却期一过，越早"刚满冷却"的词优先级越高（同一批信号里最
  // 先该处理的），同等新鲜度下搜索量越高越优先——2026-07-29 按用户实际更新节奏定的。
  function daysBetweenDates(a: string, b: string): number {
    return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000)
  }
  function addDays(dateStr: string, days: number): string {
    return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10)
  }
  function applyRecommendCooldown<T extends { keyword: string; volume: number }>(rows: T[]): T[] {
    const today = getMYDate(0)
    return rows
      .map(r => {
        const info = submissionHistoryMap.get(r.keyword.toLowerCase())
        if (!info) return { r, eligible: true, daysSinceEligible: 0 } // 没有历史提交记录（按URL匹配到但词不同）：不受冷却限制
        const lastDate = info.lastSubmittedAt.slice(0, 10)
        const cooldownDays = RECOMMEND_COOLDOWN_UNIT_DAYS * (info.updateCount + 1)
        const cooldownEndDate = addDays(lastDate, cooldownDays)
        const eligible = cooldownEndDate <= today
        return { r, eligible, daysSinceEligible: eligible ? daysBetweenDates(cooldownEndDate, today) : -1 }
      })
      .filter(x => x.eligible)
      .sort((a, b) => a.daysSinceEligible - b.daysSinceEligible || (b.r.volume - a.r.volume))
      .map(x => x.r)
  }

  // ── Detail modal data ───────────────────────────────────────────────────────

  const detailNewByDate = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const r of detailNewRows) {
      if (!map.has(r.date)) map.set(r.date, [])
      if (!map.get(r.date)!.includes(r.domain)) map.get(r.date)!.push(r.domain)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [detailNewRows])

  const detailRankByDate = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const r of detailRankRows) {
      if (!map.has(r.date)) map.set(r.date, [])
      if (!map.get(r.date)!.includes(r.domain)) map.get(r.date)!.push(r.domain)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [detailRankRows])

  // ── API calls ───────────────────────────────────────────────────────────────

  async function loadGroups() {
    setLoading(true)
    try {
      const res = await fetch('/api/task-groups')
      const data = await res.json()
      const list: TaskGroup[] = data.groups || []
      setGroups(list)
      if (list.length > 0 && !activeGroupId) setActiveGroupId(list[0].id)
    } finally { setLoading(false) }
  }

  async function loadClaimed(groupId: string, userId: string, date: string) {
    setClaimedLoading(true)
    setExpandedClaimIds(new Set())
    setInvalidClaimIds(new Set())
    try {
      const res = await fetch(`/api/task-groups/${groupId}/claimed?userId=${userId}&date=${date}`)
      const data = await res.json()
      setClaimedKeywords(data.keywords || [])
    } finally { setClaimedLoading(false) }
  }

  async function loadRadar() {
    if (radarLoaded || radarLoading) return
    setRadarLoading(true)
    try {
      const res = await fetch('/api/hot-radar')
      const rd = await res.json()
      setRadarData(rd); setRadarLoaded(true)
    } finally { setRadarLoading(false) }
  }

  async function claimKeyword(keyword: string, source: string, search_volume = 0, source_rule_id?: string) {
    // claimedSet covers "already in state"; claimingRef covers "in-flight request"
    if (!activeGroupId || claimedSet.has(keyword) || claimingRef.current.has(keyword)) return
    claimingRef.current.add(keyword)
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, source, search_volume, operation_type: '新增', source_rule_id: source_rule_id ?? null }),
      })
      if (res.status === 409) {
        // Same keyword+day is reserved group-wide (2026-07-29) — someone (maybe
        // the caller themself in another tab) already holds it. Surface who.
        const data = await res.json().catch(() => ({}))
        setClaimErrorMsg(data.error || '这个词已经被认领了')
        if (activeGroupId && effectiveViewingId) loadClaimed(activeGroupId, effectiveViewingId, selectedDate)
        return
      }
      if (res.ok) {
        const data = await res.json()
        setClaimedKeywords(prev => [...prev, data.keyword])
        setExpandedClaimIds(new Set<string>([data.keyword.id]))
      }
    } catch {
      // network error — user can retry
    } finally { claimingRef.current.delete(keyword) }
  }

  function dismissRec(keyword: string) {
    const now = new Date().toISOString()
    setDismissedRecMap(prev => { const next = new Map(prev); next.set(keyword, now); return next })
    if (!activeGroupId || !effectiveViewingId) return
    const supabase = getBrowserClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase.from('member_rec_dismissals') as any)
      .upsert({ group_id: activeGroupId, user_id: effectiveViewingId, keyword, dismissed_at: now }, { onConflict: 'group_id,user_id,keyword' })
      .then(() => {})
  }

  async function dismissClaimed(claimId: string) {
    if (!activeGroupId) return
    setClaimedKeywords(prev => prev.filter(k => k.id !== claimId))
    await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimId, status: 'dismissed' }),
    })
  }

  async function saveClaim(claimId: string, field: 'final_keyword' | 'page_url' | 'operation_type', value: string) {
    if (!activeGroupId) return
    setClaimedKeywords(prev => prev.map(k => k.id === claimId ? { ...k, [field]: value || null } : k))
    await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimId, [field]: value }),
    })
  }

  // 单条提交——不用等攒够一批再一起点"提交"，填完这一条就能立刻单独提交，
  // 2026-07-29 加入。校验逻辑跟批量提交一致（操作类型/最终词/URL 都要填）。
  async function submitOne(claimId: string) {
    if (!activeGroupId || submittingOneId === claimId) return
    const claim = displayedClaims.find(k => k.id === claimId)
    if (!claim || claim.status !== 'pending') return
    if (!claim.operation_type || !claim.final_keyword?.trim() || !claim.page_url?.trim()) {
      setInvalidClaimIds(prev => new Set([...Array.from(prev), claimId]))
      setExpandedClaimIds(new Set([claimId]))
      return
    }
    setInvalidClaimIds(prev => { const n = new Set(prev); n.delete(claimId); return n })
    setSubmittingOneId(claimId)
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, status: 'submitted' }),
      })
      if (res.ok) setClaimedKeywords(prev => prev.map(k => k.id === claimId ? { ...k, status: 'submitted' } : k))
    } finally { setSubmittingOneId(null) }
  }

  async function addManualKeyword() {
    if (!activeGroupId || !addKw.trim() || addingManual) return
    setAddingManual(true)
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: addKw.trim(),
          source: '手动添加',
          search_volume: 0,
          operation_type: addOpType,
          final_keyword: addFinalKw.trim() || undefined,
          page_url: normalizeUrl(addUrl) || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setClaimedKeywords(prev => [...prev, data.keyword])
        setAddKw(''); setAddFinalKw(''); setAddUrl(''); setAddOpType('新增')
        setShowAddForm(false)
      } else {
        const data = await res.json().catch(() => ({}))
        setClaimErrorMsg(data.error || '添加失败')
      }
    } finally { setAddingManual(false) }
  }

  async function submitForDate() {
    if (!activeGroupId || submitting || pendingCount === 0) return

    // Validate: all pending claims must have operation_type, final_keyword, and page_url
    const pending = displayedClaims.filter(k => k.status === 'pending')
    const incomplete = pending.filter(k => !k.operation_type || !k.final_keyword?.trim() || !k.page_url?.trim())
    if (incomplete.length > 0) {
      const ids = new Set(incomplete.map(k => k.id))
      setInvalidClaimIds(ids)
      setExpandedClaimIds(prev => new Set([...Array.from(prev), ...Array.from(ids)]))
      return
    }
    setInvalidClaimIds(new Set())

    setSubmitting(true)
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      })
      if (res.ok) setClaimedKeywords(prev => prev.map(k => k.status === 'pending' ? { ...k, status: 'submitted' } : k))
    } finally { setSubmitting(false) }
  }

  async function openDetail(keyword: string, source: string) {
    setDetailKw(keyword)
    setDetailSource(source)

    const cacheKey = `${keyword}|${source}`
    const cached = detailCacheRef.current.get(cacheKey)
    if (cached) {
      setDetailNewRows(cached.newRows)
      setDetailRankRows(cached.rankRows)
      setWordLibSiteKws(cached.wordLibSiteKws)
      setDetailLoading(false)
      return
    }

    setDetailLoading(true)
    setDetailNewRows([])
    setDetailRankRows([])
    setWordLibSiteKws([])

    const supabase = getBrowserClient()
    let idMap = siteIdMap
    if (idMap.size === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: siteData } = await (supabase.from('sites') as any).select('id, domain')
      idMap = new Map((siteData || []).map((s: { id: string; domain: string }) => [s.id, s.domain]))
      setSiteIdMap(idMap)
    }

    if (source === '更新词库') {
      const wordEntry = wordLibWords.find(w => w.keyword === keyword)
      const targetDomains = wordEntry?.sites || []
      const domainToId = new Map(Array.from(idMap.entries()).map(([id, d]) => [d, id]))
      const siteIds = targetDomains.map(d => domainToId.get(d)).filter((id): id is string => !!id)
      try {
        if (siteIds.length > 0) {
          const since = getMYDate(-30)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: raw } = await (supabase.from('raw_keywords') as any)
            .select('site_id, keyword')
            .in('site_id', siteIds)
            .like('keyword', `${keyword}%`)
            .gte('discovered_at', since)
          const bySite = new Map<string, Set<string>>()
          for (const r of (raw || [])) {
            const domain = idMap.get(r.site_id)
            if (!domain) continue
            if (!bySite.has(domain)) bySite.set(domain, new Set())
            bySite.get(domain)!.add(r.keyword)
          }
          const wlRows = Array.from(bySite.entries())
            .map(([domain, kws]) => ({ domain, keywords: Array.from(kws).sort() }))
            .sort((a, b) => b.keywords.length - a.keywords.length)
          setWordLibSiteKws(wlRows)
          detailCacheRef.current.set(cacheKey, { newRows: [], rankRows: [], wordLibSiteKws: wlRows })
        }
      } finally {
        setDetailLoading(false)
      }
      return
    }

    const since = getMYDate(-30)
    const needsNew = ['交叉词', '共新增词', '今日推荐', '竞品词', '竞品规则推荐'].includes(source)
    const needsRank = ['交叉词', '竞品涨排名', '连续上涨词', '今日推荐', '规则推荐'].includes(source)

    try {
      const nRows: DetailRow[] = []
      const rRows: DetailRow[] = []
      if (needsNew) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: raw } = await (supabase.from('raw_keywords') as any)
          .select('site_id, content_date')
          .eq('keyword', keyword).gte('content_date', since)
          .order('content_date', { ascending: false })
        for (const r of (raw || [])) {
          const domain = idMap.get(r.site_id)
          if (domain) nRows.push({ date: String(r.content_date).slice(0, 10), domain })
        }
      }
      if (needsRank) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: raw } = await (supabase.from('rank_changes') as any)
          .select('site_id, stat_date')
          .eq('keyword', keyword).eq('type', 'rankup').gte('stat_date', since)
          .order('stat_date', { ascending: false })
        for (const r of (raw || [])) {
          const domain = idMap.get(r.site_id)
          if (domain) rRows.push({ date: String(r.stat_date).slice(0, 10), domain })
        }
      }
      const dedupedNew = dedupDetailRows(nRows)
      const dedupedRank = dedupDetailRows(rRows)
      setDetailNewRows(dedupedNew)
      setDetailRankRows(dedupedRank)
      detailCacheRef.current.set(cacheKey, { newRows: dedupedNew, rankRows: dedupedRank, wordLibSiteKws: [] })
    } finally {
      setDetailLoading(false)
    }
  }

  async function doSearch(q: string, page = 0) {
    if (!q.trim()) { setSearchResults([]); setSearchTotal(0); return }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/keyword-volume?q=${encodeURIComponent(q)}&page=${page}`)
      const data = await res.json()
      setSearchResults(data.keywords || []); setSearchTotal(data.total || 0); setSearchPage(page)
    } finally { setSearchLoading(false) }
  }
  function triggerSearch() { setSearchQuery(searchInput); doSearch(searchInput, 0) }

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => { loadGroups(); loadDomainInfo() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!claimErrorMsg) return
    const t = setTimeout(() => setClaimErrorMsg(null), 3500)
    return () => clearTimeout(t)
  }, [claimErrorMsg])
  useEffect(() => { if (activeGroupId && effectiveViewingId) loadClaimed(activeGroupId, effectiveViewingId, selectedDate) }, [activeGroupId, effectiveViewingId, selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (currentUserId && !viewingMemberId) setViewingMemberId(currentUserId) }, [currentUserId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rightTab !== 'search') loadRadar() }, [rightTab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rightTab === 'wordLib' || rightTab === 'rankdown' || (rightTab === 'recommend' && recSubTab === 'rankdown')) loadSiteRankdown() }, [rightTab, recSubTab, activeGroupId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rightTab === 'recommend' && recSubTab === 'rankup') loadSiteRankup() }, [rightTab, recSubTab, activeGroupId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rightTab === 'recommend') loadSubmissionHistory() }, [rightTab, recSubTab, activeGroupId, effectiveViewingId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rightTab === 'recommend') loadDismissedRec() }, [rightTab, recSubTab, activeGroupId, effectiveViewingId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Scroll today's task list to bottom when a new claim is added
  useEffect(() => {
    if (claimedListRef.current) claimedListRef.current.scrollTop = claimedListRef.current.scrollHeight
  }, [displayedClaims.length])

  useEffect(() => {
    if (rightTab !== 'wordLib' || wordLibLoaded || wordLibLoading) return
    setWordLibLoading(true)
    fetch('/api/wordlib')
      .then(r => r.json())
      .then(({ data }: { data: Array<{keyword: string; long_tail_count: number; site_count: number; sites: string[]; last_date: string}> | null }) => {
        const t = today
        setWordLibData((data || []).map(r => {
          const last_date = String(r.last_date || '').slice(0, 10)
          return {
            keyword: r.keyword,
            longTailCount: r.long_tail_count,
            count: r.long_tail_count,
            siteCount: r.site_count,
            sites: r.sites || [],
            last_date,
            first_date: last_date === t ? t : '',
          }
        }))
        setWordLibLoaded(true)
      })
      .catch(() => { setWordLibData([]) })
      .finally(() => { setWordLibLoading(false) })
  }, [rightTab, wordLibLoaded, wordLibLoading, today])

  useEffect(() => {
    if (!activeGroupId || selectedDate !== today) return
    const supabase = getBrowserClient()
    const channel = supabase
      .channel(`claimed-${activeGroupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_claimed_keywords', filter: `group_id=eq.${activeGroupId}` },
        (payload) => {
          const rec = (payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old) as ClaimedKeyword & { user_id: string; claimed_date: string }
          if (!rec || rec.user_id !== effectiveViewingId || rec.claimed_date !== today) return
          if (payload.eventType === 'INSERT') {
            if (rec.status !== 'dismissed') setClaimedKeywords(prev => prev.some(k => k.id === rec.id) ? prev : [...prev, rec])
          } else if (payload.eventType === 'UPDATE') {
            if (rec.status === 'dismissed') setClaimedKeywords(prev => prev.filter(k => k.id !== rec.id))
            else setClaimedKeywords(prev => prev.map(k => k.id === rec.id ? { ...k, status: rec.status, operation_type: rec.operation_type, final_keyword: rec.final_keyword, page_url: rec.page_url } : k))
          } else if (payload.eventType === 'DELETE') {
            setClaimedKeywords(prev => prev.filter(k => k.id !== (payload.old as { id: string }).id))
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeGroupId, effectiveViewingId, selectedDate, today]) // eslint-disable-line react-hooks/exhaustive-deps

  function setPage(tab: RightTab, p: number) { setTabPage(prev => ({ ...prev, [tab]: p })) }

  // ── Group management ────────────────────────────────────────────────────────

  async function loadAllSites() {
    if (allSites.length > 0) return
    const supabase = getBrowserClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('sites') as any).select('id, domain, name, category, is_enabled, has_rank_data, friend_links')
    const CAT_ORDER: Record<string, number> = { large: 0, medium: 1, small: 2 }
    setAllSites(((data || []) as SiteInfo[]).sort((a, b) => (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9) || a.domain.localeCompare(b.domain)))
  }

  async function loadDomainInfo() {
    const supabase = getBrowserClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sitesRes, weightRes] = await Promise.all([
      (supabase.from('sites') as any).select('id, domain, friend_links'),
      (supabase.from('weight_history') as any).select('site_id, pc_weight, mobile_weight').gte('record_date', getMYDate(-30)).order('record_date'),
    ])
    const sites: { id: string; domain: string; friend_links?: string[] | null }[] = sitesRes.data || []
    const idToDomain = new Map<string, string>(sites.map((s: { id: string; domain: string }) => [s.id, s.domain]))
    // weight: iterate asc so last write = latest
    const wMap = new Map<string, { pc: number; mobile: number }>()
    for (const r of (weightRes.data || []) as { site_id: string; pc_weight: number; mobile_weight: number }[]) {
      const domain = idToDomain.get(r.site_id)
      if (domain) wMap.set(domain, { pc: r.pc_weight, mobile: r.mobile_weight })
    }
    setDomainWeightMap(wMap)
    setDomainColorMap(buildGroupColorMap(sites))
  }

  async function openCreateModal() {
    setShowCreate(true); setCreateName(''); setSelectedUsers(new Set()); setMemberTypes({})
    setSelectedRankDomains(new Set()); setSelectedNewDomains(new Set())
    const [usersRes] = await Promise.all([fetch('/api/admin/users'), loadAllSites()])
    const data = await usersRes.json()
    setUserOptions((data.users || []).filter((u: UserOption) => u.role !== 'super'))
  }

  async function handleCreate() {
    if (selectedUsers.size === 0) return
    setCreating(true)
    try {
      const members = userOptions.filter(u => selectedUsers.has(u.id))
        .map(u => ({ user_id: u.id, username: u.username || u.email.split('@')[0], member_type: memberTypes[u.id] || 'app' }))
      const res = await fetch('/api/task-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName.trim() || members.map(m => m.username).join(' · '), type: 'both', members, rank_domains: Array.from(selectedRankDomains), new_domains: Array.from(selectedNewDomains), associated_domains: [], site_domains: Array.from(selectedSiteDomains) }),
      })
      if (res.ok) { setShowCreate(false); await loadGroups() }
    } finally { setCreating(false) }
  }

  async function openEditModal() {
    if (!activeGroup) return
    setEditName(activeGroup.name)
    setEditSelectedUsers(new Set(activeGroup.members.map(m => m.user_id)))
    setEditSelectedRankDomains(new Set(activeGroup.rank_domains || []))
    setEditSelectedNewDomains(new Set(activeGroup.new_domains || []))
    setEditSelectedSiteDomains(new Set(activeGroup.site_domains || []))
    const types: Record<string, 'app' | 'game'> = {}
    for (const m of activeGroup.members) types[m.user_id] = m.member_type === 'game' ? 'game' : 'app'
    setEditMemberTypes(types); setShowEdit(true)
    const promises: Promise<unknown>[] = [loadAllSites()]
    if (userOptions.length === 0) promises.push(fetch('/api/admin/users').then(r => r.json()).then(d => setUserOptions(d.users || [])))
    await Promise.all(promises)
  }

  async function handleEdit() {
    if (!activeGroup || editSelectedUsers.size === 0) return
    setSaving(true)
    try {
      const members = userOptions.filter(u => editSelectedUsers.has(u.id))
        .map(u => ({ user_id: u.id, username: u.username || u.email.split('@')[0], member_type: editMemberTypes[u.id] || 'app' }))
      const res = await fetch(`/api/task-groups/${activeGroup.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() || members.map(m => m.username).join(' · '), members, rank_domains: Array.from(editSelectedRankDomains), new_domains: Array.from(editSelectedNewDomains), associated_domains: [], site_domains: Array.from(editSelectedSiteDomains) }),
      })
      if (res.ok) { setShowEdit(false); await loadGroups() }
    } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/task-groups/${id}`, { method: 'DELETE' })
    if (res.ok) {
      const remaining = groups.filter(g => g.id !== id)
      setGroups(remaining)
      if (activeGroupId === id) setActiveGroupId(remaining[0]?.id ?? null)
    }
    setDeleteId(null)
  }

  // ── Right panel ─────────────────────────────────────────────────────────────

  const sortIcons = (col: string) => {
    const isAsc = sortCol === col && sortDir === 'asc'
    const isDesc = sortCol === col && sortDir === 'desc'
    const toggle = (dir: 'asc' | 'desc') => {
      setSortCol(sortCol === col && sortDir === dir ? '' : col)
      setSortDir(sortCol === col && sortDir === dir ? '' : dir)
    }
    return (
      <span className="inline-flex flex-col items-center gap-px select-none ml-0.5">
        <svg onClick={() => toggle('asc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor"
          className={`cursor-pointer ${isAsc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}>
          <path d="M4 0L8 5H0Z"/>
        </svg>
        <svg onClick={() => toggle('desc')} viewBox="0 0 8 5" width="8" height="5" fill="currentColor"
          className={`cursor-pointer ${isDesc ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}>
          <path d="M4 5L0 0H8Z"/>
        </svg>
      </span>
    )
  }

  function renderRightContent() {
    const pg = tabPage[rightTab]

    if (rightTab === 'recommend') {
      const pg_rec = tabPage['recommend']
      // Build sets of member's submitted keywords and URLs for matching — shared
      // by both 跌排更新/涨排更新, which are otherwise identical except direction.
      const submittedKwSet = new Set(claimedKeywords.map(k => (k.final_keyword || k.keyword).toLowerCase()))
      const submittedUrlSet = new Set(claimedKeywords.filter(k => k.page_url).map(k => normalizeUrl(k.page_url!).toLowerCase()))
      const matchAndRank = (data: typeof siteRankdownData) => {
        const matched = data.filter(r =>
          submittedKwSet.has(r.keyword.toLowerCase()) ||
          (r.url && submittedUrlSet.has(normalizeUrl(r.url).toLowerCase()))
        ).filter(r => !dismissedRecMap.has(r.keyword))
        return applyRecommendCooldown(matched)
      }
      const rankdownMatched = matchAndRank(siteRankdownData)
      const rankupMatched = matchAndRank(siteRankupData)

      const renderMoveTable = (direction: 'down' | 'up') => {
        const loading = direction === 'down' ? siteRankdownLoading : siteRankupLoading
        const rawData = direction === 'down' ? siteRankdownData : siteRankupData
        const matched = direction === 'down' ? rankdownMatched : rankupMatched
        const source = direction === 'down' ? '跌排更新' : '涨排更新'
        const moveLabel = direction === 'down' ? '跌幅' : '涨幅'
        if (loading) return <Spinner />
        if (matched.length === 0) {
          return (
            <div className="text-center py-10 text-gray-400 text-sm">
              {rawData.length === 0
                ? `近30天自有站无m端${direction === 'down' ? '下跌' : '上涨'}词`
                : `暂无与你提交记录匹配、且已过冷却期的${direction === 'down' ? '下跌' : '上涨'}词`}
            </div>
          )
        }
        return (
          <>
            <table className="w-full table-fixed">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="w-7" />
                <th className="px-3 py-2 text-left font-medium">关键词</th>
                <th className="px-2 py-2 text-left font-medium">排名页面</th>
                <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">现排名</th>
                <th className="px-2 py-2 text-center font-medium w-14 whitespace-nowrap">{moveLabel}</th>
                <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">搜索量</th>
                <th className="w-14" />
              </tr></thead>
              <tbody>
                {matched.slice(pg_rec * PAGE_SIZE, (pg_rec + 1) * PAGE_SIZE).map((r, i) => {
                  const claimed = claimedSet.has(r.keyword)
                  return (
                    <tr key={`${r.keyword}|${i}`} onDoubleClick={() => claimKeyword(r.keyword, source, r.volume)}
                      className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
                      title={claimed ? '已认领' : '双击认领'}>
                      <td className="pl-2 py-2">
                        <button onClick={e => { e.stopPropagation(); dismissRec(r.keyword) }}
                          className="w-5 h-5 rounded flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-base leading-none" title="移除此词">×</button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-sm text-gray-800 select-text cursor-text"
                          onDoubleClick={e => { e.stopPropagation(); claimKeyword(r.keyword, source, r.volume) }}
                          title={r.keyword}>
                          {r.keyword.length > 16 ? r.keyword.slice(0, 16) + '…' : r.keyword}
                        </span>
                        {claimed && <span className="ml-1.5 text-[10px] text-green-500">✓</span>}
                      </td>
                      <td className="px-2 py-2">
                        {r.url ? (
                          <a href={r.url.startsWith('http') ? r.url : `https://${r.url}`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-[11px] text-blue-500 hover:underline truncate block max-w-[130px]"
                            title={r.url}>
                            {r.url.replace(/^https?:\/\//, '').slice(0, 26)}{r.url.replace(/^https?:\/\//, '').length > 26 ? '…' : ''}
                          </a>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-2 py-2 text-center text-xs font-medium text-gray-700">
                        {r.rank_position ?? <span className="text-gray-400">脱排</span>}
                      </td>
                      <td className={`px-2 py-2 text-center text-xs font-medium ${direction === 'down' ? 'text-red-500' : 'text-green-600'}`}>
                        {direction === 'down'
                          ? (r.rank_position == null ? <span className="text-gray-400">脱排</span> : r.prev_rank != null ? `▼${r.rank_position - r.prev_rank}` : '—')
                          : (r.rank_position != null && r.prev_rank != null ? `▲${r.prev_rank - r.rank_position}` : '—')}
                      </td>
                      <td className="px-2 py-2 text-center text-xs text-gray-500">{r.volume > 0 ? fmtVol(r.volume) : '—'}</td>
                      <td className="px-2 py-2 text-right">
                        <button onClick={() => openDetail(r.keyword, source)}
                          className="text-xs border rounded px-1.5 py-0.5 text-gray-400 hover:text-gray-600 border-gray-200 transition-colors">详情</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pager page={pg_rec} total={matched.length} onPage={p => setPage('recommend', p)} />
          </>
        )
      }

      return (
        <div>
          {/* sub-tabs */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden mb-4 w-fit">
            {(['rankdown', 'rankup'] as RecSubTab[]).map(st => (
              <button key={st} onClick={() => { setRecSubTab(st); setPage('recommend', 0) }}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${recSubTab === st ? 'bg-green-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                {st === 'rankdown' ? '跌排更新' : '涨排更新'}
              </button>
            ))}
          </div>

          {recSubTab === 'rankdown' && renderMoveTable('down')}
          {recSubTab === 'rankup' && renderMoveTable('up')}
        </div>
      )
    }

    if (rightTab === 'search') {
      const totalPages = Math.ceil(searchTotal / PAGE_SIZE)
      return (
        <div>
          <div className="flex gap-2 mb-4">
            <input ref={searchInputRef} type="text" value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && triggerSearch()}
              placeholder="输入关键词..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
            <button onClick={triggerSearch} disabled={searchLoading}
              className="px-4 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
              {searchLoading ? '查询中...' : '查询'}
            </button>
          </div>
          {!searchQuery ? (
            <div className="text-center py-10 text-gray-400 text-sm">输入关键词后点击查询</div>
          ) : searchLoading ? <Spinner /> : searchResults.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">无结果</div>
          ) : (
            <>
              <table className="w-full">
                <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 text-left font-medium">关键词</th>
                  <th className="px-2 py-2 text-right font-medium w-24">搜索量</th>
                </tr></thead>
                <tbody>
                  {searchResults.map((r, i) => {
                    const claimed = claimedSet.has(r.keyword)
                    return (
                      <tr key={`${r.keyword}|${i}`} onDoubleClick={() => claimKeyword(r.keyword, '搜索量查询', r.volume)}
                        className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
                        title={claimed ? '已认领' : '双击认领'}>
                        <td className="px-3 py-2">
                          <span className="text-sm text-gray-800 select-text cursor-text"
                            onDoubleClick={e => { e.stopPropagation(); claimKeyword(r.keyword, '搜索量查询', r.volume) }}
                          >{r.keyword.length > 26 ? r.keyword.slice(0, 26) + '…' : r.keyword}</span>
                          {claimed && <span className="ml-1.5 text-[10px] text-green-500">✓</span>}
                        </td>
                        <td className="px-2 py-2 text-right text-xs text-gray-500 whitespace-nowrap">
                          <span className="inline-flex items-center gap-0.5">
                            {r.volume > 0 ? r.volume.toLocaleString() : '—'}
                            {r.latest_trend === 'rankup' && <span className="text-green-500 leading-none">↑</span>}
                            {r.latest_trend === 'rankdown' && <span className="text-red-400 leading-none">↓</span>}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-50">
                  <button onClick={() => doSearch(searchQuery, searchPage - 1)} disabled={searchPage === 0}
                    className="px-3 py-1 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 disabled:opacity-30 text-xs">上一页</button>
                  <span className="text-gray-400 text-xs">{searchPage + 1} / {totalPages}　共 {searchTotal} 条</span>
                  <button onClick={() => doSearch(searchQuery, searchPage + 1)} disabled={searchPage >= totalPages - 1}
                    className="px-3 py-1 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 disabled:opacity-30 text-xs">下一页</button>
                </div>
              )}
            </>
          )}
        </div>
      )
    }

    if (!radarLoaded || radarLoading) return <Spinner />

    if (rightTab === 'cross') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const base_cross = crossWords.filter(w => !submittedSet.has(w.keyword))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted_cross = sortCol && sortDir ? [...base_cross].sort((a: any, b: any) => {
        const va: any = sortCol === 'date' ? (a.last_date||'') : sortCol === 'volume' ? (a.volume??0) : 0
        const vb: any = sortCol === 'date' ? (b.last_date||'') : sortCol === 'volume' ? (b.volume??0) : 0
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        return sortDir === 'asc' ? va - vb : vb - va
      }) : base_cross
      const slice = sorted_cross.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE)
      return (
        <>
          <table className="w-full table-fixed">
            <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-medium w-24"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
              <th className="px-2 py-2 text-left font-medium">关键词</th>
              <th className="px-2 py-2 text-center font-medium w-24">命中维度</th>
              <th className="px-2 py-2 text-center font-medium w-24"><span className="inline-flex items-center justify-center gap-0.5">搜索量{sortIcons('volume')}</span></th>
              <th className="w-14" />
            </tr></thead>
            <tbody>
              {slice.map((w, i) => (
                <KwRow key={`${w.keyword}|${i}`} keyword={w.keyword} today={today} yesterday={yesterday}
                  badge={getBadge(w.first_date, w.last_date, yesterday)}
                  dateCell={<DateCell date={w.last_date} today={today} yesterday={yesterday} badge={getBadge(w.first_date, w.last_date, yesterday)} />}
                  claimed={claimedSet.has(w.keyword)}
                  onClaim={() => claimKeyword(w.keyword, '交叉词', w.volume)}
                  onView={() => openDetail(w.keyword, '交叉词')}>
                  <td className="px-2 py-2">
                    <div className="flex gap-1 justify-center">
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-600">新增</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-orange-50 text-orange-600">涨排</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.volume > 0 ? w.volume.toLocaleString() : '—'}</td>
                </KwRow>
              ))}
            </tbody>
          </table>
          <Pager page={pg} total={sorted_cross.length} onPage={p => setPage('cross', p)} />
        </>
      )
    }

    if (rightTab === 'rank') {
      const base_rank = rankWordsSorted.filter(w => !submittedSet.has(w.keyword))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted_rank = sortCol && sortDir ? [...base_rank].sort((a: any, b: any) => {
        const va: any = sortCol === 'date' ? (a.last_date||'') : sortCol === 'volume' ? (a.volume??0) : sortCol === 'rankDays' ? (a.rankDays??0) : 0
        const vb: any = sortCol === 'date' ? (b.last_date||'') : sortCol === 'volume' ? (b.volume??0) : sortCol === 'rankDays' ? (b.rankDays??0) : 0
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        return sortDir === 'asc' ? va - vb : vb - va
      }) : base_rank
      const slice = sorted_rank.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE)
      return (
        <>
          <table className="w-full table-fixed">
            <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-medium w-24"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
              <th className="px-2 py-2 text-left font-medium">关键词</th>
              <th className="px-2 py-2 text-center font-medium w-20"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">涨排次数{sortIcons('rankDays')}</span></th>
              <th className="px-2 py-2 text-center font-medium w-20"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">搜索量{sortIcons('volume')}</span></th>
              <th className="w-14" />
            </tr></thead>
            <tbody>
              {slice.map((w, i) => (
                <KwRow key={`${w.keyword}|${i}`} keyword={w.keyword} today={today} yesterday={yesterday}
                  badge={getBadge(w.first_date, w.last_date, yesterday)}
                  dateCell={<DateCell date={w.last_date} today={today} yesterday={yesterday} badge={getBadge(w.first_date, w.last_date, yesterday)} />}
                  claimed={claimedSet.has(w.keyword)}
                  onClaim={() => claimKeyword(w.keyword, '竞品涨排名', w.volume)}
                  onView={() => openDetail(w.keyword, '竞品涨排名')}>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.rankDays}次</td>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.volume > 0 ? w.volume.toLocaleString() : '—'}</td>
                </KwRow>
              ))}
            </tbody>
          </table>
          <Pager page={pg} total={sorted_rank.length} onPage={p => setPage('rank', p)} />
        </>
      )
    }

    if (rightTab === 'streak') {
      const base_streak = streakWords.filter(w => !submittedSet.has(w.keyword))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted_streak = sortCol && sortDir ? [...base_streak].sort((a: any, b: any) => {
        const va: any = sortCol === 'date' ? (a.last_date||'') : sortCol === 'volume' ? (a.volume??0) : sortCol === 'streak' ? (a.streak??0) : 0
        const vb: any = sortCol === 'date' ? (b.last_date||'') : sortCol === 'volume' ? (b.volume??0) : sortCol === 'streak' ? (b.streak??0) : 0
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        return sortDir === 'asc' ? va - vb : vb - va
      }) : base_streak
      const slice = sorted_streak.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE)
      return (
        <>
          <table className="w-full table-fixed">
            <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-medium w-24"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
              <th className="px-2 py-2 text-left font-medium">关键词</th>
              <th className="px-2 py-2 text-center font-medium w-20"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">上涨天数{sortIcons('streak')}</span></th>
              <th className="px-2 py-2 text-center font-medium w-20"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">搜索量{sortIcons('volume')}</span></th>
              <th className="w-14" />
            </tr></thead>
            <tbody>
              {slice.map((w, i) => (
                <KwRow key={`${w.keyword}|${i}`} keyword={w.keyword} today={today} yesterday={yesterday}
                  badge={getStreakBadge(w.streak, w.last_date, yesterday)}
                  dateCell={<DateCell date={w.last_date} today={today} yesterday={yesterday} badge={getStreakBadge(w.streak, w.last_date, yesterday)} />}
                  claimed={claimedSet.has(w.keyword)}
                  onClaim={() => claimKeyword(w.keyword, '连续上涨词', w.volume)}
                  onView={() => openDetail(w.keyword, '连续上涨词')}>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.streak}天</td>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.volume > 0 ? w.volume.toLocaleString() : '—'}</td>
                </KwRow>
              ))}
            </tbody>
          </table>
          <Pager page={pg} total={sorted_streak.length} onPage={p => setPage('streak', p)} />
        </>
      )
    }

    if (rightTab === 'newWords') {
      const base_new = allNewWords.filter(w => !submittedSet.has(w.keyword))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted_new = sortCol && sortDir ? [...base_new].sort((a: any, b: any) => {
        const va: any = sortCol === 'date' ? (a.last_date||'') : sortCol === 'count' ? (a.count??0) : sortCol === 'siteCount' ? (a.siteCount??0) : 0
        const vb: any = sortCol === 'date' ? (b.last_date||'') : sortCol === 'count' ? (b.count??0) : sortCol === 'siteCount' ? (b.siteCount??0) : 0
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        return sortDir === 'asc' ? va - vb : vb - va
      }) : base_new
      const slice = sorted_new.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE)
      return (
        <>
          <table className="w-full table-fixed">
            <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-medium w-24"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
              <th className="px-2 py-2 text-left font-medium">关键词</th>
              <th className="px-2 py-2 text-center font-medium w-20"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">新增次数{sortIcons('count')}</span></th>
              <th className="px-2 py-2 text-center font-medium w-16"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">站点数{sortIcons('siteCount')}</span></th>
              <th className="w-14" />
            </tr></thead>
            <tbody>
              {slice.map((w, i) => (
                <KwRow key={`${w.keyword}|${i}`} keyword={w.keyword} today={today} yesterday={yesterday}
                  badge={getBadge(w.first_date, w.last_date, yesterday)}
                  dateCell={<DateCell date={w.last_date} today={today} yesterday={yesterday} badge={getBadge(w.first_date, w.last_date, yesterday)} includeYesterday />}
                  claimed={claimedSet.has(w.keyword)}
                  onClaim={() => claimKeyword(w.keyword, '共新增词', 0)}
                  onView={() => openDetail(w.keyword, '共新增词')}>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.count}次</td>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.siteCount}站</td>
                </KwRow>
              ))}
            </tbody>
          </table>
          <Pager page={pg} total={sorted_new.length} onPage={p => setPage('newWords', p)} />
        </>
      )
    }

    if (rightTab === 'wordLib') {
      if (wordLibLoading) return <Spinner />
      const sorted_wl = sortCol && sortDir ? [...wordLibWords].sort((a: any, b: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const va: any = sortCol === 'date' ? (a.last_date||'') : sortCol === 'count' ? (a.longTailCount??0) : sortCol === 'siteCount' ? (a.siteCount??0) : 0 // eslint-disable-line @typescript-eslint/no-explicit-any
        const vb: any = sortCol === 'date' ? (b.last_date||'') : sortCol === 'count' ? (b.longTailCount??0) : sortCol === 'siteCount' ? (b.siteCount??0) : 0 // eslint-disable-line @typescript-eslint/no-explicit-any
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        return sortDir === 'asc' ? va - vb : vb - va
      }) : wordLibWords
      const filtered_wl = wordLibSearch ? sorted_wl.filter(w => w.keyword.includes(wordLibSearch)) : sorted_wl
      if (sorted_wl.length === 0) return <div className="text-center py-10 text-gray-400 text-sm">暂无词库数据</div>
      const slice = filtered_wl.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE)
      return (
        <>
          <table className="w-full table-fixed">
            <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-medium w-24"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
              <th className="px-3 py-2 text-left font-medium">
                <div className="flex items-center gap-1.5">
                  <span>关键词</span>
                  <input
                    type="text"
                    value={wordLibSearch}
                    onChange={e => { setWordLibSearch(e.target.value); setTabPage(prev => ({ ...prev, wordLib: 0 })) }}
                    placeholder="搜索关键词"
                    className="h-6 w-28 text-xs font-normal text-gray-700 placeholder-gray-300 border border-gray-200 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
                  />
                  {wordLibSearch && (
                    <button onClick={() => { setWordLibSearch(''); setTabPage(prev => ({ ...prev, wordLib: 0 })) }}
                      className="text-gray-300 hover:text-gray-500 leading-none">✕</button>
                  )}
                </div>
              </th>
              <th className="px-2 py-2 text-center font-medium w-20"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">长尾词数{sortIcons('count')}</span></th>
              <th className="px-2 py-2 text-center font-medium w-16"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">站点数{sortIcons('siteCount')}</span></th>
              <th className="w-14" />
            </tr></thead>
            <tbody>
              {slice.map((w, i) => (
                <KwRow key={`${w.keyword}|${i}`} keyword={w.keyword} today={today} yesterday={yesterday}
                  badge={getBadge(w.first_date, w.last_date, yesterday)}
                  dateCell={<DateCell date={w.last_date} today={today} yesterday={yesterday} badge={getBadge(w.first_date, w.last_date, yesterday)} includeYesterday />}
                  claimed={false}
                  onClaim={() => claimKeyword(w.keyword, '更新词库', 0)}
                  onView={() => openDetail(w.keyword, '更新词库')}>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.longTailCount}词</td>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.siteCount}站</td>
                </KwRow>
              ))}
            </tbody>
          </table>
          <Pager page={pg} total={filtered_wl.length} onPage={p => setPage('wordLib', p)} />
        </>
      )
    }

    if (rightTab === 'rankdown') {
      if (siteRankdownLoading) return <Spinner />
      // Available dates in data
      const availableDates = Array.from(new Set(siteRankdownData.map(r => r.stat_date))).sort().reverse()
      const selectedDate = rankdownDate || availableDates[0] || ''
      // Filter and deduplicate by keyword for the selected date
      const seenRd = new Set<string>()
      const dateRows = siteRankdownData
        .filter(r => r.stat_date === selectedDate && r.volume > 0)
        .filter(r => { if (seenRd.has(r.keyword)) return false; seenRd.add(r.keyword); return true })
        .sort((a, b) => b.volume - a.volume)
      return (
        <div>
          {/* Date picker */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs text-gray-400 flex-shrink-0">日期</span>
            <input type="date" value={selectedDate}
              min={availableDates[availableDates.length - 1] || ''}
              max={availableDates[0] || today}
              onChange={e => { setRankdownDate(e.target.value); setTabPage(prev => ({ ...prev, rankdown: 0 })) }}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400 text-gray-700 cursor-pointer" />
            {dateRows.length > 0 && (
              <span className="text-[10px] text-gray-300">m端下跌词 {dateRows.length} 条</span>
            )}
          </div>
          {siteRankdownData.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">近30天无m端下跌词</div>
          ) : dateRows.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">该日期暂无下跌词</div>
          ) : (
            <>
              <table className="w-full table-fixed">
                <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 text-left font-medium">关键词</th>
                  <th className="px-2 py-2 text-left font-medium">页面URL</th>
                  <th className="px-2 py-2 text-center font-medium w-14 whitespace-nowrap">现排名</th>
                  <th className="px-2 py-2 text-center font-medium w-12 whitespace-nowrap">上次</th>
                  <th className="px-2 py-2 text-center font-medium w-12 whitespace-nowrap">跌幅</th>
                  <th className="px-2 py-2 text-center font-medium w-14 whitespace-nowrap">搜索量</th>
                  <th className="w-14" />
                </tr></thead>
                <tbody>
                  {dateRows.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE).map((r, i) => {
                    const claimed = claimedSet.has(r.keyword)
                    const drop = (r.rank_position != null && r.prev_rank != null) ? r.rank_position - r.prev_rank : null
                    return (
                      <tr key={`rd-${r.keyword}|${i}`} onDoubleClick={() => claimKeyword(r.keyword, '跌词更新', r.volume)}
                        className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
                        title={claimed ? '已认领' : '双击认领'}>
                        <td className="px-3 py-2">
                          <span className="text-sm text-gray-800 select-text cursor-text" title={r.keyword}
                            onDoubleClick={e => { e.stopPropagation(); claimKeyword(r.keyword, '跌词更新', r.volume) }}>
                            {r.keyword.length > 16 ? r.keyword.slice(0, 16) + '…' : r.keyword}
                          </span>
                          {claimed && <span className="ml-1 text-[10px] text-green-500">✓</span>}
                        </td>
                        <td className="px-2 py-2">
                          {r.url ? (
                            <a href={r.url.startsWith('http') ? r.url : `https://${r.url}`}
                              target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-[11px] text-blue-500 hover:underline truncate block max-w-[140px]" title={r.url}>
                              {r.url.replace(/^https?:\/\//, '').slice(0, 28)}{r.url.replace(/^https?:\/\//, '').length > 28 ? '…' : ''}
                            </a>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center text-xs font-medium text-gray-700">
                          {r.rank_position ?? <span className="text-gray-400">脱排</span>}
                        </td>
                        <td className="px-2 py-2 text-center text-xs text-gray-400">{r.prev_rank ?? '—'}</td>
                        <td className="px-2 py-2 text-center text-xs font-medium">
                          {r.rank_position == null ? <span className="text-gray-400">脱排</span> : drop != null ? <span className="text-red-500">▼{drop}</span> : <span className="text-gray-300">新</span>}
                        </td>
                        <td className="px-2 py-2 text-center text-xs text-gray-500">{r.volume > 0 ? fmtVol(r.volume) : '—'}</td>
                        <td className="px-2 py-2 text-right">
                          <button onClick={() => openDetail(r.keyword, '跌词更新')}
                            className="text-xs border rounded px-1.5 py-0.5 text-gray-400 hover:text-gray-600 border-gray-200 transition-colors">详情</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <Pager page={pg} total={dateRows.length} onPage={p => setPage('rankdown', p)} />
            </>
          )}
        </div>
      )
    }

    return null
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-6"><Spinner /></div>

  const RIGHT_TABS: [RightTab, string][] = [
    ['recommend', '今日推荐'],
    ['search', '搜索量查询'], ['cross', '交叉词'], ['rank', '竞品涨排名'],
    ['streak', '连续上涨词'], ['newWords', '共新增词'], ['wordLib', '更新词库'], ['rankdown', '跌词更新'],
  ]

  function SourceTag({ s }: { s: string }) {
    const map: Record<string, string> = { '竞品涨排名': '竞品', '连续上涨词': '连涨', '共新增词': '新增', '搜索量查询': '搜索', '交叉词': '交叉', '更新词库': '词库', '手动添加': '手动', '更新推荐': '更新推荐', '规则推荐': '规则推荐', '竞品规则推荐': '竞品规则', '跌词更新': '跌词', '跌排更新': '跌排', '涨排更新': '涨排' }
    return <span className="text-[10px] text-gray-300 flex-shrink-0">{map[s] ?? s}</span>
  }

  // Detail modal inner content
  function DetailBody() {
    if (detailLoading) return <Spinner />
    if (detailSource === '更新词库') {
      if (wordLibSiteKws.length === 0) return <p className="text-sm text-gray-400 text-center py-10">暂无记录</p>
      return (
        <div className="space-y-3">
          {wordLibSiteKws.map(({ domain, keywords }) => (
            <div key={domain} className="border border-gray-100 rounded-lg p-3">
              <div className="font-medium text-sm text-gray-800 mb-2">{domain}</div>
              <div className="flex flex-wrap gap-1">
                {keywords.map(kw => (
                  <span key={kw} className="text-xs bg-blue-50 text-blue-700 rounded px-2 py-0.5">{kw}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }
    const isCross = detailSource === '交叉词'
    if (isCross) {
      return (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-blue-600 mb-2 pb-1 border-b border-blue-100">共新增词</p>
            {detailNewByDate.length === 0
              ? <p className="text-xs text-gray-400">暂无记录</p>
              : detailNewByDate.map(([date, domains]) => (
                <div key={date} className="flex items-start gap-2 mb-2">
                  <span className="text-xs text-gray-400 w-10 flex-shrink-0 pt-1">{date.slice(5)}</span>
                  <div className="flex flex-wrap gap-1">
                    {domains.map(d => {
                      const color = domainColorMap.get(d)
                      const w = domainWeightMap.get(d)
                      return (
                        <span key={d} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">
                          {color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
                          <span className="flex flex-col leading-tight">
                            <span>{d}</span>
                            {w && <span className="text-[10px] text-gray-400">PC{w.pc} · M{w.mobile}</span>}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
          </div>
          <div>
            <p className="text-xs font-semibold text-orange-500 mb-2 pb-1 border-b border-orange-100">竞品涨排名</p>
            {detailRankByDate.length === 0
              ? <p className="text-xs text-gray-400">暂无记录</p>
              : detailRankByDate.map(([date, domains]) => (
                <div key={date} className="flex items-start gap-2 mb-2">
                  <span className="text-xs text-gray-400 w-10 flex-shrink-0 pt-1">{date.slice(5)}</span>
                  <div className="flex flex-wrap gap-1">
                    {domains.map(d => {
                      const color = domainColorMap.get(d)
                      const w = domainWeightMap.get(d)
                      return (
                        <span key={d} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">
                          {color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
                          <span className="flex flex-col leading-tight">
                            <span>{d}</span>
                            {w && <span className="text-[10px] text-gray-400">PC{w.pc} · M{w.mobile}</span>}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )
    }
    const byDate = detailSource === '共新增词' ? detailNewByDate : detailRankByDate
    if (byDate.length === 0) return <p className="text-sm text-gray-400 text-center py-10">暂无记录</p>
    return (
      <div className="space-y-2">
        {byDate.map(([date, domains]) => (
          <div key={date} className="flex items-start gap-2">
            <span className="text-xs text-gray-400 w-10 flex-shrink-0 pt-1">{date.slice(5)}</span>
            <div className="flex flex-wrap gap-1">
              {domains.map(d => {
                      const color = domainColorMap.get(d)
                      const w = domainWeightMap.get(d)
                      return (
                        <span key={d} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">
                          {color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
                          <span className="flex flex-col leading-tight">
                            <span>{d}</span>
                            {w && <span className="text-[10px] text-gray-400">PC{w.pc} · M{w.mobile}</span>}
                          </span>
                        </span>
                      )
                    })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="p-6">
      {claimErrorMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          {claimErrorMsg}
        </div>
      )}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">分组任务</h1>
          <p className="text-gray-400 text-sm mt-0.5">按分组认领今日关键词</p>
        </div>
        <div className="flex items-center gap-3">
          <BaiduCookiePoolManager />
          {canManage && (
            <div className="flex items-center gap-2">
              <button onClick={openCreateModal} className="btn-primary">
                <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                新增分组
              </button>
              {activeGroup && <button onClick={openEditModal} className="inline-flex items-center px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-md hover:bg-blue-600 transition-colors">编辑分组</button>}
              {activeGroup && <button onClick={() => setDeleteId(activeGroup.id)} className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md border border-red-300 text-red-400 hover:bg-red-50 transition-colors">删除分组</button>}
            </div>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 text-gray-400">
          <p className="text-sm">{canManage ? '还没有分组，点击右上角新增' : '你尚未加入任何分组'}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 pt-3 pb-0 border-b border-gray-100 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
            {groups.map(g => (
              <button key={g.id} onClick={() => { setActiveGroupId(g.id); setViewingMemberId(currentUserId || null); setTabPage({ recommend: 0, search: 0, cross: 0, rank: 0, streak: 0, newWords: 0, wordLib: 0, rankdown: 0 }) }}
                className={`px-3 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap border-b-2 transition-colors ${activeGroupId === g.id ? 'border-green-500 text-green-700 bg-green-50/60' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                {g.name}
              </button>
            ))}
          </div>

          {activeGroup && (
            <div className="flex" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>
              {/* Left panel */}
              <div className="w-[280px] flex-shrink-0 border-r border-gray-100 flex flex-col">
                {canManage && activeGroup.members.length > 0 && (
                  <div className="px-3 pt-3 pb-2 flex flex-wrap gap-1.5 border-b border-gray-50">
                    {activeGroup.members.map(m => (
                      <button key={m.user_id} onClick={() => setViewingMemberId(m.user_id)}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${effectiveViewingId === m.user_id ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        {m.username}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
                  <span className="text-sm font-medium text-gray-700">今日任务 <span className="text-gray-400 font-normal">· {submittedCount}</span></span>
                  <input type="date" value={selectedDate} max={today}
                    onChange={e => setSelectedDate(e.target.value || today)}
                    className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500 cursor-pointer" />
                </div>
                <div ref={claimedListRef} className="flex-1 overflow-y-auto">
                  {claimedLoading ? <Spinner /> : claimedKeywords.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-300 text-sm py-12">
                      <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      暂无认领词
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {displayedClaims.map(k => {
                        const isExpanded = expandedClaimIds.has(k.id)
                        const hasDetail = !!(k.operation_type || k.final_keyword || k.page_url)
                        const isInvalid = invalidClaimIds.has(k.id)
                        return (
                          <div key={k.id} className={`transition-colors ${k.status !== 'pending' ? 'opacity-55' : ''}`}>
                            <div
                              className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer select-none ${isInvalid && !isExpanded ? 'bg-red-50/60' : ''}`}
                              onClick={() => setExpandedClaimIds(prev =>
                                prev.has(k.id) ? new Set<string>() : new Set<string>([k.id])
                              )}
                            >
                              {isViewingOwn && k.status === 'pending' ? (
                                <button onClick={e => { e.stopPropagation(); dismissClaimed(k.id) }} className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-sm leading-none">×</button>
                              ) : (
                                <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs ${k.status !== 'pending' ? 'text-green-400' : ''}`}>{k.status !== 'pending' ? '✓' : ''}</span>
                              )}
                              <span className="flex-1 text-sm text-gray-800 truncate" title={k.keyword}>{k.keyword}</span>
                              {hasDetail && !isExpanded && k.operation_type && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${k.operation_type === '新增' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>{k.operation_type}</span>
                              )}
                              <SourceTag s={k.source} />
                              <span className="text-gray-300 text-xs flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                            </div>
                            {isExpanded && isViewingOwn && (
                              <div className="px-3 pb-2.5 ml-7 space-y-1">
                                <div className="flex items-center gap-1.5">
                                  {(['新增', '更新'] as const).map(op => (
                                    <button key={op}
                                      onClick={() => { saveClaim(k.id, 'operation_type', k.operation_type === op ? '' : op); setInvalidClaimIds(prev => { const n = new Set(prev); n.delete(k.id); return n }) }}
                                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${k.operation_type === op ? (op === '新增' ? 'bg-green-500 border-green-500 text-white' : 'bg-blue-500 border-blue-500 text-white') : isInvalid && !k.operation_type ? 'border-red-300 text-red-400 hover:border-red-400' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                                      {op}
                                    </button>
                                  ))}
                                  {isInvalid && !k.operation_type && <span className="text-[10px] text-red-400">必选</span>}
                                </div>
                                <input
                                  type="text"
                                  defaultValue={k.final_keyword ?? ''}
                                  placeholder="最终做的词"
                                  className={`w-full text-xs px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-green-400 bg-white placeholder-gray-300 ${isInvalid && !k.final_keyword?.trim() ? 'border-red-300 placeholder-red-300' : 'border-gray-200'}`}
                                  onBlur={e => { if (e.target.value !== (k.final_keyword ?? '')) { saveClaim(k.id, 'final_keyword', e.target.value); if (e.target.value.trim()) setInvalidClaimIds(prev => { const n = new Set(prev); n.delete(k.id); return n }) } }}
                                />
                                <input
                                  type="text"
                                  defaultValue={k.page_url ?? ''}
                                  placeholder="https://..."
                                  className={`w-full text-xs px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-green-400 bg-white placeholder-gray-300 font-mono ${isInvalid && !k.page_url?.trim() ? 'border-red-300 placeholder-red-300' : 'border-gray-200'}`}
                                  onBlur={e => {
                                    const normalized = normalizeUrl(e.target.value)
                                    if (normalized !== e.target.value) e.target.value = normalized
                                    if (normalized !== (k.page_url ?? '')) {
                                      saveClaim(k.id, 'page_url', normalized)
                                      if (normalized.trim()) setInvalidClaimIds(prev => { const n = new Set(prev); n.delete(k.id); return n })
                                    }
                                  }}
                                />
                                {k.status === 'pending' && (
                                  <button onClick={() => submitOne(k.id)} disabled={submittingOneId === k.id}
                                    className="w-full mt-1 py-1 text-xs font-medium bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 transition-colors">
                                    {submittingOneId === k.id ? '提交中...' : '提交这一条'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                {isViewingOwn && (
                  <div className="border-t border-gray-100">
                    {showAddForm ? (
                      <div className="p-3 space-y-1.5 bg-gray-50/60">
                        <input
                          type="text"
                          value={addKw}
                          onChange={e => setAddKw(e.target.value)}
                          placeholder="关键词（必填）"
                          className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-green-400 bg-white"
                          autoFocus
                          onKeyDown={e => e.key === 'Enter' && addManualKeyword()}
                        />
                        <div className="flex items-center gap-1.5">
                          {(['新增', '更新'] as const).map(op => (
                            <button key={op} onClick={() => setAddOpType(op)}
                              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${addOpType === op ? (op === '新增' ? 'bg-green-500 border-green-500 text-white' : 'bg-blue-500 border-blue-500 text-white') : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                              {op}
                            </button>
                          ))}
                          <input
                            type="text"
                            value={addFinalKw}
                            onChange={e => setAddFinalKw(e.target.value)}
                            placeholder="最终做的词"
                            className="flex-1 min-w-0 text-xs px-2 py-0.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-green-400 bg-white"
                          />
                        </div>
                        <input
                          type="text"
                          value={addUrl}
                          onChange={e => setAddUrl(e.target.value)}
                          onBlur={e => setAddUrl(normalizeUrl(e.target.value))}
                          placeholder="https://..."
                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-green-400 bg-white font-mono"
                          onKeyDown={e => e.key === 'Enter' && addManualKeyword()}
                        />
                        <div className="flex gap-2 pt-0.5">
                          <button onClick={() => { setShowAddForm(false); setAddKw(''); setAddFinalKw(''); setAddUrl(''); setAddOpType('新增') }}
                            className="flex-1 py-1 text-xs text-gray-500 border border-gray-200 rounded hover:bg-gray-100 transition-colors">取消</button>
                          <button onClick={addManualKeyword} disabled={!addKw.trim() || addingManual}
                            className="flex-1 py-1 text-xs font-medium bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-40 transition-colors">
                            {addingManual ? '添加中…' : '添加'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="px-3 pt-2">
                        <button onClick={() => setShowAddForm(true)}
                          className="w-full py-1.5 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg hover:border-green-300 hover:text-green-500 transition-colors flex items-center justify-center gap-1">
                          <span className="text-base leading-none">+</span> 手动添加词
                        </button>
                      </div>
                    )}
                    <div className="p-3">
                      {invalidClaimIds.size > 0 && (
                        <p className="text-xs text-red-500 text-center mb-2">
                          {invalidClaimIds.size} 条词有未填项，请检查标红字段
                        </p>
                      )}
                      <button onClick={submitForDate} disabled={submitting || pendingCount === 0}
                        className={`w-full py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${invalidClaimIds.size > 0 ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-green-500 text-white hover:bg-green-600'}`}>
                        {submitting ? '提交中...' : invalidClaimIds.size > 0 ? `${invalidClaimIds.size} 条未完整` : `提交${selectedDate !== today ? ` (${selectedDate.slice(5).replace('-', '/')})` : ''}${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right panel */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex border-b border-gray-100 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
                  {RIGHT_TABS.map(([tab, label]) => (
                    <button key={tab} onClick={() => { setRightTab(tab); setSortCol(''); setSortDir('') }}
                      className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${rightTab === tab ? 'border-green-500 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {renderRightContent()}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <MemberModal
          mode="create" onClose={() => setShowCreate(false)}
          userOptions={userOptions} allSites={allSites}
          name={createName} onNameChange={setCreateName}
          siteDomains={selectedSiteDomains} onSiteDomainsChange={setSelectedSiteDomains}
          selUsers={selectedUsers} onSelUsersChange={setSelectedUsers}
          mTypes={memberTypes} onMTypesChange={setMemberTypes}
          rankDomains={selectedRankDomains} onRankDomainsChange={setSelectedRankDomains}
          newDomains={selectedNewDomains} onNewDomainsChange={setSelectedNewDomains}
          onSubmit={handleCreate} busy={creating}
        />
      )}
      {showEdit && activeGroup && (
        <MemberModal
          mode="edit" onClose={() => setShowEdit(false)}
          userOptions={userOptions} allSites={allSites}
          name={editName} onNameChange={setEditName}
          siteDomains={editSelectedSiteDomains} onSiteDomainsChange={setEditSelectedSiteDomains}
          selUsers={editSelectedUsers} onSelUsersChange={setEditSelectedUsers}
          mTypes={editMemberTypes} onMTypesChange={setEditMemberTypes}
          rankDomains={editSelectedRankDomains} onRankDomainsChange={setEditSelectedRankDomains}
          newDomains={editSelectedNewDomains} onNewDomainsChange={setEditSelectedNewDomains}
          onSubmit={handleEdit} busy={saving}
        />
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-2">确认删除</h3>
            <p className="text-sm text-gray-500 mb-5">删除后无法恢复，分组内的成员和设置都会清除。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="btn-ghost">取消</button>
              <button onClick={() => handleDelete(deleteId)} className="btn-danger">确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailKw && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailKw(null)}>
          <div className={`bg-white rounded-xl shadow-2xl w-full max-h-[80vh] flex flex-col ${detailSource === '交叉词' ? 'max-w-3xl' : 'max-w-lg'}`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">{detailKw}</h3>
                <p className="text-xs text-gray-400 mt-0.5">近30天出现记录</p>
              </div>
              <button onClick={() => setDetailKw(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {DetailBody()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
