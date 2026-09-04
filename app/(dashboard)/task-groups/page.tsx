'use client'

import Link from 'next/link'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { getBrowserClient } from '@/lib/supabase-browser'
import { buildGroupColorMap } from '@/lib/company-groups'
import { fetchAllRows } from '@/lib/supabase-paginate'
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
interface VolumeRisingWord {
  keyword: string; volume: number; prevVolume: number | null; change: number; last_date: string
  sites: string[]; rankTrend: 'up' | 'down' | 'both' | null
}

interface ClaimedKeyword {
  id: string; keyword: string; source: string
  search_volume: number; status: string; created_at: string
  operation_type: string | null; final_keyword: string | null; page_url: string | null
  claimed_date?: string
}

interface SubmissionHistoryRow {
  id: string
  user_id: string
  keyword: string
  final_keyword: string | null
  page_url: string | null
  operation_type: string | null
  submitted_at: string | null
  claimed_date: string
}

type RightTab = 'distribute' | 'recommend' | 'search' | 'volumeRising' | 'cross' | 'rank' | 'streak' | 'newWords' | 'wordLib' | 'rankdown'
type RecSubTab = 'rankdown' | 'rankup'
type Badge = 'new' | 'updated' | null
interface DetailRow { date: string; domain: string }
interface VolumeRisingDetailRow { date: string; domain: string; type: 'rankup' | 'rankdown' }

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

async function apiError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { error?: string }
  return body.error || fallback
}

function buildSubmissionHistory(rows: SubmissionHistoryRow[]) {
  const kwMap = new Map<string, { lastSubmittedAt: string; updateCount: number }>()
  const urlSet = new Set<string>()
  for (const row of rows) {
    const keyword = (row.final_keyword || row.keyword).toLowerCase()
    const submittedAt = row.submitted_at || row.claimed_date
    const updateCount = row.operation_type === '更新' ? 1 : 0
    const existing = kwMap.get(keyword)
    if (!existing) kwMap.set(keyword, { lastSubmittedAt: submittedAt, updateCount })
    else kwMap.set(keyword, {
      lastSubmittedAt: submittedAt > existing.lastSubmittedAt ? submittedAt : existing.lastSubmittedAt,
      updateCount: existing.updateCount + updateCount,
    })
    if (row.page_url) urlSet.add(normalizeUrl(row.page_url).toLowerCase())
  }
  return { kwMap, urlSet }
}

// site_keyword_ranks 30天窗口里同一个关键词经常在好几个不同 stat_date 都有
// 记录（比如连续多天都在"下跌"名单里）——"今日推荐"按关键词展示，不按天，
// 不去重的话同一个词会在表里重复出现好几行。传入的数组要求已经按
// stat_date desc（新的在前）排序，保留每个关键词第一次出现的那行即可
// （即最新的一天）。2026-08-17 用户反馈"跌排更新里面有很多重复的东西"
// 排查出的根因。
function dedupeByKeyword<T extends { keyword: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (seen.has(r.keyword)) return false
    seen.add(r.keyword)
    return true
  })
}

// 跌排更新/跌词更新：同一个URL经常同时命中好几个词（同一个页面标题/内容
// 里带了多个关键词），2026-08-20 用户反馈"同一个url的东西应该只显示一条，
// 以最高搜索量的为准"——按URL合并，每个URL只保留搜索量最高的那一行代表；
// 没有URL的行（url为空）没法归并，原样保留各自一行。
function dedupeByUrl<T extends { url: string | null; volume: number }>(rows: T[]): T[] {
  const best = new Map<string, T>()
  const noUrl: T[] = []
  for (const r of rows) {
    if (!r.url) { noUrl.push(r); continue }
    const key = normalizeUrl(r.url).toLowerCase()
    const existing = best.get(key)
    if (!existing || r.volume > existing.volume) best.set(key, r)
  }
  return [...Array.from(best.values()), ...noUrl]
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
    <tr onDoubleClick={() => { if (!claimed) onClaim() }}
      className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
      title={claimed ? '已认领' : '点击认领按钮，或双击此行快捷认领'}>
      {dateCell}
      <td className="px-2 py-2 max-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-sm text-gray-800 truncate select-text cursor-text" title={keyword}
            onDoubleClick={e => { e.stopPropagation(); if (!claimed) onClaim() }}>{keyword}</span>
          {claimed && <span className="text-[10px] text-green-500 flex-shrink-0">✓</span>}
        </div>
      </td>
      {children}
      <td className="px-2 py-2 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={claimed}
            aria-label={claimed ? `${keyword} 已认领` : `认领 ${keyword}`}
            onClick={e => { e.stopPropagation(); onClaim() }}
            className="text-xs rounded px-2 py-1 border border-green-200 text-green-700 hover:bg-green-50 disabled:border-gray-200 disabled:text-gray-400 disabled:bg-gray-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-green-500"
          >{claimed ? '已认领' : '认领'}</button>
          <button type="button" aria-label={`查看 ${keyword} 详情`} onClick={e => { e.stopPropagation(); onView() }}
            className="text-xs text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-2 py-1 hover:border-blue-400 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500">查看</button>
        </div>
      </td>
    </tr>
  )
}

