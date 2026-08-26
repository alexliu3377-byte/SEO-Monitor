'use client'

import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import SiteTable from '@/components/site-table'
import AddSiteModal from '@/components/add-site-modal'

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

interface PendingToggle {
  site: Site
  direction: 'to_site_keyword_ranks' | 'to_rank_changes'
  // after migration: the new field values to apply
  newRankData: boolean
  newRankTitle: boolean
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editSite, setEditSite] = useState<Site | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterSite, setFilterSite] = useState('')
  const [filterFocus, setFilterFocus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null)
  const [migrating, setMigrating] = useState(false)

  async function loadSites() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sites')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载失败')
      setSites(data.sites || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadSites() }, [])

  function handleEdit(site: Site) {
    setEditSite(site)
    setShowModal(true)
  }

  async function handleDelete(site: Site) {
    if (!confirm(`确认删除 ${site.domain}？此操作不可恢复。`)) return
    setDeletingId(site.id)
    try {
      const res = await fetch('/api/sites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '删除失败')
      }
      await loadSites()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleToggle(site: Site) {
    try {
      const res = await fetch('/api/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...site, is_enabled: !site.is_enabled }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '更新失败')
      }
      setSites((prev) =>
        prev.map((s) => s.id === site.id ? { ...s, is_enabled: !s.is_enabled } : s)
      )
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '更新失败')
    }
  }

  async function applyToggle(site: Site, newRankData: boolean, newRankTitle: boolean) {
    const res = await fetch('/api/sites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...site, has_rank_data: newRankData, has_rank_title: newRankTitle }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '更新失败')
    }
    setSites((prev) =>
      prev.map((s) => s.id === site.id ? { ...s, has_rank_data: newRankData, has_rank_title: newRankTitle } : s)
    )
  }

  function handleToggleRank(site: Site) {
    const newVal = !site.has_rank_data
    // Turning ON 排名 while 竞品追踪 is active → offer migration
    if (newVal && site.has_rank_title) {
      setPendingToggle({ site, direction: 'to_rank_changes', newRankData: true, newRankTitle: false })
      return
    }
    applyToggle(site, newVal, newVal ? false : site.has_rank_title).catch(err => alert(err.message))
  }

  async function handleToggleIndexPages(site: Site) {
    try {
      const res = await fetch('/api/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...site, has_index_pages: !site.has_index_pages }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '更新失败')
      }
      setSites((prev) =>
        prev.map((s) => s.id === site.id ? { ...s, has_index_pages: !s.has_index_pages } : s)
      )
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '更新失败')
    }
  }

  function handleToggleRankTitle(site: Site) {
    const newVal = !site.has_rank_title
    // Turning ON 竞品追踪 while 排名 is active → offer migration
    if (newVal && site.has_rank_data) {
      setPendingToggle({ site, direction: 'to_site_keyword_ranks', newRankData: false, newRankTitle: true })
      return
    }
    applyToggle(site, newVal ? false : site.has_rank_data, newVal).catch(err => alert(err.message))
  }

  async function handleTogglePcRank(site: Site) {
    const currentlyOn = site.track_pc_rank !== false // 没设过(null)按默认true算，跟建表默认值一致
    const newVal = !currentlyOn
    try {
      const res = await fetch('/api/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...site, track_pc_rank: newVal }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '更新失败')
      }
      setSites((prev) => prev.map((s) => s.id === site.id ? { ...s, track_pc_rank: newVal } : s))
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '更新失败')
    }
  }

  async function executePendingToggle(withMigration: boolean) {
    if (!pendingToggle) return
    const { site, direction, newRankData, newRankTitle } = pendingToggle
    setMigrating(true)
    try {
      if (withMigration) {
        const res = await fetch('/api/migrate-rank-site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ site_id: site.id, direction }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '迁移失败')
      }
      await applyToggle(site, newRankData, newRankTitle)
      setPendingToggle(null)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '操作失败')
    } finally {
      setMigrating(false)
    }
  }

  function handleModalClose() {
    setShowModal(false)
    setEditSite(null)
  }

  function handleSaved() {
    handleModalClose()
    loadSites()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">网站管理</h1>
          <p className="text-gray-400 text-sm mt-0.5">管理所有监控站点的抓取配置</p>
        </div>
        <button
          onClick={() => { setEditSite(null); setShowModal(true) }}
          className="btn-primary"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新增网站
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-3">
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 text-sm">{error}</div>
          </div>
        ) : (() => {
          const filteredSites = sites.filter(s => {
            if (filterSite && !s.domain.toLowerCase().includes(filterSite.toLowerCase()) && !s.name?.toLowerCase().includes(filterSite.toLowerCase())) return false
            if (filterFocus && String(s.focus_level) !== filterFocus) return false
            if (filterCategory && s.category !== filterCategory) return false
            return true
          })
          return (
            <>
              <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">站点</span>
                  <input
                    type="text"
                    value={filterSite}
                    onChange={(e) => setFilterSite(e.target.value)}
                    placeholder="输入域名..."
                    className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none w-36"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">关注级别</span>
                  <select value={filterFocus} onChange={(e) => setFilterFocus(e.target.value)} className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                    <option value="">全部</option>
                    <option value="1">重点</option>
                    <option value="2">侧重</option>
                    <option value="3">普通</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">分类</span>
                  <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none">
                    <option value="">全部</option>
                    <option value="large">大站</option>
                    <option value="medium">中站</option>
                    <option value="small">小站</option>
                  </select>
                </div>
                <span className="ml-auto text-xs text-gray-400">共 {filteredSites.length} 条</span>
              </div>
              <SiteTable
                sites={filteredSites}
                allSites={sites}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggle={handleToggle}
                onToggleRank={handleToggleRank}
                onToggleRankTitle={handleToggleRankTitle}
                onTogglePcRank={handleTogglePcRank}
                onToggleIndexPages={handleToggleIndexPages}
              />
            </>
          )
        })()}
      </div>

      {showModal && (
        <AddSiteModal
          site={editSite}
          onClose={handleModalClose}
          onSaved={handleSaved}
        />
      )}

      {pendingToggle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 mb-1">
              {pendingToggle.direction === 'to_site_keyword_ranks' ? '切换至排名模式' : '切换至涨跌模式'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {pendingToggle.direction === 'to_site_keyword_ranks'
                ? `将 rank_changes 中 ${pendingToggle.site.domain} 的现有记录复制到 site_keyword_ranks（排名/标题字段为空，平台统一设为移动端）。`
                : `将 site_keyword_ranks 中 ${pendingToggle.site.domain} 的移动端记录复制到 rank_changes。PC 端数据、排名及标题字段将会丢弃。`
              }
            </p>
            {pendingToggle.direction === 'to_rank_changes' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs text-amber-700">
                ⚠ 注意：PC 端数据、新排名（rank_position）及标题（title）不会被迁移。
              </div>
            )}
            <p className="text-sm text-gray-600 mb-5">是否同时迁移现有历史数据？</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingToggle(null)}
                disabled={migrating}
                className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={() => executePendingToggle(false)}
                disabled={migrating}
                className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                仅切换，不迁移
              </button>
              <button
                onClick={() => executePendingToggle(true)}
                disabled={migrating}
                className="text-sm px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 flex items-center gap-1.5"
              >
                {migrating && (
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                确认并迁移数据
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