function ClaimAction({ keyword, claimed, onClaim, compact = false }: {
  keyword: string
  claimed: boolean
  onClaim: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      disabled={claimed}
      aria-label={claimed ? `${keyword} 已认领` : `认领 ${keyword}`}
      onClick={event => { event.stopPropagation(); onClaim() }}
      className={`${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} text-xs rounded border border-green-200 text-green-700 hover:bg-green-50 disabled:border-gray-200 disabled:text-gray-400 disabled:bg-gray-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-green-500`}
    >{claimed ? '已认领' : '认领'}</button>
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
    <div role="dialog" aria-modal="true" aria-label="编辑分组" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-semibold text-gray-900">{isCreate ? '新增分组' : '编辑分组'}</h3>
          <button type="button" aria-label="关闭分组窗口" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">分组名称</label>
            <input aria-label="输入内容" type="text" value={name} onChange={e => onNameChange(e.target.value)}
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
              <input aria-label="输入内容" type="text" value={siteSearch} onChange={e => setSiteSearch(e.target.value)}
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
                    <input aria-label="选择此项" type="checkbox" checked={isSelected}
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

export default function TaskGroupsPage({ groupId }: { groupId?: string }) {
  const { role, id: currentUserId } = useUser()
  const router = useRouter()
  const canManage = role === 'super' || role === 'admin'
  const isSuper = role === 'super'
  const isWorkspaceRoute = !!groupId
  const today = useMemo(() => getMYDate(), [])
  const yesterday = useMemo(() => getMYDate(-1), [])

  const [groups, setGroups] = useState<TaskGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ scope: 'groups' | 'claimed' | 'radar' | 'distributed' | 'recommendations'; message: string } | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(groupId ?? null)
  const [workspaceOpen, setWorkspaceOpen] = useState(isWorkspaceRoute)

  const [viewingMemberId, setViewingMemberId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(today)
  const [claimedKeywords, setClaimedKeywords] = useState<ClaimedKeyword[]>([])
  const [claimedLoading, setClaimedLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submittingOneId, setSubmittingOneId] = useState<string | null>(null)
  const [claimErrorMsg, setClaimErrorMsg] = useState<string | null>(null)

  const [rightTab, setRightTab] = useState<RightTab>('recommend')
  const [tabPage, setTabPage] = useState<Record<RightTab, number>>({ distribute: 0, recommend: 0, search: 0, volumeRising: 0, cross: 0, rank: 0, streak: 0, newWords: 0, wordLib: 0, rankdown: 0 })
  const [recSubTab, setRecSubTab] = useState<RecSubTab>('rankdown')
  // 点×移除某个跌排/涨排更新推荐词——持久化到数据库、7天冷却，不再是刷新页面
  // 就重新出现的临时前端状态，2026-07-29 加入。
  const [dismissedRecMap, setDismissedRecMap] = useState<Map<string, string>>(new Map())
  // 点×先弹一个"永久移除/7天后再显示"的选择，不直接执行——2026-08-17 用户
  // 要求，之前是直接永久按7天冷却处理，点错了没有二次确认的机会。
  const [dismissConfirm, setDismissConfirm] = useState<{ keyword: string; targetUserId: string; memberName?: string } | null>(null)
  const [dismissedRecKey, setDismissedRecKey] = useState<string | null>(null)
  const [siteRankdownData, setSiteRankdownData] = useState<{ keyword: string; stat_date: string; rank_position: number; prev_rank: number | null; volume: number; url: string | null; title: string | null }[]>([])
  const [siteRankdownLoading, setSiteRankdownLoading] = useState(false)
  const [siteRankdownGroupId, setSiteRankdownGroupId] = useState<string | null>(null)
  // "涨排更新"tab 2026-08-17 改成看竞品的涨排（不是我们自己站的）——用户
  // 原话"我是要找这个词我们没有做到收录或排名的东西来做更新，就是根据近期
  // 竞品有拿到这个词的涨排的来做比较""看竞品涨排是看他们的涨而已"。跟原来
  // "跌排更新"（看自己站，跟自己历史做过的词匹配）是两套完全不同的逻辑：
  // 这边看的是"竞品最近涨了什么词"×"这个词我们自己完全没有排名"的交集。
  const [competitorRankupData, setCompetitorRankupData] = useState<{ keyword: string; stat_date: string; rank_position: number; prev_rank: number | null; volume: number; url: string | null; title: string | null; ownUrl: string | null; ownUserId: string | null; ownCreatedAt: string | null }[]>([])
  const [competitorRankupLoading, setCompetitorRankupLoading] = useState(false)
  const [competitorRankupGroupId, setCompetitorRankupGroupId] = useState<string | null>(null)
  // 组员对某个词最近一次"新增/更新"提交时间 + 历史"更新"次数 —— 用于给
  // 跌排更新/涨排更新推荐做冷却（7天内提交过的词不再重复推荐）和优先级
  // （反复更新过的词优先级更低）排序，2026-07-29 加入。
  const [submissionHistoryMap, setSubmissionHistoryMap] = useState<Map<string, { lastSubmittedAt: string; updateCount: number }>>(new Map())
  // 历史提交过的URL集合（跟 submissionHistoryMap 同一次查询里一起建，跌排/涨排
  // 更新推荐按关键词或URL任一匹配即可，见下面 matchAndRank 用它替换掉原来
  // 只看"今天"claimedKeywords 的那个bug）。
  const [submissionHistoryUrlSet, setSubmissionHistoryUrlSet] = useState<Set<string>>(new Set())
  const [submissionHistoryKey, setSubmissionHistoryKey] = useState<string | null>(null)
  // 管理员看"今日推荐"的合并视图（跌排/涨排更新）——全组每个组员各自的历史
  // 提交记录+7天冷却豁免/dismiss记录，2026-08-17 加入。跟上面单组员版本
  // （submissionHistoryMap/submissionHistoryUrlSet/dismissedRecMap）结构一样，
  // 只是按 user_id 分开存一份，渲染时逐组员算出各自的匹配结果再合到一张表。
  const [allMembersHistory, setAllMembersHistory] = useState<Map<string, { kwMap: Map<string, { lastSubmittedAt: string; updateCount: number }>; urlSet: Set<string> }>>(new Map())
  const [allMembersHistoryKey, setAllMembersHistoryKey] = useState<string | null>(null)
  const [allMembersDismissed, setAllMembersDismissed] = useState<Map<string, Map<string, string>>>(new Map())
  const [allMembersDismissedKey, setAllMembersDismissedKey] = useState<string | null>(null)
  const [rdPage, setRdPage] = useState(0)
  const [rankdownDate, setRankdownDate] = useState('')

  // 分发词 tab: 管理员手动指定一批词让组员认领，2026-08 加入
  interface DistributedWord {
    id: string; keyword: string; volume: number; volume_source: 'exact' | 'base_match' | 'unknown'
    matched_keyword: string | null; repeatable: boolean; claimedBy: string | null; cooldownDaysLeft: number | null
    batch_name: string | null; daily_limit: number | null
  }
  const [distributedWords, setDistributedWords] = useState<DistributedWord[]>([])
  const [distributedLoading, setDistributedLoading] = useState(false)
  const [showDistributeModal, setShowDistributeModal] = useState(false)
  const [distributeText, setDistributeText] = useState('')
  const [distributeRepeatable, setDistributeRepeatable] = useState(false)
  const [distributeCooldownDays, setDistributeCooldownDays] = useState('7')
  const [distributeDailyLimit, setDistributeDailyLimit] = useState('')
  const [distributeBatchName, setDistributeBatchName] = useState('')
  const [distributeSaving, setDistributeSaving] = useState(false)
  const [distributeMsg, setDistributeMsg] = useState('')
  const [distributeClearing, setDistributeClearing] = useState(false)

  const [radarData, setRadarData] = useState<{ newWords: NewWord[]; rankWords: RankWord[]; streakWords: StreakWord[]; volumeRisingWords: VolumeRisingWord[] } | null>(null)
  const [radarLoaded, setRadarLoaded] = useState(false)
  const [radarLoading, setRadarLoading] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ keyword: string; volume: number; latest_trend?: string | null; volume_change?: number | null }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchPage, setSearchPage] = useState(0)

  // Detail modal
  const [siteIdMap, setSiteIdMap] = useState<Map<string, string>>(new Map())
  const [detailKw, setDetailKw] = useState<string | null>(null)
  const [detailSource, setDetailSource] = useState<string>('')
  const [detailNewRows, setDetailNewRows] = useState<DetailRow[]>([])
  const [detailRankRows, setDetailRankRows] = useState<DetailRow[]>([])
  const [detailVolumeRisingRows, setDetailVolumeRisingRows] = useState<VolumeRisingDetailRow[]>([])
  const [detailUrlSiblings, setDetailUrlSiblings] = useState<{ keyword: string; rank_position: number | null; volume: number }[]>([])
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
  const [deleteUsername, setDeleteUsername] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
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
  const detailCacheRef = useRef<Map<string, { newRows: DetailRow[]; rankRows: DetailRow[]; wordLibSiteKws: { domain: string; keywords: string[] }[]; volumeRisingRows: VolumeRisingDetailRow[] }>>(new Map())

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

  // 搜索量上涨：keyword_volume 没有站点归属，跟其他几类不一样不按分组的
  // 站点域名过滤，全组共享同一份全局列表。
  const volumeRisingWordsSorted = useMemo(() => {
    if (!radarData) return []
    return [...radarData.volumeRisingWords].sort((a, b) => b.last_date.localeCompare(a.last_date) || b.change - a.change)
  }, [radarData])

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

  async function loadSiteRankdown(force = false) {
    if (!activeGroup || (!force && siteRankdownGroupId === activeGroup.id) || siteRankdownLoading) return
    const ownDomains = activeGroup.site_domains
    // 之前这里domains为空就直接return，没清空siteRankdownData——切到一个没配
    // 自己站点的分组时，屏幕上会一直留着上一个分组的"跌词更新"数据没消失，
    // 看起来像两个分组数据串了（2026-08-06 用户反馈排查出的根因）。
    if (ownDomains.length === 0) { setSiteRankdownData([]); setSiteRankdownGroupId(activeGroup.id); return }
    setSiteRankdownLoading(true)
    try {
      const supabase = getBrowserClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: siteData } = await (supabase.from('sites') as any)
        .select('id').in('domain', ownDomains)
      const siteIds = ((siteData || []) as { id: string }[]).map(s => s.id)
      if (siteIds.length > 0) {
        const since = getMYDate(-30)
        // 2026-08-20 改读 keyword_signal_rollup（增量维护的汇总表，见
        // lib/hot-radar.ts 同名注释）——不再现场扫 site_keyword_ranks 30天窗口，
        // 用列别名对齐原来的字段名，下面的 dedupeByKeyword/展示逻辑不用改。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawRows = await fetchAllRows<{ keyword: string; stat_date: string; rank_position: number; prev_rank: number | null; volume: number; url: string | null; title: string | null }>((from, to) =>
          (supabase.from('keyword_signal_rollup') as any)
            .select('keyword, stat_date:last_seen, rank_position:latest_rank_position, prev_rank:latest_prev_rank, volume:max_volume, url:latest_url, title:latest_title')
            .in('site_id', siteIds)
            .eq('type', 'rankdown')
            .gte('last_seen', since)
            .order('last_seen', { ascending: false })
            .order('max_volume', { ascending: false })
            .order('site_id', { ascending: true })
            .order('keyword', { ascending: true })
            .range(from, to)
        )
        const rows = dedupeByKeyword(rawRows)
        setSiteRankdownData(rows)
        // Default date = most recent stat_date in data
        if (rows.length > 0) setRankdownDate(prev => prev || rows[0].stat_date)
      } else {
        setSiteRankdownData([])
      }
      setSiteRankdownGroupId(activeGroup.id)
      setRdPage(0)
    } catch (error) {
      setLoadError({ scope: 'recommendations', message: error instanceof Error ? error.message : '跌排推荐加载失败' })
    } finally { setSiteRankdownLoading(false) }
  }

  // 竞品涨排×我方零覆盖的交集——步骤：
  // 1. 竞品范围＝所有正在跟踪、且不是"任何一个分组"自家站点的站（用户明确
  //    要"全部在跟踪中的非自家站点"，不局限于当前分组配置的竞品）。
  // 2. 从这批竞品站最近30天的m端涨排里取词（跟"跌排更新"同一张表
  //    site_keyword_ranks，同一套30天窗口/3000行上限处理方式）。
  // 3. 排掉我们自己站（当前分组的site_domains）已经有排名的词——不管是不是
  //    这批涨排里同一个url，只要词一样就算我们已经覆盖了。
  // 4. "排名页面"优先显示我们自己历史上给这个词提交过的URL（哪怕还没排名，
  //    有页面可以直接改），没有的话才显示竞品的URL当参考。
  async function loadCompetitorRankup(force = false) {
    if (!activeGroup || (!force && competitorRankupGroupId === activeGroup.id) || competitorRankupLoading) return
    const ownDomains = activeGroup.site_domains
    if (ownDomains.length === 0) { setCompetitorRankupData([]); setCompetitorRankupGroupId(activeGroup.id); return }
    setCompetitorRankupLoading(true)
    try {
      const supabase = getBrowserClient()
      const [{ data: ownSiteData }, { data: allSites }, { data: allGroups }] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('sites') as any).select('id').in('domain', ownDomains),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('sites') as any).select('id, domain'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('task_groups') as any).select('site_domains'),
      ])
      const ownSiteIds = ((ownSiteData || []) as { id: string }[]).map(s => s.id)
      const globalOwnDomains = new Set<string>()
      for (const g of (allGroups || []) as { site_domains: string[] | null }[]) {
        for (const d of g.site_domains ?? []) globalOwnDomains.add(d)
      }
      const competitorSiteIds = ((allSites || []) as { id: string; domain: string }[])
        .filter(s => !globalOwnDomains.has(s.domain))
        .map(s => s.id)

      if (ownSiteIds.length === 0 || competitorSiteIds.length === 0) {
        setCompetitorRankupData([])
        setCompetitorRankupGroupId(activeGroup.id)
        return
      }

      const since = getMYDate(-30)
      // 2026-08-20 改读 keyword_signal_rollup，理由同 loadSiteRankdown。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rankupRows = await fetchAllRows<{ keyword: string; stat_date: string; rank_position: number; prev_rank: number | null; volume: number; url: string | null; title: string | null }>((from, to) =>
        (supabase.from('keyword_signal_rollup') as any)
          .select('keyword, stat_date:last_seen, rank_position:latest_rank_position, prev_rank:latest_prev_rank, volume:max_volume, url:latest_url, title:latest_title')
          .in('site_id', competitorSiteIds)
          .eq('type', 'rankup')
          .gte('last_seen', since)
          .order('last_seen', { ascending: false })
          .order('max_volume', { ascending: false })
          .order('site_id', { ascending: true })
          .order('keyword', { ascending: true })
          .range(from, to)
      )
      const candidates = dedupeByKeyword(rankupRows)

      // 分批查：这批词是不是我们自己站已经有排名了（有排名≈已经收录，见
      // 项目里"没排名不判定收录"的自愈逻辑同一个道理，不用再单独查收录表）。
      // CJK关键词批量 .in() 之前踩过 header 超限的坑（project_supabase_
      // in_query_header_overflow），这里保守按100一批。
      const distinctKeywords = Array.from(new Set(candidates.map(c => c.keyword)))
      const ownRankedKeywords = new Set<string>()
      const KW_BATCH = 100
      const kwChunks = (arr: string[]) => {
        const out: string[][] = []
        for (let i = 0; i < arr.length; i += KW_BATCH) out.push(arr.slice(i, i + KW_BATCH))
        return out
      }
      await Promise.all(kwChunks(distinctKeywords).map(async chunk => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ownRanks = await fetchAllRows<{ id: string; keyword: string }>((from, to) =>
          (supabase.from('site_keyword_ranks') as any)
            .select('id, keyword')
            .in('site_id', ownSiteIds)
            .in('keyword', chunk)
            .eq('platform', 'mobile')
            .not('rank_position', 'is', null)
            .order('id', { ascending: true })
            .range(from, to)
        )
        for (const r of ownRanks) ownRankedKeywords.add(r.keyword)
      }))
      const gaps = candidates.filter(c => !ownRankedKeywords.has(c.keyword))

      // 2026-08-17 用户进一步收窄范围："我要的只是组员们自己提交过的词，别的
      // 站点拿到涨排名作为一个信号"——不要"我们从没做过、只能给竞品URL当
      // 参考"那种情况，只保留组员历史上真的提交过页面的词（不分组员、不分
      // 是否已提交），竞品涨排在这里纯粹是"该优先更新哪个词"的信号，不是
      // 用来发现全新的词。
      const gapKeywordsOriginalCase = Array.from(new Set(gaps.map(c => c.keyword)))
      // 2026-08-17 加上 user_id——用户要"分发回给他们自己提交过的人"，得知道
      // 是哪个组员提交的这个URL才能告诉他"别人站点涨排名了，去更新一下"。
      // 按 created_at 倒序取，同一个词多个组员都提交过时，认最近提交的那个
      // （最可能还在维护这个页面的人）。
      const ownUrlByKeyword = new Map<string, { url: string; userId: string; createdAt: string }>()
      // 不用 .or() 拼手写filter字符串（关键词里万一带逗号/括号会拼坏查询），
      // 按 keyword 和 final_keyword 分两次批量查，结果自己在内存里合并、
      // 按 created_at 比较谁更新，保留最近提交的那条。
      await Promise.all(kwChunks(gapKeywordsOriginalCase).map(async chunk => {
        const [byKeyword, byFinal] = await Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fetchAllRows<{ id: string; keyword: string; final_keyword: string | null; page_url: string | null; user_id: string; created_at: string }>((from, to) =>
            (supabase.from('member_claimed_keywords') as any)
              .select('id, keyword, final_keyword, page_url, user_id, created_at')
              .eq('group_id', activeGroup.id).not('page_url', 'is', null).in('keyword', chunk)
              .order('id', { ascending: true }).range(from, to)
          ),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fetchAllRows<{ id: string; keyword: string; final_keyword: string | null; page_url: string | null; user_id: string; created_at: string }>((from, to) =>
            (supabase.from('member_claimed_keywords') as any)
              .select('id, keyword, final_keyword, page_url, user_id, created_at')
              .eq('group_id', activeGroup.id).not('page_url', 'is', null).in('final_keyword', chunk)
              .order('id', { ascending: true }).range(from, to)
          ),
        ])
        for (const r of [...byKeyword, ...byFinal]) {
          if (!r.page_url) continue
          const kw = (r.final_keyword || r.keyword).toLowerCase()
          const existing = ownUrlByKeyword.get(kw)
          if (!existing || r.created_at > existing.createdAt) {
            ownUrlByKeyword.set(kw, { url: r.page_url, userId: r.user_id, createdAt: r.created_at })
          }
        }
      }))

      const rows = gaps
        .map(c => {
          const own = ownUrlByKeyword.get(c.keyword.toLowerCase())
          return { ...c, ownUrl: own?.url ?? null, ownUserId: own?.userId ?? null, ownCreatedAt: own?.createdAt ?? null }
        })
        .filter(r => r.ownUrl != null)
      setCompetitorRankupData(rows)
      setCompetitorRankupGroupId(activeGroup.id)
      setRdPage(0)
    } catch (error) {
      setLoadError({ scope: 'recommendations', message: error instanceof Error ? error.message : '涨排推荐加载失败' })
    } finally { setCompetitorRankupLoading(false) }
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
      const rows = await fetchAllRows<SubmissionHistoryRow>((from, to) =>
        (supabase.from('member_claimed_keywords') as any)
          .select('id, user_id, keyword, final_keyword, page_url, operation_type, submitted_at, claimed_date')
          .eq('group_id', activeGroup.id)
          .eq('user_id', effectiveViewingId)
          .eq('status', 'submitted')
          .order('id', { ascending: true })
          .range(from, to)
      )
      const { kwMap, urlSet } = buildSubmissionHistory(rows)
      setSubmissionHistoryMap(kwMap)
      setSubmissionHistoryUrlSet(urlSet)
      setSubmissionHistoryKey(key)
    } catch (error) {
      setLoadError({ scope: 'recommendations', message: error instanceof Error ? error.message : '提交历史加载失败' })
    }
  }

  async function loadDismissedRec() {
    if (!activeGroup || !effectiveViewingId) return
    const key = `${activeGroup.id}|${effectiveViewingId}`
    if (dismissedRecKey === key) return
    try {
      const response = await fetch(`/api/task-groups/${activeGroup.id}/dismissals?userId=${encodeURIComponent(effectiveViewingId)}`)
      if (!response.ok) throw new Error('Failed to load dismissals')
      const { rows: data } = await response.json()
      const map = new Map<string, string>()
      for (const r of (data || []) as { keyword: string; dismissed_at: string }[]) map.set(r.keyword, r.dismissed_at)
      setDismissedRecMap(map)
      setDismissedRecKey(key)
    } catch (error) {
      setLoadError({ scope: 'recommendations', message: error instanceof Error ? error.message : '已移除推荐加载失败' })
    }
  }

  // 管理员"今日推荐"合并视图用——一次性把全组每个组员各自的历史提交记录都
  // 拉回来（跟 loadSubmissionHistory 同一份查询逻辑，只是不锁定某一个
  // effectiveViewingId）。这里一次查询全组再在内存中分组，避免成员越多就
  // 多发一条查询的 N+1 问题。
  async function loadAllMembersSubmissionHistory() {
    if (!activeGroup || !canManage || activeGroup.members.length === 0) return
    const key = activeGroup.id
    if (allMembersHistoryKey === key) return
    try {
      const supabase = getBrowserClient()
      const memberIds = activeGroup.members.map(member => member.user_id)
      const rows = await fetchAllRows<SubmissionHistoryRow>((from, to) =>
        (supabase.from('member_claimed_keywords') as any)
          .select('id, user_id, keyword, final_keyword, page_url, operation_type, submitted_at, claimed_date')
          .eq('group_id', activeGroup.id)
          .in('user_id', memberIds)
          .eq('status', 'submitted')
          .order('id', { ascending: true })
          .range(from, to)
      )
      const rowsByMember = new Map<string, SubmissionHistoryRow[]>()
      for (const row of rows) {
        if (!rowsByMember.has(row.user_id)) rowsByMember.set(row.user_id, [])
        rowsByMember.get(row.user_id)!.push(row)
      }
      const results = activeGroup.members.map(member => [
        member.user_id,
        buildSubmissionHistory(rowsByMember.get(member.user_id) || []),
      ] as const)
      setAllMembersHistory(new Map(results))
      setAllMembersHistoryKey(key)
    } catch (error) {
      setLoadError({ scope: 'recommendations', message: error instanceof Error ? error.message : '全组提交历史加载失败' })
    }
  }

  async function loadAllMembersDismissed() {
    if (!activeGroup || !canManage || activeGroup.members.length === 0) return
    const key = activeGroup.id
    if (allMembersDismissedKey === key) return
    try {
      const response = await fetch(`/api/task-groups/${activeGroup.id}/dismissals?all=1`)
      if (!response.ok) throw new Error('Failed to load dismissals')
      const { rows: data } = await response.json()
      const byMember = new Map<string, Map<string, string>>()
      for (const r of (data || []) as { user_id: string; keyword: string; dismissed_at: string }[]) {
        if (!byMember.has(r.user_id)) byMember.set(r.user_id, new Map())
        byMember.get(r.user_id)!.set(r.keyword, r.dismissed_at)
      }
      setAllMembersDismissed(byMember)
      setAllMembersDismissedKey(key)
    } catch (error) {
      setLoadError({ scope: 'recommendations', message: error instanceof Error ? error.message : '全组移除记录加载失败' })
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
  // historyMap 默认用当前查看组员的（submissionHistoryMap）——合并视图对每个
  // 组员分别传各自的历史记录进来，冷却期判断互不影响。
  function applyRecommendCooldown<T extends { keyword: string; volume: number }>(
    rows: T[],
    historyMap: Map<string, { lastSubmittedAt: string; updateCount: number }> = submissionHistoryMap
  ): T[] {
    const today = getMYDate(0)
    return rows
      .map(r => {
        const info = historyMap.get(r.keyword.toLowerCase())
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
      if (!res.ok) throw new Error(await apiError(res, '分组加载失败'))
      const data = await res.json()
      const list: TaskGroup[] = data.groups || []
      setGroups(list)
      if (groupId) {
        const hasRequestedGroup = list.some(group => group.id === groupId)
        setActiveGroupId(hasRequestedGroup ? groupId : null)
        setWorkspaceOpen(hasRequestedGroup)
      } else {
        setActiveGroupId(current => current && list.some(group => group.id === current) ? current : null)
        setWorkspaceOpen(false)
      }
      setLoadError(current => current?.scope === 'groups' ? null : current)
    } catch (error) {
      setLoadError({ scope: 'groups', message: error instanceof Error ? error.message : '分组加载失败' })
    } finally { setLoading(false) }
  }

  async function loadClaimed(groupId: string, userId: string, date: string) {
    setClaimedLoading(true)
    setExpandedClaimIds(new Set())
    setInvalidClaimIds(new Set())
    try {
      const res = await fetch(`/api/task-groups/${groupId}/claimed?userId=${userId}&date=${date}`)
      if (!res.ok) throw new Error(await apiError(res, '认领记录加载失败'))
      const data = await res.json()
      setClaimedKeywords(data.keywords || [])
      setLoadError(current => current?.scope === 'claimed' ? null : current)
    } catch (error) {
      setLoadError({ scope: 'claimed', message: error instanceof Error ? error.message : '认领记录加载失败' })
    } finally { setClaimedLoading(false) }
  }

  async function loadRadar() {
    if (radarLoaded || radarLoading) return
    setRadarLoading(true)
    try {
      const res = await fetch('/api/hot-radar')
      if (!res.ok) throw new Error(await apiError(res, '推荐数据加载失败'))
      const rd = await res.json()
      setRadarData(rd); setRadarLoaded(true)
      setLoadError(current => current?.scope === 'radar' ? null : current)
    } catch (error) {
      setLoadError({ scope: 'radar', message: error instanceof Error ? error.message : '推荐数据加载失败' })
    } finally { setRadarLoading(false) }
  }

  async function loadDistributed() {
    if (!activeGroupId) return
    setDistributedLoading(true)
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/distributed`)
      if (!res.ok) throw new Error(await apiError(res, '分发词加载失败'))
      const d = await res.json()
      setDistributedWords(d.keywords || [])
      setLoadError(current => current?.scope === 'distributed' ? null : current)
    } catch (error) {
      setLoadError({ scope: 'distributed', message: error instanceof Error ? error.message : '分发词加载失败' })
    } finally { setDistributedLoading(false) }
  }

  async function submitDistributeWords() {
    if (!activeGroupId || !distributeText.trim() || distributeSaving) return
    setDistributeSaving(true); setDistributeMsg('')
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/distributed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: distributeText, repeatable: distributeRepeatable,
          cooldownDays: Number(distributeCooldownDays) || 7,
          dailyLimit: distributeDailyLimit ? Number(distributeDailyLimit) : null,
          batchName: distributeBatchName,
        }),
      })
      if (res.ok) {
        setDistributeText(''); setDistributeRepeatable(false); setDistributeCooldownDays('7')
        setDistributeDailyLimit(''); setDistributeBatchName(''); setShowDistributeModal(false)
        loadDistributed()
      } else {
        const data = await res.json().catch(() => ({}))
        setDistributeMsg(data.error || '添加失败')
      }
    } catch {
      setDistributeMsg('添加失败（网络异常）')
    } finally { setDistributeSaving(false) }
  }

  async function deleteDistributed(id: string) {
    if (!activeGroupId) return
    const removed = distributedWords.find(w => w.id === id)
    setDistributedWords(prev => prev.filter(w => w.id !== id))
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/distributed`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok && removed) {
        setDistributedWords(prev => [...prev, removed].sort((a, b) => a.keyword.localeCompare(b.keyword)))
        setClaimErrorMsg('删除失败，请重试')
      }
    } catch {
      if (removed) setDistributedWords(prev => [...prev, removed])
      setClaimErrorMsg('删除失败（网络异常），请重试')
    }
  }

  async function clearAllDistributed() {
    if (!activeGroupId || distributeClearing || distributedWords.length === 0) return
    if (!window.confirm(`确定要清空全部 ${distributedWords.length} 个分发词吗？此操作不可撤销。`)) return
    setDistributeClearing(true)
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/distributed`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (res.ok) setDistributedWords([])
      else setClaimErrorMsg('清空失败，请重试')
    } catch {
      setClaimErrorMsg('清空失败（网络异常），请重试')
    } finally { setDistributeClearing(false) }
  }

  // targetUserId 默认是当前查看的组员（effectiveViewingId）——管理员切到
  // 某个组员的视图后双击认领，认领记录应该算在那个组员头上，不是管理员自己。
  // 合并推荐视图（见下方"今日推荐"渲染）每一行知道自己是哪个组员的，双击时
  // 显式传入那一行的 user_id，不受当前"查看谁"的切换影响。
  async function claimKeyword(keyword: string, source: string, search_volume = 0, source_rule_id?: string, targetUserId?: string) {
    // claimedSet covers "already in state"; claimingRef covers "in-flight request"
    if (!activeGroupId || claimedSet.has(keyword) || claimingRef.current.has(keyword)) return
    claimingRef.current.add(keyword)
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, source, search_volume, operation_type: '新增', source_rule_id: source_rule_id ?? null, userId: targetUserId ?? effectiveViewingId }),
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
        // 认领的是当前正在查看的组员时才追加进这份"今天已认领"列表——合并推荐
        // 视图代其它组员认领时，这份列表跟那个组员无关，不用管。
        if ((targetUserId ?? effectiveViewingId) === effectiveViewingId) {
          setClaimedKeywords(prev => [...prev, data.keyword])
          setExpandedClaimIds(new Set<string>([data.keyword.id]))
        }
        if (rightTab === 'distribute') loadDistributed()
      } else {
        // 409 已经在上面单独处理并 return 了，这里是其它失败（比如403）——
        // 之前这个分支完全没处理，请求失败了界面上却什么反应都没有，
        // 双击就跟没反应一样，2026-08-11 用户反馈排查出来的。
        const data = await res.json().catch(() => ({}))
        setClaimErrorMsg(data.error || '认领失败，请重试')
      }
    } catch {
      setClaimErrorMsg('认领失败（网络异常），请重试')
    } finally { claimingRef.current.delete(keyword) }
  }

  // targetUserId 默认是当前查看的组员——合并推荐视图里每一行知道自己是哪个
  // 组员的，×掉时要写进那个组员自己的 dismiss 记录，不是当前查看者的。
  // "永久移除"不新增数据库字段——loadDismissedRec/loadAllMembersDismissed 本来
  // 就是拿 `dismissed_at >= 7天前` 当"还在冷却期内、要不要隐藏"的唯一判断依据，
  // 写一个远未来的哨兵时间天然就"永远满足这个条件"，不用改表结构/迁移。
  // 2026-08-17 用户要求区分"永久移除"和"7天后再显示"两种选择时加入。
  const PERMANENT_DISMISS_AT = '2099-12-31T00:00:00.000Z'
  function dismissRec(keyword: string, targetUserId?: string, permanent = false) {
    const uid = targetUserId ?? effectiveViewingId
    const at = permanent ? PERMANENT_DISMISS_AT : new Date().toISOString()
    if (uid === effectiveViewingId) {
      setDismissedRecMap(prev => { const next = new Map(prev); next.set(keyword, at); return next })
    }
    if (canManage) {
      setAllMembersDismissed(prev => {
        const next = new Map(prev)
        const inner = new Map(next.get(uid) ?? new Map())
        inner.set(keyword, at)
        next.set(uid, inner)
        return next
      })
    }
    if (!activeGroupId || !uid) return
    fetch(`/api/task-groups/${activeGroupId}/dismissals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, keyword, permanent }),
    }).then(async response => {
      if (!response.ok) throw new Error('Failed to dismiss recommendation')
    }).catch(() => setClaimErrorMsg('移除推荐失败，请重试'))
  }

  async function dismissClaimed(claimId: string) {
    if (!activeGroupId) return
    const removed = claimedKeywords.find(k => k.id === claimId)
    setClaimedKeywords(prev => prev.filter(k => k.id !== claimId))
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, status: 'dismissed' }),
      })
      if (!res.ok && removed) {
        setClaimedKeywords(prev => [...prev, removed])
        setClaimErrorMsg('移除失败，请重试')
      }
    } catch {
      if (removed) setClaimedKeywords(prev => [...prev, removed])
      setClaimErrorMsg('移除失败（网络异常），请重试')
    }
  }

  async function saveClaim(claimId: string, field: 'final_keyword' | 'page_url' | 'operation_type', value: string) {
    if (!activeGroupId) return
    // Snapshot the pre-edit value so a failed save can be reverted instead of
    // silently sticking around as a local-only change that looks saved but
    // isn't (2026-08-03: found operation_type='更新' had never once persisted
    // across the whole app's history — this function had zero error handling,
    // so a failed PATCH just left the optimistic update in place with nothing
    // telling the user it never reached the server).
    const prevValue = claimedKeywords.find(k => k.id === claimId)?.[field] ?? null
    setClaimedKeywords(prev => prev.map(k => k.id === claimId ? { ...k, [field]: value || null } : k))
    try {
      const res = await fetch(`/api/task-groups/${activeGroupId}/claimed`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, [field]: value }),
      })
      if (!res.ok) {
        setClaimedKeywords(prev => prev.map(k => k.id === claimId ? { ...k, [field]: prevValue } : k))
        setClaimErrorMsg('保存失败，请重试')
      }
    } catch {
      setClaimedKeywords(prev => prev.map(k => k.id === claimId ? { ...k, [field]: prevValue } : k))
      setClaimErrorMsg('保存失败（网络异常），请重试')
    }
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
      else setClaimErrorMsg('提交失败，请重试')
    } catch {
      setClaimErrorMsg('提交失败（网络异常），请重试')
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
          userId: effectiveViewingId,
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
        body: JSON.stringify({ date: selectedDate, userId: effectiveViewingId }),
      })
      if (res.ok) setClaimedKeywords(prev => prev.map(k => k.status === 'pending' ? { ...k, status: 'submitted' } : k))
    } finally { setSubmitting(false) }
  }

  async function openDetail(keyword: string, source: string, url?: string | null) {
    setDetailKw(keyword)
    setDetailSource(source)

    // 跌排更新/跌词更新按URL合并显示后，"详情"改成看同一个URL下还命中了
    // 哪些其它词——siteRankdownData 已经在内存里，不用发请求，直接过滤。
    if (source === '跌排更新' || source === '跌词更新') {
      setDetailUrlSiblings(
        !url ? [] : siteRankdownData
          .filter(r => r.url && normalizeUrl(r.url).toLowerCase() === normalizeUrl(url).toLowerCase())
          .filter(r => r.keyword !== keyword)
          .sort((a, b) => b.volume - a.volume)
      )
      setDetailLoading(false)
      return
    }

    const cacheKey = `${keyword}|${source}`
    const cached = detailCacheRef.current.get(cacheKey)
    if (cached) {
      setDetailNewRows(cached.newRows)
      setDetailRankRows(cached.rankRows)
      setWordLibSiteKws(cached.wordLibSiteKws)
      setDetailVolumeRisingRows(cached.volumeRisingRows)
      setDetailLoading(false)
      return
    }

    setDetailLoading(true)
    setDetailNewRows([])
    setDetailRankRows([])
    setWordLibSiteKws([])
    setDetailVolumeRisingRows([])

    const supabase = getBrowserClient()
    let idMap = siteIdMap
    if (idMap.size === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: siteData } = await (supabase.from('sites') as any).select('id, domain')
      idMap = new Map((siteData || []).map((s: { id: string; domain: string }) => [s.id, s.domain]))
      setSiteIdMap(idMap)
    }

    if (source === '搜索上涨') {
      // 跟"竞品涨排名"不同，这里两个方向都要——目的就是看这个搜索量在
      // 涨的词，我们自己站点的排名是在涨还是在跌。
      const since = getMYDate(-30)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await fetchAllRows<{ id: string; site_id: string; stat_date: string; type: string }>((from, to) =>
          (supabase.from('rank_changes') as any)
            .select('id, site_id, stat_date, type')
            .eq('keyword', keyword).gte('stat_date', since)
            .order('stat_date', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to)
        )
        const vRows: VolumeRisingDetailRow[] = []
        for (const r of raw) {
          const domain = idMap.get(r.site_id)
          if (domain && (r.type === 'rankup' || r.type === 'rankdown')) {
            vRows.push({ date: String(r.stat_date).slice(0, 10), domain, type: r.type })
          }
        }
        const seen = new Set<string>()
        const deduped = vRows
          .filter(r => { const k = `${r.date}|${r.domain}|${r.type}`; if (seen.has(k)) return false; seen.add(k); return true })
          .sort((a, b) => b.date.localeCompare(a.date) || a.domain.localeCompare(b.domain))
        setDetailVolumeRisingRows(deduped)
        detailCacheRef.current.set(cacheKey, { newRows: [], rankRows: [], wordLibSiteKws: [], volumeRisingRows: deduped })
      } finally {
        setDetailLoading(false)
      }
      return
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
          const raw = await fetchAllRows<{ id: string; site_id: string; keyword: string }>((from, to) =>
            (supabase.from('raw_keywords') as any)
              .select('id, site_id, keyword')
              .in('site_id', siteIds)
              .like('keyword', `${keyword}%`)
              .gte('discovered_at', since)
              .order('id', { ascending: true })
              .range(from, to)
          )
          const bySite = new Map<string, Set<string>>()
          for (const r of raw) {
            const domain = idMap.get(r.site_id)
            if (!domain) continue
            if (!bySite.has(domain)) bySite.set(domain, new Set())
            bySite.get(domain)!.add(r.keyword)
          }
          const wlRows = Array.from(bySite.entries())
            .map(([domain, kws]) => ({ domain, keywords: Array.from(kws).sort() }))
            .sort((a, b) => b.keywords.length - a.keywords.length)
          setWordLibSiteKws(wlRows)
          detailCacheRef.current.set(cacheKey, { newRows: [], rankRows: [], wordLibSiteKws: wlRows, volumeRisingRows: [] })
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
        const raw = await fetchAllRows<{ id: string; site_id: string; content_date: string }>((from, to) =>
          (supabase.from('raw_keywords') as any)
            .select('id, site_id, content_date')
            .eq('keyword', keyword).gte('content_date', since)
            .order('content_date', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to)
        )
        for (const r of raw) {
          const domain = idMap.get(r.site_id)
          if (domain) nRows.push({ date: String(r.content_date).slice(0, 10), domain })
        }
      }
      if (needsRank) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await fetchAllRows<{ id: string; site_id: string; stat_date: string }>((from, to) =>
          (supabase.from('rank_changes') as any)
            .select('id, site_id, stat_date')
            .eq('keyword', keyword).eq('type', 'rankup').gte('stat_date', since)
            .order('stat_date', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to)
        )
        for (const r of raw) {
          const domain = idMap.get(r.site_id)
          if (domain) rRows.push({ date: String(r.stat_date).slice(0, 10), domain })
        }
      }
      const dedupedNew = dedupDetailRows(nRows)
      const dedupedRank = dedupDetailRows(rRows)
      setDetailNewRows(dedupedNew)
      setDetailRankRows(dedupedRank)
      detailCacheRef.current.set(cacheKey, { newRows: dedupedNew, rankRows: dedupedRank, wordLibSiteKws: [], volumeRisingRows: [] })
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

  useEffect(() => { loadGroups() }, [groupId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loading && !isWorkspaceRoute && !canManage && groups.length > 0) {
      router.replace(`/task-groups/${encodeURIComponent(groups[0].id)}`)
    }
  }, [loading, isWorkspaceRoute, canManage, groups, router])
  useEffect(() => {
    if (isWorkspaceRoute && detailKw) void loadDomainInfo()
  }, [isWorkspaceRoute, detailKw]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!claimErrorMsg) return
    const t = setTimeout(() => setClaimErrorMsg(null), 3500)
    return () => clearTimeout(t)
  }, [claimErrorMsg])
  useEffect(() => { if (isWorkspaceRoute && activeGroupId && effectiveViewingId) loadClaimed(activeGroupId, effectiveViewingId, selectedDate) }, [isWorkspaceRoute, activeGroupId, effectiveViewingId, selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (currentUserId && !viewingMemberId) setViewingMemberId(currentUserId) }, [currentUserId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isWorkspaceRoute && rightTab !== 'search' && rightTab !== 'distribute') loadRadar() }, [isWorkspaceRoute, rightTab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isWorkspaceRoute && rightTab === 'distribute') loadDistributed() }, [isWorkspaceRoute, rightTab, activeGroupId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isWorkspaceRoute && (rightTab === 'wordLib' || rightTab === 'rankdown' || (rightTab === 'recommend' && recSubTab === 'rankdown'))) loadSiteRankdown() }, [isWorkspaceRoute, rightTab, recSubTab, activeGroupId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isWorkspaceRoute && rightTab === 'recommend' && recSubTab === 'rankup') loadCompetitorRankup() }, [isWorkspaceRoute, rightTab, recSubTab, activeGroupId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isWorkspaceRoute && rightTab === 'recommend') loadSubmissionHistory() }, [isWorkspaceRoute, rightTab, recSubTab, activeGroupId, effectiveViewingId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isWorkspaceRoute && rightTab === 'recommend') loadDismissedRec() }, [isWorkspaceRoute, rightTab, recSubTab, activeGroupId, effectiveViewingId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isWorkspaceRoute && rightTab === 'recommend' && canManage) { loadAllMembersSubmissionHistory(); loadAllMembersDismissed() } }, [isWorkspaceRoute, rightTab, activeGroupId, canManage]) // eslint-disable-line react-hooks/exhaustive-deps
  // Scroll today's task list to bottom when a new claim is added
  useEffect(() => {
    if (claimedListRef.current) claimedListRef.current.scrollTop = claimedListRef.current.scrollHeight
  }, [displayedClaims.length])

  useEffect(() => {
    if (!isWorkspaceRoute || rightTab !== 'wordLib' || wordLibLoaded || wordLibLoading) return
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
  }, [isWorkspaceRoute, rightTab, wordLibLoaded, wordLibLoading, today])

  useEffect(() => {
    if (!isWorkspaceRoute || !activeGroupId || selectedDate !== today) return
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
  }, [isWorkspaceRoute, activeGroupId, effectiveViewingId, selectedDate, today]) // eslint-disable-line react-hooks/exhaustive-deps

  function setPage(tab: RightTab, p: number) { setTabPage(prev => ({ ...prev, [tab]: p })) }

  // ── Group management ────────────────────────────────────────────────────────

  async function loadAllSites() {
    if (allSites.length > 0) return
    const response = await fetch('/api/sites')
    const data = response.ok ? await response.json() as { sites?: SiteInfo[] } : { sites: [] }
    const CAT_ORDER: Record<string, number> = { large: 0, medium: 1, small: 2 }
    setAllSites((data.sites || []).sort((a, b) => (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9) || a.domain.localeCompare(b.domain)))
  }

  async function loadDomainInfo() {
    const supabase = getBrowserClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sitesRes, weightRows] = await Promise.all([
      (supabase.from('sites') as any).select('id, domain, friend_links'),
      fetchAllRows<{ id: string; site_id: string; pc_weight: number; mobile_weight: number }>((from, to) =>
        (supabase.from('weight_history') as any)
          .select('id, site_id, pc_weight, mobile_weight')
          .gte('record_date', getMYDate(-30))
          .order('record_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
    ])
    const sites: { id: string; domain: string; friend_links?: string[] | null }[] = sitesRes.data || []
    const idToDomain = new Map<string, string>(sites.map((s: { id: string; domain: string }) => [s.id, s.domain]))
    // weight: iterate asc so last write = latest
    const wMap = new Map<string, { pc: number; mobile: number }>()
    for (const r of weightRows) {
      const domain = idToDomain.get(r.site_id)
      if (domain) wMap.set(domain, { pc: r.pc_weight, mobile: r.mobile_weight })
    }
    setDomainWeightMap(wMap)
    setDomainColorMap(buildGroupColorMap(sites))
  }

  async function openCreateModal() {
    setShowCreate(true); setCreateName(''); setSelectedUsers(new Set()); setMemberTypes({})
    setSelectedRankDomains(new Set()); setSelectedNewDomains(new Set())
    const [usersRes] = await Promise.all([fetch('/api/admin/users?activeOnly=1'), loadAllSites()])
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

  async function openEditModal(group: TaskGroup | null = activeGroup) {
    if (!group) return
    setActiveGroupId(group.id)
    setEditName(group.name)
    setEditSelectedUsers(new Set(group.members.map(m => m.user_id)))
    setEditSelectedRankDomains(new Set(group.rank_domains || []))
    setEditSelectedNewDomains(new Set(group.new_domains || []))
    setEditSelectedSiteDomains(new Set(group.site_domains || []))
    const types: Record<string, 'app' | 'game'> = {}
    for (const m of group.members) types[m.user_id] = m.member_type === 'game' ? 'game' : 'app'
    setEditMemberTypes(types); setShowEdit(true)
    const promises: Promise<unknown>[] = [loadAllSites()]
    if (userOptions.length === 0) promises.push(fetch('/api/admin/users?activeOnly=1').then(r => r.json()).then(d => setUserOptions(d.users || [])))
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
    if (!isSuper || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/task-groups/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: deleteUsername.trim(), password: deletePassword }),
      })
      if (!res.ok) {
        setDeleteError(await apiError(res, '删除失败'))
        return
      }
      const remaining = groups.filter(g => g.id !== id)
      setGroups(remaining)
      if (activeGroupId === id) {
        setActiveGroupId(null)
        setWorkspaceOpen(false)
      }
      setDeleteId(null)
      setDeleteUsername('')
      setDeletePassword('')
    } catch {
      setDeleteError('删除失败，请检查网络后重试')
    } finally {
      setDeleting(false)
    }
  }

  function openDeleteModal(id: string) {
    setDeleteId(id)
    setDeleteUsername('')
    setDeletePassword('')
    setDeleteError('')
  }

  function closeDeleteModal() {
    if (deleting) return
    setDeleteId(null)
    setDeleteUsername('')
    setDeletePassword('')
    setDeleteError('')
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

    if (rightTab === 'distribute') {
      if (distributedLoading) return <Spinner />
      return (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500">管理员手动指定的词，组员可点击“认领”（双击行为保留为快捷方式）</span>
            {canManage && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={clearAllDistributed} disabled={distributeClearing || distributedWords.length === 0}
                  className="text-xs text-red-400 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {distributeClearing ? '清空中…' : '清空全部'}
                </button>
                <button onClick={() => { setShowDistributeModal(true); setDistributeMsg('') }}
                  className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 transition-colors">
                  + 添加分发词
                </button>
              </div>
            )}
          </div>
          {distributedWords.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">暂无分发词{canManage ? '，点右上角添加' : ''}</div>
          ) : (
            <table aria-label="数据表格" className="w-full table-fixed">
              <colgroup>{canManage && <col className="w-6" />}<col /><col className="w-24" /><col className="w-32" /></colgroup>
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                {canManage && <th className="w-6" />}
                <th className="px-3 py-2 text-left font-medium">关键词</th>
                <th className="px-2 py-2 text-center font-medium">搜索量</th>
                <th className="px-2 py-2 text-center font-medium">状态</th>
              </tr></thead>
              <tbody>
                {distributedWords.map(w => {
                  const claimed = !!w.claimedBy
                  const inCooldown = claimed && w.cooldownDaysLeft != null
                  return (
                    <tr key={w.id} onDoubleClick={() => !claimed && claimKeyword(w.keyword, '分发词', w.volume)}
                      className={`border-b border-gray-50 last:border-0 transition-colors ${claimed ? 'opacity-50' : 'cursor-pointer select-none hover:bg-gray-50'}`}
                      title={claimed ? (inCooldown ? `${w.claimedBy} 认领过，还剩${w.cooldownDaysLeft}天冷却` : `已被 ${w.claimedBy} 认领`) : '点击认领按钮，或双击此行快捷认领'}>
                      {canManage && (
                        <td className="px-1 py-2">
                          <button onClick={e => { e.stopPropagation(); deleteDistributed(w.id) }}
                            className="text-gray-300 hover:text-red-400 transition-colors leading-none" title="删除这个词">×</button>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <span className="text-sm text-gray-800">{w.keyword}</span>
                        {w.batch_name && <span className="ml-1.5 text-[10px] text-purple-400 align-middle">{w.batch_name}</span>}
                        {w.repeatable && <span className="ml-1.5 text-[10px] text-blue-400 align-middle">可重复</span>}
                        {w.daily_limit != null && <span className="ml-1.5 text-[10px] text-orange-400 align-middle">限{w.daily_limit}/日</span>}
                      </td>
                      <td className="px-2 py-2 text-center text-xs text-gray-500">
                        {w.volume > 0 ? w.volume.toLocaleString() : '—'}
                        {w.volume_source === 'base_match' && w.matched_keyword && (
                          <div className="text-[10px] text-gray-300">按"{w.matched_keyword}"估</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center text-xs">
                        <div className="flex items-center justify-center gap-2">
                          {inCooldown
                            ? <span className="text-amber-600">冷却中 · {w.cooldownDaysLeft}天后可认领</span>
                            : claimed ? <span className="text-gray-500">{w.claimedBy} 已认领</span> : <span className="text-green-700">可认领</span>}
                          <ClaimAction keyword={w.keyword} claimed={claimed} onClaim={() => claimKeyword(w.keyword, '分发词', w.volume)} compact />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )
    }

    if (rightTab === 'recommend') {
      const pg_rec = tabPage['recommend']
      // ── 跌排更新（自己站排名下跌，匹配这个组员/全组历史做过的词）──────────
      // 2026-08-17 修复：这里之前用 claimedKeywords（只有"当前选中日期"，默认
      // 今天，那一天认领的词），导致必须"今天认领的词"恰好也在"今天"的排名
      // 涨跌报告里出现才会匹配上——两个概率事件叠在一起，实测这个tab上线
      // 近20天全站只成功匹配过2次。真正该比的是"这个组员历史上有没有做过
      // 这个词/这个URL"（不分哪天），改用 loadSubmissionHistory 已经在查的
      // 全历史 submissionHistoryMap/submissionHistoryUrlSet（原本只用来算
      // 冷却期，现在也用来当匹配池）。
      const submittedKwSet = new Set(submissionHistoryMap.keys())
      const submittedUrlSet = submissionHistoryUrlSet
      const rankdownMatched = (() => {
        const matched = siteRankdownData.filter(r =>
          submittedKwSet.has(r.keyword.toLowerCase()) ||
          (r.url && submittedUrlSet.has(normalizeUrl(r.url).toLowerCase()))
        ).filter(r => !dismissedRecMap.has(r.keyword))
        return dedupeByUrl(applyRecommendCooldown(matched))
      })()

      // 管理员合并视图：每个组员各自算一遍匹配（各自的历史提交记录+各自的
      // dismiss记录），再合成一张表，每行带上是哪个组员的。2026-08-17 加入
      // ——用户想看全组的推荐，而不是一次只能切一个组员看。
      type MoveRow = typeof siteRankdownData[number]
      type MoveRowWithMember = MoveRow & { _memberId: string; _memberName: string }
      const rankdownMatchedAll: MoveRowWithMember[] = canManage ? (() => {
        const rows: MoveRowWithMember[] = []
        for (const m of activeGroup?.members ?? []) {
          const hist = allMembersHistory.get(m.user_id)
          if (!hist) continue
          const dismissed = allMembersDismissed.get(m.user_id) ?? new Map<string, string>()
          const matched = siteRankdownData.filter(r =>
            hist.kwMap.has(r.keyword.toLowerCase()) ||
            (r.url && hist.urlSet.has(normalizeUrl(r.url).toLowerCase()))
          ).filter(r => !dismissed.has(r.keyword))
          for (const r of dedupeByUrl(applyRecommendCooldown(matched, hist.kwMap))) {
            rows.push({ ...r, _memberId: m.user_id, _memberName: m.username })
          }
        }
        return rows.sort((a, b) => b.volume - a.volume)
      })() : []

      const renderRankdownTable = () => {
        const matched: (MoveRow | MoveRowWithMember)[] = canManage ? rankdownMatchedAll : rankdownMatched
        if (siteRankdownLoading) return <Spinner />
        if (matched.length === 0) {
          return (
            <div className="text-center py-10 text-gray-400 text-sm">
              {siteRankdownData.length === 0
                ? '近30天自有站无m端下跌词'
                : `暂无与${canManage ? '组员们' : '你'}提交记录匹配、且已过冷却期的下跌词`}
            </div>
          )
        }
        return (
          <>
            <table aria-label="数据表格" className="w-full table-fixed">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="w-7" />
                <th className="px-3 py-2 text-left font-medium">关键词</th>
                <th className="px-2 py-2 text-left font-medium">排名页面</th>
                {canManage && <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">组员</th>}
                <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">现排名</th>
                <th className="px-2 py-2 text-center font-medium w-14 whitespace-nowrap">跌幅</th>
                <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">搜索量</th>
                <th className="w-28" />
              </tr></thead>
              <tbody>
                {matched.slice(pg_rec * PAGE_SIZE, (pg_rec + 1) * PAGE_SIZE).map((r, i) => {
                  const memberId = '_memberId' in r ? r._memberId : effectiveViewingId
                  const memberName = '_memberId' in r ? r._memberName : undefined
                  // 合并视图里只有"当前正在查看的组员"那一行的今日认领状态是
                  // 准确的（claimedSet只装了effectiveViewingId的今天列表）——
                  // 其它组员的行不去猜，双击照样能认领，服务端本来就会拦重复。
                  const claimed = memberId === effectiveViewingId && claimedSet.has(r.keyword)
                  return (
                    <tr key={`${memberId}|${r.keyword}|${i}`} onDoubleClick={() => { if (!claimed) claimKeyword(r.keyword, '跌排更新', r.volume, undefined, memberId) }}
                      className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
                      title={claimed ? '已认领' : `点击认领按钮，或双击代${memberName ?? '该组员'}认领`}>
                      <td className="pl-2 py-2">
                        <button onClick={e => { e.stopPropagation(); setDismissConfirm({ keyword: r.keyword, targetUserId: memberId, memberName }) }}
                          className="w-5 h-5 rounded flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-base leading-none" title="移除此词">×</button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-sm text-gray-800 select-text cursor-text"
                          onDoubleClick={e => { e.stopPropagation(); if (!claimed) claimKeyword(r.keyword, '跌排更新', r.volume, undefined, memberId) }}
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
                      {canManage && (
                        <td className="px-2 py-2 text-center text-xs text-gray-500 truncate" title={memberName ?? ''}>{memberName ?? '—'}</td>
                      )}
                      <td className="px-2 py-2 text-center text-xs font-medium text-gray-700">
                        {r.rank_position ?? <span className="text-gray-400">脱排</span>}
                      </td>
                      <td className="px-2 py-2 text-center text-xs font-medium text-red-500">
                        {r.rank_position == null ? <span className="text-gray-400">脱排</span> : r.prev_rank != null ? `▼${r.rank_position - r.prev_rank}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-center text-xs text-gray-500">{r.volume > 0 ? fmtVol(r.volume) : '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <ClaimAction keyword={r.keyword} claimed={claimed} onClaim={() => claimKeyword(r.keyword, '跌排更新', r.volume, undefined, memberId)} compact />
                          <button onClick={() => openDetail(r.keyword, '跌排更新', r.url)}
                            className="text-xs border rounded px-1.5 py-0.5 text-gray-500 hover:text-gray-700 border-gray-200 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500">详情</button>
                        </div>
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

      // ── 涨排更新（竞品排名上涨、但我们自己完全没有排名的词）──────────────
      // 2026-08-17 改版：用户原话"我是要找这个词我们没有做到收录或排名的东西
      // 来做更新，就是根据近期竞品有拿到这个词的涨排的来做比较""看竞品涨排
      // 是看他们的涨而已"——跟"跌排更新"不是同一套匹配逻辑（不再是"匹配组员
      // 历史做过的词"，而是"竞品刚涨上去+我们完全没有覆盖"的机会词），但"给谁
      // 看"这一层要跟"跌排更新"保持一致："参考跌排更新的，主要都是给组员自己
      // 去做更新的"——普通组员打开自己的"今日推荐"，只看到自己历史上提交过的
      // 那些词（自然而然地"分发"到本人，不是管理员主动推送）；管理员才看到
      // 全组合并视图+"组员"列，方便掌握全局。
      const rankupMatchedOwn = (() => {
        const ownRows = competitorRankupData.filter(r => r.ownUserId === effectiveViewingId)
        const filtered = ownRows.filter(r => !dismissedRecMap.has(r.keyword))
        return applyRecommendCooldown(filtered)
      })()
      const rankupMatchedAll = canManage ? (() => {
        const rows: typeof competitorRankupData = []
        for (const m of activeGroup?.members ?? []) {
          const ownRows = competitorRankupData.filter(r => r.ownUserId === m.user_id)
          if (ownRows.length === 0) continue
          const hist = allMembersHistory.get(m.user_id)
          if (!hist) continue
          const dismissed = allMembersDismissed.get(m.user_id) ?? new Map<string, string>()
          const filtered = ownRows.filter(r => !dismissed.has(r.keyword))
          rows.push(...applyRecommendCooldown(filtered, hist.kwMap))
        }
        return rows.sort((a, b) => b.volume - a.volume)
      })() : []

      const renderRankupTable = () => {
        const rankupCandidates = canManage ? rankupMatchedAll : rankupMatchedOwn
        if (competitorRankupLoading) return <Spinner />
        if (rankupCandidates.length === 0) {
          return (
            <div className="text-center py-10 text-gray-400 text-sm">
              {competitorRankupData.length === 0
                ? '近30天竞品站无m端上涨词、我们已经都有排名了，或者都不是组员提交过的词'
                : `暂无与${canManage ? '组员们' : '你'}历史提交匹配、且已过冷却期的机会词`}
            </div>
          )
        }
        return (
          <>
            <table aria-label="数据表格" className="w-full table-fixed">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="w-7" />
                <th className="px-3 py-2 text-left font-medium">关键词</th>
                <th className="px-2 py-2 text-left font-medium">排名页面</th>
                {canManage && <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">组员</th>}
                <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">提交日期</th>
                <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">竞品排名</th>
                <th className="px-2 py-2 text-center font-medium w-14 whitespace-nowrap">涨幅</th>
                <th className="px-2 py-2 text-center font-medium w-16 whitespace-nowrap">搜索量</th>
                <th className="w-16" />
              </tr></thead>
              <tbody>
                {rankupCandidates.slice(pg_rec * PAGE_SIZE, (pg_rec + 1) * PAGE_SIZE).map((r, i) => {
                  // ownUrl/ownUserId 现在保证非空——loadCompetitorRankup 里已经把
                  // 没有自己历史URL的候选词过滤掉了（用户明确要求只看"组员们自己
                  // 提交过的词"，竞品涨排只是信号，不是拿来发现全新词的）。管理员
                  // 合并视图双击代那个组员认领；普通组员看到的本来就只有自己的词
                  // （见上面 rankupMatchedOwn），memberId 恒等于 effectiveViewingId。
                  const displayUrl = r.ownUrl
                  const memberId = r.ownUserId
                  if (!displayUrl || !memberId) return null
                  const memberName = activeGroup?.members.find(m => m.user_id === memberId)?.username ?? '—'
                  const claimed = memberId === effectiveViewingId && claimedSet.has(r.keyword)
                  return (
                    <tr key={`${r.keyword}|${i}`} onDoubleClick={() => { if (!claimed) claimKeyword(r.keyword, '涨排更新', r.volume, undefined, memberId) }}
                      className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
                      title={claimed ? '已认领' : (canManage ? `点击认领按钮，或双击代${memberName}认领` : '点击认领按钮，或双击此行快捷认领')}>
                      <td className="pl-2 py-2">
                        <button onClick={e => { e.stopPropagation(); setDismissConfirm({ keyword: r.keyword, targetUserId: memberId, memberName }) }}
                          className="w-5 h-5 rounded flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-base leading-none" title="移除此词">×</button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-sm text-gray-800 select-text cursor-text"
                          onDoubleClick={e => { e.stopPropagation(); if (!claimed) claimKeyword(r.keyword, '涨排更新', r.volume, undefined, memberId) }}
                          title={r.keyword}>
                          {r.keyword.length > 16 ? r.keyword.slice(0, 16) + '…' : r.keyword}
                        </span>
                        {claimed && <span className="ml-1.5 text-[10px] text-green-500">✓</span>}
                      </td>
                      <td className="px-2 py-2">
                        <a href={displayUrl.startsWith('http') ? displayUrl : `https://${displayUrl}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-[11px] text-blue-500 hover:underline truncate block max-w-[130px]"
                          title={`我们自己的页面：${displayUrl}`}>
                          {displayUrl.replace(/^https?:\/\//, '').slice(0, 26)}{displayUrl.replace(/^https?:\/\//, '').length > 26 ? '…' : ''}
                        </a>
                      </td>
                      {canManage && (
                        <td className="px-2 py-2 text-center text-xs text-gray-500 truncate" title={memberName}>{memberName}</td>
                      )}
                      <td className="px-2 py-2 text-center text-xs text-gray-500">{r.ownCreatedAt ? fmtDate(r.ownCreatedAt.slice(0, 10)) : '—'}</td>
                      <td className="px-2 py-2 text-center text-xs font-medium text-gray-700">
                        {r.rank_position ?? <span className="text-gray-400">脱排</span>}
                      </td>
                      <td className="px-2 py-2 text-center text-xs font-medium text-green-600">
                        {r.rank_position != null && r.prev_rank != null ? `▲${r.prev_rank - r.rank_position}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-center text-xs text-gray-500">{r.volume > 0 ? fmtVol(r.volume) : '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <ClaimAction keyword={r.keyword} claimed={claimed} onClaim={() => claimKeyword(r.keyword, '涨排更新', r.volume, undefined, memberId)} compact />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pager page={pg_rec} total={rankupCandidates.length} onPage={p => setPage('recommend', p)} />
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

          {recSubTab === 'rankdown' && renderRankdownTable()}
          {recSubTab === 'rankup' && renderRankupTable()}
        </div>
      )
    }

    if (rightTab === 'search') {
      const totalPages = Math.ceil(searchTotal / PAGE_SIZE)
      return (
        <div>
          <div className="flex gap-2 mb-4">
            <input aria-label="输入内容" ref={searchInputRef} type="text" value={searchInput}
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
              <table aria-label="数据表格" className="w-full table-fixed">
                <colgroup>
                  <col />
                  <col className="w-20" />
                  <col className="w-20" />
                  <col className="w-20" />
                  <col className="w-16" />
                </colgroup>
                <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 text-left font-medium">关键词</th>
                  <th className="px-2 py-2 text-center font-medium">搜索量</th>
                  <th className="px-2 py-2 text-center font-medium">近期涨排</th>
                  <th className="px-2 py-2 text-center font-medium">搜索变更</th>
                  <th className="px-2 py-2 text-center font-medium">操作</th>
                </tr></thead>
                <tbody>
                  {searchResults.map((r, i) => {
                    const claimed = claimedSet.has(r.keyword)
                    const change = r.volume_change ?? 0
                    return (
                      <tr key={`${r.keyword}|${i}`} onDoubleClick={() => { if (!claimed) claimKeyword(r.keyword, '搜索量查询', r.volume) }}
                        className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
                        title={claimed ? '已认领' : '点击认领按钮，或双击此行快捷认领'}>
                        <td className="px-3 py-2">
                          <span className="text-sm text-gray-800 select-text cursor-text"
                            onDoubleClick={e => { e.stopPropagation(); if (!claimed) claimKeyword(r.keyword, '搜索量查询', r.volume) }}
                          >{r.keyword.length > 26 ? r.keyword.slice(0, 26) + '…' : r.keyword}</span>
                          {claimed && <span className="ml-1.5 text-[10px] text-green-500">✓</span>}
                        </td>
                        <td className="px-2 py-2 text-center text-xs text-gray-500">
                          {r.volume > 0 ? r.volume.toLocaleString() : '—'}
                        </td>
                        <td className="px-2 py-2 text-center text-xs">
                          {r.latest_trend === 'rankup' ? <span className="text-green-600 font-semibold">↑</span>
                            : r.latest_trend === 'rankdown' ? <span className="text-red-500 font-semibold">↓</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center text-xs font-medium">
                          {change > 0 ? <span className="text-green-600">+{change.toLocaleString()}</span>
                            : change < 0 ? <span className="text-red-500">{change.toLocaleString()}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <ClaimAction keyword={r.keyword} claimed={claimed} onClaim={() => claimKeyword(r.keyword, '搜索量查询', r.volume)} compact />
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

    if (rightTab === 'volumeRising') {
      const base_vr = volumeRisingWordsSorted.filter(w => !submittedSet.has(w.keyword))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted_vr = sortCol && sortDir ? [...base_vr].sort((a: any, b: any) => {
        const va: any = sortCol === 'date' ? (a.last_date||'') : sortCol === 'volume' ? (a.volume??0) : sortCol === 'change' ? (a.change??0) : 0
        const vb: any = sortCol === 'date' ? (b.last_date||'') : sortCol === 'volume' ? (b.volume??0) : sortCol === 'change' ? (b.change??0) : 0
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        return sortDir === 'asc' ? va - vb : vb - va
      }) : base_vr
      const slice = sorted_vr.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE)
      return (
        <>
          <table aria-label="数据表格" className="w-full table-fixed">
            <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-medium w-24"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
              <th className="px-2 py-2 text-left font-medium">关键词</th>
              <th className="px-2 py-2 text-center font-medium w-20"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">涨幅{sortIcons('change')}</span></th>
              <th className="px-2 py-2 text-center font-medium w-20"><span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">搜索量{sortIcons('volume')}</span></th>
              <th className="px-2 py-2 text-center font-medium w-16">排名波动</th>
              <th className="w-14" />
            </tr></thead>
            <tbody>
              {slice.length === 0 ? (
                <tr><td colSpan={6} className="table-td text-center text-gray-400 py-10">暂无搜索量上涨的词</td></tr>
              ) : slice.map((w, i) => (
                <KwRow key={`${w.keyword}|${i}`} keyword={w.keyword} today={today} yesterday={yesterday}
                  badge={null}
                  dateCell={<DateCell date={w.last_date} today={today} yesterday={yesterday} badge={null} />}
                  claimed={claimedSet.has(w.keyword)}
                  onClaim={() => claimKeyword(w.keyword, '搜索上涨', w.volume)}
                  onView={() => openDetail(w.keyword, '搜索上涨')}>
                  <td className="px-2 py-2 text-center text-xs font-medium text-green-600">+{w.change.toLocaleString()}</td>
                  <td className="px-2 py-2 text-center text-xs text-gray-500">{w.volume > 0 ? w.volume.toLocaleString() : '—'}</td>
                  <td className="px-2 py-2 text-center text-xs whitespace-nowrap">
                    {w.rankTrend === 'both' ? <span className="inline-flex items-center font-semibold"><span className="text-green-500">↑</span><span className="text-red-500">↓</span></span>
                      : w.rankTrend === 'up' ? <span className="text-green-500 font-semibold">↑</span>
                      : w.rankTrend === 'down' ? <span className="text-red-500 font-semibold">↓</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </KwRow>
              ))}
            </tbody>
          </table>
          <Pager page={pg} total={sorted_vr.length} onPage={p => setPage('volumeRising', p)} />
        </>
      )
    }

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
          <table aria-label="数据表格" className="w-full table-fixed">
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
          <table aria-label="数据表格" className="w-full table-fixed">
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
          <table aria-label="数据表格" className="w-full table-fixed">
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
          <table aria-label="数据表格" className="w-full table-fixed">
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
          <table aria-label="数据表格" className="w-full table-fixed">
            <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-medium w-24"><span className="inline-flex items-center gap-0.5">日期{sortIcons('date')}</span></th>
              <th className="px-3 py-2 text-left font-medium">
                <div className="flex items-center gap-1.5">
                  <span>关键词</span>
                  <input aria-label="输入内容"
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
      // 按URL合并（同一个URL命中多个词只显示搜索量最高那个），2026-08-20
      const dateRows = dedupeByUrl(
        siteRankdownData.filter(r => r.stat_date === selectedDate && r.volume > 0)
      ).sort((a, b) => b.volume - a.volume)
      return (
        <div>
          {/* Date picker */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs text-gray-400 flex-shrink-0">日期</span>
            <input aria-label="选择日期" type="date" value={selectedDate}
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
              <table aria-label="数据表格" className="w-full table-fixed">
                <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 text-left font-medium">关键词</th>
                  <th className="px-2 py-2 text-left font-medium">页面URL</th>
                  <th className="px-2 py-2 text-center font-medium w-14 whitespace-nowrap">现排名</th>
                  <th className="px-2 py-2 text-center font-medium w-12 whitespace-nowrap">上次</th>
                  <th className="px-2 py-2 text-center font-medium w-12 whitespace-nowrap">跌幅</th>
                  <th className="px-2 py-2 text-center font-medium w-14 whitespace-nowrap">搜索量</th>
                  <th className="w-28" />
                </tr></thead>
                <tbody>
                  {dateRows.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE).map((r, i) => {
                    const claimed = claimedSet.has(r.keyword)
                    const drop = (r.rank_position != null && r.prev_rank != null) ? r.rank_position - r.prev_rank : null
                    return (
                      <tr key={`rd-${r.keyword}|${i}`} onDoubleClick={() => { if (!claimed) claimKeyword(r.keyword, '跌词更新', r.volume) }}
                        className={`border-b border-gray-50 last:border-0 cursor-pointer select-none transition-colors ${claimed ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
                        title={claimed ? '已认领' : '点击认领按钮，或双击此行快捷认领'}>
                        <td className="px-3 py-2">
                          <span className="text-sm text-gray-800 select-text cursor-text" title={r.keyword}
                            onDoubleClick={e => { e.stopPropagation(); if (!claimed) claimKeyword(r.keyword, '跌词更新', r.volume) }}>
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
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <ClaimAction keyword={r.keyword} claimed={claimed} onClaim={() => claimKeyword(r.keyword, '跌词更新', r.volume)} compact />
                            <button onClick={() => openDetail(r.keyword, '跌词更新', r.url)}
                              className="text-xs border rounded px-1.5 py-0.5 text-gray-500 hover:text-gray-700 border-gray-200 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500">详情</button>
                          </div>
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
    ['distribute', '分发词'],
    ['recommend', '今日推荐'],
    ['search', '搜索量查询'], ['volumeRising', '搜索量上涨'], ['cross', '交叉词'], ['rank', '竞品涨排名'],
    ['streak', '连续上涨词'], ['newWords', '共新增词'], ['wordLib', '更新词库'], ['rankdown', '跌词更新'],
  ]
  function SourceTag({ s }: { s: string }) {
    const map: Record<string, string> = { '竞品涨排名': '竞品', '连续上涨词': '连涨', '共新增词': '新增', '搜索量查询': '搜索', '交叉词': '交叉', '更新词库': '词库', '手动添加': '手动', '更新推荐': '更新推荐', '规则推荐': '规则推荐', '竞品规则推荐': '竞品规则', '跌词更新': '跌词', '跌排更新': '跌排', '涨排更新': '涨排', '搜索上涨': '搜涨', '分发词': '分发' }
    return <span className="text-[10px] text-gray-300 flex-shrink-0">{map[s] ?? s}</span>
  }

  // Detail modal inner content
  function DetailBody() {
    if (detailLoading) return <Spinner />
    if (detailSource === '跌排更新' || detailSource === '跌词更新') {
      if (detailUrlSiblings.length === 0) return <p className="text-sm text-gray-400 text-center py-10">这个URL下没有其它命中的词</p>
      return (
        <table aria-label="数据表格" className="w-full">
          <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
            <th className="py-1.5 text-left font-medium">关键词</th>
            <th className="py-1.5 text-center font-medium w-16">排名</th>
            <th className="py-1.5 text-center font-medium w-16">搜索量</th>
          </tr></thead>
          <tbody>
            {detailUrlSiblings.map((r, i) => (
              <tr key={`${r.keyword}|${i}`} className="border-b border-gray-50 last:border-0">
                <td className="py-1.5 text-sm text-gray-800">{r.keyword}</td>
                <td className="py-1.5 text-center text-xs text-gray-600">{r.rank_position ?? <span className="text-gray-400">脱排</span>}</td>
                <td className="py-1.5 text-center text-xs text-gray-500">{r.volume > 0 ? fmtVol(r.volume) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    if (detailSource === '搜索上涨') {
      const byDate = new Map<string, { domain: string; type: 'rankup' | 'rankdown' }[]>()
      for (const r of detailVolumeRisingRows) {
        if (!byDate.has(r.date)) byDate.set(r.date, [])
        byDate.get(r.date)!.push({ domain: r.domain, type: r.type })
      }
      const sorted = Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]))
      if (sorted.length === 0) return <p className="text-sm text-gray-400 text-center py-10">近30天暂无排名记录</p>
      return (
        <div className="space-y-2">
          {sorted.map(([date, entries]) => (
            <div key={date} className="flex items-start gap-2">
              <span className="text-xs text-gray-400 w-10 flex-shrink-0 pt-1">{date.slice(5)}</span>
              <div className="flex flex-wrap gap-1">
                {entries.map(({ domain, type }) => (
                  <span key={`${domain}|${type}`} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">
                    <span>{domain}</span>
                    <span className={type === 'rankup' ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>
                      {type === 'rankup' ? '↑' : '↓'}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }
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

  function retryFailedLoad() {
    if (!loadError) return
    if (loadError.scope === 'groups') void loadGroups()
    else if (loadError.scope === 'claimed' && activeGroupId && effectiveViewingId) {
      void loadClaimed(activeGroupId, effectiveViewingId, selectedDate)
    } else if (loadError.scope === 'radar') void loadRadar()
    else if (loadError.scope === 'distributed') void loadDistributed()
    else if (loadError.scope === 'recommendations') {
      setLoadError(null)
      void loadSiteRankdown(true)
      void loadCompetitorRankup(true)
      void loadSubmissionHistory()
      void loadDismissedRec()
      if (canManage) {
        void loadAllMembersSubmissionHistory()
        void loadAllMembersDismissed()
      }
    }
  }

  return (
    <div className="p-6">
      {claimErrorMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          {claimErrorMsg}
        </div>
      )}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isWorkspaceRoute ? (activeGroup?.name || '任务工作台') : '分组管理'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {isWorkspaceRoute ? '完成今日待办、认领和成果提交' : '编辑分组、配置成员与站点，并进入各分组工作台'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {((isWorkspaceRoute && groups.length > 0) || (!isWorkspaceRoute && canManage)) && <BaiduCookiePoolManager />}
          {isWorkspaceRoute && groups.length > 0 && (
            <select aria-label="切换分组工作台" value={activeGroupId ?? ''}
              onChange={event => router.push(`/task-groups/${encodeURIComponent(event.target.value)}`)}
              className="min-w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500">
              {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          )}
          {canManage && !isWorkspaceRoute && (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={openCreateModal} className="btn-primary">
                <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                新增分组
              </button>
            </div>
          )}
        </div>
      </div>

      {loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{loadError.message}。已有内容会保留，你可以重试。</span>
          <button type="button" onClick={retryFailedLoad}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-500">
            重试
          </button>
        </div>
      )}

      {loading ? <Spinner /> : groups.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 text-gray-400">
          <p className="text-sm">{canManage ? '还没有分组，点击右上角新增' : '你尚未加入任何分组'}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {!isWorkspaceRoute && canManage && (
          <>
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">1 · 选择分组</p>
              <p className="text-xs text-gray-400">先选择要处理的分组，再进入任务工作台</p>
            </div>
            <span className="text-xs text-gray-400">共 {groups.length} 个分组</span>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map(g => (
              <div key={g.id} role="link" tabIndex={0}
                onClick={() => router.push(`/task-groups/${encodeURIComponent(g.id)}`)}
                onKeyDown={event => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    router.push(`/task-groups/${encodeURIComponent(g.id)}`)
                  }
                }}
                className="group cursor-pointer rounded-xl border border-gray-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-green-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-base font-semibold text-gray-900 group-hover:text-green-700">{g.name}</span>
                    <span className="mt-1 block text-xs text-gray-500">{g.members.length} 位成员 · {g.site_domains.length} 个站点</span>
                  </span>
                  <Link href={`/task-groups/${encodeURIComponent(g.id)}`}
                    onClick={event => event.stopPropagation()}
                    className="rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 focus-visible:ring-2 focus-visible:ring-green-500">进入工作台</Link>
                </span>
                <span className="mt-3 flex flex-wrap gap-1.5">
                  {g.members.slice(0, 4).map(member => <span key={member.user_id} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{member.username}</span>)}
                  {g.members.length > 4 && <span className="px-1 py-0.5 text-xs text-gray-400">+{g.members.length - 4}</span>}
                </span>
                <span className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
                  <button type="button" onClick={event => { event.stopPropagation(); void openEditModal(g) }}
                    className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500">编辑分组</button>
                  {isSuper && (
                    <button type="button" onClick={event => { event.stopPropagation(); openDeleteModal(g.id) }}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500">删除</button>
                  )}
                </span>
              </div>
            ))}
          </div>
          </>
          )}

          {isWorkspaceRoute && !activeGroup && (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <p className="text-sm font-medium text-gray-700">无法进入这个分组工作台</p>
              <p className="mt-1 text-xs text-gray-400">分组不存在，或者你不是该分组成员。</p>
              {canManage && <Link href="/task-groups" className="mt-4 btn-secondary">返回分组管理</Link>}
            </div>
          )}

          {isWorkspaceRoute && workspaceOpen && activeGroup && (
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
                  <input aria-label="选择日期" type="date" value={selectedDate} max={today}
                    onChange={e => setSelectedDate(e.target.value || today)}
                    className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500 cursor-pointer" />
                </div>
                <div ref={claimedListRef} className="flex-1 overflow-y-auto">
                  {claimedLoading ? <Spinner /> : displayedClaims.length === 0 ? (
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
                              onClick={() => setExpandedClaimIds(prev => prev.has(k.id) ? new Set<string>() : new Set<string>([k.id]))}
                            >
                              {(isViewingOwn || canManage) && (k.status === 'pending' || k.status === 'submitted') ? (
                                <button onClick={e => { e.stopPropagation(); dismissClaimed(k.id) }} className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-sm leading-none" title={k.status === 'submitted' ? '移除这条已提交的记录（分组认领错了/提交错了都可以用这个撤掉）' : '移除'}>×</button>
                              ) : (
                                <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs ${k.status !== 'pending' ? 'text-green-400' : ''}`}>{k.status !== 'pending' ? '✓' : ''}</span>
                              )}
                              <span className="flex-1 text-sm text-gray-800 truncate" title={k.keyword}>{k.keyword}</span>
                              {k.claimed_date && k.claimed_date !== selectedDate && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 bg-amber-50 text-amber-600 border border-amber-200" title={`${k.claimed_date} 认领，还没提交`}>
                                  {k.claimed_date.slice(5).replace('-', '/')} 待提交
                                </span>
                              )}
                              {hasDetail && !isExpanded && k.operation_type && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${k.operation_type === '新增' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>{k.operation_type}</span>
                              )}
                              <SourceTag s={k.source} />
                              <span className="text-gray-300 text-xs flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                            </div>
                            {isExpanded && (isViewingOwn || canManage) && (
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
                                <input aria-label="输入内容"
                                  type="text"
                                  defaultValue={k.final_keyword ?? ''}
                                  placeholder="最终做的词"
                                  className={`w-full text-xs px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-green-400 bg-white placeholder-gray-300 ${isInvalid && !k.final_keyword?.trim() ? 'border-red-300 placeholder-red-300' : 'border-gray-200'}`}
                                  onBlur={e => { if (e.target.value !== (k.final_keyword ?? '')) { saveClaim(k.id, 'final_keyword', e.target.value); if (e.target.value.trim()) setInvalidClaimIds(prev => { const n = new Set(prev); n.delete(k.id); return n }) } }}
                                />
                                <input aria-label="输入内容"
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
                        <input aria-label="输入内容"
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
                          <input aria-label="输入内容"
                            type="text"
                            value={addFinalKw}
                            onChange={e => setAddFinalKw(e.target.value)}
                            placeholder="最终做的词"
                            className="flex-1 min-w-0 text-xs px-2 py-0.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-green-400 bg-white"
                          />
                        </div>
                        <input aria-label="输入内容"
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
                      aria-pressed={rightTab === tab}
                      className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${rightTab === tab ? 'border-green-500 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {renderRightContent()}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showDistributeModal && (
        <div role="dialog" aria-modal="true" aria-label="添加分发词" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowDistributeModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">添加分发词</h3>
                <p className="text-xs text-gray-400 mt-0.5">一行一个词，添加后会自动查搜索量（查不到精确值时会尝试按原词估一个）</p>
              </div>
              <button onClick={() => setShowDistributeModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              <textarea aria-label="输入详细内容"
                value={distributeText}
                onChange={e => { setDistributeText(e.target.value); setDistributeMsg('') }}
                placeholder={'Lo研社官方正版\nTokimeki ai\n超自然卡头插件免费版\nreWASD安卓汉化版\n小呆阅读安卓版\n小书阁纯净版'}
                rows={10}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-400 font-mono resize-none"
              />
              <div>
                <label className="block text-xs text-gray-600 mb-1">这批词属于什么（可选）</label>
                <input aria-label="输入内容" type="text" value={distributeBatchName} onChange={e => setDistributeBatchName(e.target.value)}
                  placeholder="比如：AI聊天类应用"
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-400" />
              </div>
              <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
                <input aria-label="选择此项" type="checkbox" checked={distributeRepeatable} onChange={e => setDistributeRepeatable(e.target.checked)}
                  className="mt-0.5" />
                <span>
                  可重复认领
                  <span className="block text-[10px] text-gray-400 mt-0.5">
                    不勾选＝一次性：谁认领了就永久锁定；勾选后认领满冷却天数会自动重新开放给别人认领
                  </span>
                </span>
              </label>
              {distributeRepeatable && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">冷却天数</label>
                  <input aria-label="输入数值" type="number" min={1} value={distributeCooldownDays}
                    onChange={e => setDistributeCooldownDays(e.target.value)}
                    className="w-24 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-400" />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-600 mb-1">每日名额上限（可选）</label>
                <input aria-label="输入数值" type="number" min={1} value={distributeDailyLimit}
                  onChange={e => setDistributeDailyLimit(e.target.value)}
                  placeholder="不填＝不限"
                  className="w-24 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-400" />
                <p className="text-[10px] text-gray-400 mt-0.5">这批词当天整组总共最多能被认领几个，先到先得，留空不限制</p>
              </div>
              {distributeMsg && <p className="text-xs text-red-500">{distributeMsg}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
              <button onClick={() => setShowDistributeModal(false)}
                className="flex-1 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button onClick={submitDistributeWords} disabled={distributeSaving || !distributeText.trim()}
                className="flex-1 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40">
                {distributeSaving ? '添加中…' : '添加'}
              </button>
            </div>
          </div>
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
        <div role="dialog" aria-modal="true" aria-labelledby="delete-group-title" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 id="delete-group-title" className="font-semibold text-gray-900">删除分组</h3>
            <p className="mt-2 text-sm text-gray-600">
              即将永久删除“{groups.find(group => group.id === deleteId)?.name || '此分组'}”。分组成员和设置会一并移除，此操作无法恢复。
            </p>
            <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              仅超管可以执行。请输入当前登录超管的用户名和密码再次确认。
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">超管用户名</span>
                <input type="text" autoComplete="username" value={deleteUsername}
                  onChange={event => { setDeleteUsername(event.target.value); setDeleteError('') }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">密码</span>
                <input type="password" autoComplete="current-password" value={deletePassword}
                  onChange={event => { setDeletePassword(event.target.value); setDeleteError('') }}
                  onKeyDown={event => { if (event.key === 'Enter' && deleteUsername.trim() && deletePassword) void handleDelete(deleteId) }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400" />
              </label>
              {deleteError && <p role="alert" className="text-sm text-red-600">{deleteError}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeDeleteModal} disabled={deleting} className="btn-ghost disabled:opacity-50">取消</button>
              <button onClick={() => void handleDelete(deleteId)} disabled={deleting || !deleteUsername.trim() || !deletePassword}
                className="btn-danger disabled:cursor-not-allowed disabled:opacity-40">
                {deleting ? '验证并删除中…' : '验证身份并永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 今日推荐"×"确认弹窗——永久移除 / 7天后再显示 */}
      {dismissConfirm && (
        <div role="dialog" aria-modal="true" aria-label="确认移除推荐" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDismissConfirm(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-2">移除"{dismissConfirm.keyword}"</h3>
            <p className="text-sm text-gray-500 mb-5">
              {dismissConfirm.memberName ? `这是${dismissConfirm.memberName}的推荐词，` : ''}要7天后再显示，还是永久不再推荐？
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { dismissRec(dismissConfirm.keyword, dismissConfirm.targetUserId, false); setDismissConfirm(null) }}
                className="btn-ghost w-full">7天后再显示</button>
              <button
                onClick={() => { dismissRec(dismissConfirm.keyword, dismissConfirm.targetUserId, true); setDismissConfirm(null) }}
                className="btn-danger w-full">永久移除</button>
              <button onClick={() => setDismissConfirm(null)} className="text-xs text-gray-400 hover:text-gray-600 mt-1">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailKw && (
        <div role="dialog" aria-modal="true" aria-label="关键词详情" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailKw(null)}>
          <div className={`bg-white rounded-xl shadow-2xl w-full max-h-[80vh] flex flex-col ${detailSource === '交叉词' ? 'max-w-3xl' : 'max-w-lg'}`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">{detailKw}</h3>
                <p className="text-xs text-gray-400 mt-0.5">近30天出现记录</p>
              </div>
              <button type="button" aria-label="关闭关键词详情" onClick={() => setDetailKw(null)} className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700 text-xl leading-none">×</button>
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
