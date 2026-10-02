'use client'

import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import Link from 'next/link'

type AppRow = {
  id: string; name: string; platform: string; package_identifier: string | null
  status: string; latest_approved_version: string | null; latest_approved_at: string | null
}
type SourceRow = {
  id: string; app_id: string; source_name: string; source_type: string; source_url: string
  enabled: boolean; last_status: string; last_checked_at: string | null; last_error: string | null
  consecutive_failures: number
}
type ReleaseRow = {
  id: string; app_id: string; source_id: string; version: string; changelog: string
  release_date: string | null; package_size: string | null; download_url: string | null
  source_url: string; review_status: 'pending' | 'approved' | 'rejected'
  extraction_confidence: number; discovered_at: string
  app_name: string; app_platform: string; source_name: string; source_type: string
}
type ReleaseGroup = ReleaseRow & {
  release_count: number
  releases: ReleaseRow[]
}
type RunRow = {
  id: string; app_id: string; source_id: string; status: string; discovered_version: string | null
  error_message: string | null; action_run_id: string | null; started_at: string; completed_at: string | null
  app_name: string; source_name: string
}
type FormState = {
  name: string; platform: string; packageIdentifier: string
  sourceName: string; sourceType: string; sourceUrl: string
}
type DiscoveryTarget = 'app_store' | 'google_play' | 'taptap'

const EMPTY_FORM: FormState = {
  name: '', platform: 'android', packageIdentifier: '', sourceName: '官方网站', sourceType: 'official', sourceUrl: '',
}
const PLATFORM_LABELS: Record<string, string> = {
  android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', web: 'Web', other: '其他',
}
const SOURCE_LABELS: Record<string, string> = {
  official: '官方网站', app_store: 'App Store', google_play: 'Google Play', taptap: 'TapTap', download_site: '下载站', other: '其他来源',
}
const REVIEW_META = {
  pending: { label: '待审核', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  approved: { label: '已通过', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  rejected: { label: '已忽略', className: 'border-slate-200 bg-slate-50 text-slate-500' },
}

function formatTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

export default function AppUpdateCenterClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<'updates' | 'apps' | 'runs'>('updates')
  const [apps, setApps] = useState<AppRow[]>([])
  const [sources, setSources] = useState<SourceRow[]>([])
  const [releases, setReleases] = useState<ReleaseRow[]>([])
  const [runs, setRuns] = useState<RunRow[]>([])
  const [summary, setSummary] = useState({ apps: 0, pending: 0, failingSources: 0, approved: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [reviewFilter, setReviewFilter] = useState('pending')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detail, setDetail] = useState<ReleaseGroup | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [targetOpen, setTargetOpen] = useState(false)
  const [discoveryOpen, setDiscoveryOpen] = useState<DiscoveryTarget | null>(null)
  const [discoveryEntries, setDiscoveryEntries] = useState('')
  const [discoveryCountry, setDiscoveryCountry] = useState('cn')
  const [sourceApp, setSourceApp] = useState<AppRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [discovering, setDiscovering] = useState<DiscoveryTarget | null>(null)

  const pageSize = 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) })
      if (deferredSearch.trim()) params.set('search', deferredSearch.trim())
      if (tab === 'updates' && reviewFilter) params.set('reviewStatus', reviewFilter)
      if (tab === 'updates' && sourceFilter) params.set('sourceType', sourceFilter)
      const response = await fetch(`/api/app-updates?${params}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '应用更新资料读取失败')
      setApps(tab === 'apps' ? data.items ?? [] : [])
      setSources(tab === 'apps' ? data.sources ?? [] : [])
      setReleases(tab === 'updates' ? data.items ?? [] : [])
      setRuns(tab === 'runs' ? data.items ?? [] : [])
      setTotal(data.total ?? 0)
      setSummary(data.summary ?? { apps: 0, pending: 0, failingSources: 0, approved: 0 })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '应用更新资料读取失败')
    } finally {
      setLoading(false)
    }
  }, [deferredSearch, page, reviewFilter, sourceFilter, tab])

  useEffect(() => { load() }, [load])

  async function openDetail(release: ReleaseRow) {
    setDetail({ ...release, release_count: 0, releases: [] })
    setDetailLoading(true)
    setDetailError('')
    try {
      const response = await fetch(`/api/app-updates/${release.app_id}/releases`, { cache: 'no-store' })
      const data = await response.json() as { releases?: ReleaseRow[]; release_count?: number; error?: string }
      if (!response.ok) throw new Error(data.error || '历史版本读取失败')
      setDetail(current => current?.app_id === release.app_id
        ? { ...current, releases: data.releases ?? [], release_count: data.release_count ?? 0 }
        : current)
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : '历史版本读取失败')
    } finally {
      setDetailLoading(false)
    }
  }

  async function saveTarget() {
    setSaving(true); setError('')
    try {
      const endpoint = sourceApp ? `/api/app-updates/${sourceApp.id}/sources` : '/api/app-updates'
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '保存失败')
      setTargetOpen(false); setSourceApp(null); setForm(EMPTY_FORM); await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function reviewRelease(id: string, reviewStatus: 'approved' | 'rejected') {
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/app-updates/releases/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewStatus }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '审核失败')
      setDetail(null); await load()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : '审核失败')
    } finally {
      setSaving(false)
    }
  }

  async function deleteApp(appId: string, appName: string) {
    if (!window.confirm(`确定删除「${appName}」吗？\n\n该应用的全部来源、版本和抓取记录都会一起删除，无法恢复。`)) return
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/app-updates/${appId}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '删除应用失败')
      setDetail(null)
      setNotice(`已删除应用「${appName}」及其全部资料。`)
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除应用失败')
    } finally {
      setSaving(false)
    }
  }

  async function exportSelected(allMatching = false) {
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/app-updates/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appIds: selectedIds, allMatching, search: deferredSearch.trim(),
          reviewStatus: reviewFilter, sourceType: sourceFilter,
        }),
      })
      if (!response.ok) {
        const data = await response.json(); throw new Error(data.error || '导出失败')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = `app-updates-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click()
      URL.revokeObjectURL(url)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出失败')
    } finally {
      setSaving(false)
    }
  }

  async function startDiscovery() {
    if (!discoveryOpen) return
    const target = discoveryOpen
    const labels: Record<DiscoveryTarget, string> = {
      app_store: 'App Store', google_play: 'Google Play', taptap: 'TapTap',
    }
    setDiscovering(target); setError(''); setNotice('')
    try {
      const response = await fetch('/api/app-updates/discover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, country: discoveryCountry, entries: discoveryEntries }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '应用发现失败')
      setNotice(`${labels[target]} 发现完成：找到 ${Number(data.found ?? 0)} 个应用，新增 ${Number(data.appsCreated ?? 0)} 个应用，新增 ${Number(data.releasesCreated ?? 0)} 条版本资料。`)
      setDiscoveryOpen(null); setDiscoveryEntries(''); await load()
    } catch (discoveryError) {
      setError(discoveryError instanceof Error ? discoveryError.message : '应用发现失败')
    } finally {
      setDiscovering(null)
    }
  }

  function openNewTarget() {
    setSourceApp(null); setForm(EMPTY_FORM); setTargetOpen(true)
  }
  function changeTab(nextTab: 'updates' | 'apps' | 'runs') {
    setTab(nextTab); setPage(1); setSearch(''); setReviewFilter(nextTab === 'updates' ? 'pending' : ''); setSourceFilter(''); setSelectedIds([])
  }
  function toggleCurrentPage(checked: boolean) {
    const pageIds = releases.map(release => release.app_id)
    setSelectedIds(current => checked
      ? [...new Set([...current, ...pageIds])]
      : current.filter(id => !pageIds.includes(id)))
  }
  function openNewSource(app: AppRow) {
    setSourceApp(app); setForm({ ...EMPTY_FORM, name: app.name, platform: app.platform, packageIdentifier: app.package_identifier ?? '' }); setTargetOpen(true)
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-xs font-semibold text-blue-700 hover:underline">← 返回系统首页</Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">应用更新中心</h1>
            <p className="mt-2 text-sm text-slate-500">集中发现应用新版本、审核更新日志并批量导出。</p>
          </div>
          {canManage && <div className="flex flex-wrap items-center justify-end gap-2">
            {([['app_store', '发现AppStore新应用'], ['google_play', '发现GooglePlay新应用'], ['taptap', '发现TapTap新应用']] as const).map(([target, label]) => <button key={target} type="button" disabled={discovering !== null} onClick={() => { setDiscoveryOpen(target); setDiscoveryCountry(target === 'app_store' ? 'cn' : 'us'); setDiscoveryEntries(''); setError(''); setNotice('') }} className="h-10 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50">{label}</button>)}
            <button type="button" onClick={openNewTarget} className="h-10 whitespace-nowrap rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">手工建立应用</button>
          </div>}
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['实验应用', summary.apps], ['待审核更新', summary.pending], ['已通过记录', summary.approved], ['异常来源', summary.failingSources],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>)}
        </div>

        {error && <div className="mt-4 flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button onClick={load} className="font-semibold underline">重试</button></div>}
        {notice && <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex gap-6">
              {([['updates', '应用更新'], ['apps', '应用与来源'], ['runs', '抓取记录']] as const).map(([key, label]) => <button key={key} onClick={() => changeTab(key)} className={`relative h-14 text-sm font-semibold ${tab === key ? 'text-blue-700' : 'text-slate-500'}`}>{label}{tab === key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600" />}</button>)}
            </div>
            <div className="flex flex-wrap gap-2 py-3">
              <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); setSelectedIds([]) }} placeholder="搜索应用名称" className="h-10 w-44 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" />
              {tab === 'updates' && <>
                <select value={sourceFilter} onChange={event => { setSourceFilter(event.target.value); setPage(1); setSelectedIds([]) }} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                  <option value="">全部来源</option>
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={reviewFilter} onChange={event => { setReviewFilter(event.target.value); setPage(1); setSelectedIds([]) }} className="h-10 rounded-lg border border-slate-200 px-3 text-sm"><option value="">全部状态</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已忽略</option></select>
                <button disabled={selectedIds.length === 0 || saving} onClick={() => exportSelected()} className="h-10 rounded-lg border border-blue-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-40">导出已选应用 {selectedIds.length || ''}</button>
                <button disabled={total === 0 || saving} onClick={() => exportSelected(true)} className="h-10 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-40">导出全部应用 {total}</button>
              </>}
            </div>
          </div>

          {loading ? <div className="py-24 text-center text-sm text-slate-400">正在读取资料…</div> : tab === 'updates' ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[980px] table-fixed"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="w-12 px-5 py-3"><input type="checkbox" aria-label="全选本页应用" title="全选本页应用" checked={releases.length > 0 && releases.every(release => selectedIds.includes(release.app_id))} onChange={event => toggleCurrentPage(event.target.checked)} /></th><th className="w-52 px-3 py-3">应用</th><th className="w-32 px-3 py-3">最新版本</th><th className="px-3 py-3">最新更新日志</th><th className="w-32 px-3 py-3">来源</th><th className="w-28 px-3 py-3">状态</th><th className="w-32 px-3 py-3">发现时间</th><th className="w-24 px-3 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">
              {releases.length === 0 ? <tr><td colSpan={8} className="py-20 text-center text-sm text-slate-400">没有符合条件的应用更新。</td></tr> : releases.map(release => { const meta = REVIEW_META[release.review_status]; return <tr key={release.app_id} className="hover:bg-blue-50/30"><td className="px-5 py-4"><input type="checkbox" aria-label={`选择 ${release.app_name}`} checked={selectedIds.includes(release.app_id)} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, release.app_id])] : current.filter(id => id !== release.app_id))} /></td><td className="px-3 py-4"><p className="truncate text-sm font-semibold text-slate-900">{release.app_name}</p><p className="mt-1 text-xs text-slate-400">{PLATFORM_LABELS[release.app_platform] ?? release.app_platform} · 点击查看历史版本</p></td><td className="px-3 py-4"><p className="font-mono text-sm font-semibold text-slate-800">{release.version}</p><p className="mt-1 text-xs text-slate-400">{release.release_date ?? release.package_size ?? '日期未知'}</p></td><td className="px-3 py-4"><p className="line-clamp-2 text-sm leading-6 text-slate-600">{release.changelog || '未提取到更新日志'}</p></td><td className="px-3 py-4 text-sm text-slate-600">{release.source_name}</td><td className="px-3 py-4"><span className={`rounded-full border px-2.5 py-1 text-xs ${meta.className}`}>{meta.label}</span></td><td className="px-3 py-4 text-xs text-slate-500">{formatTime(release.discovered_at)}</td><td className="px-3 py-4"><button onClick={() => openDetail(release)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-700">查看</button></td></tr> })}
            </tbody></table></div>
          ) : tab === 'apps' ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[850px]"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-5 py-3">应用</th><th className="px-4 py-3">已通过版本</th><th className="px-4 py-3">抓取来源</th><th className="px-4 py-3">最近检查</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{apps.length === 0 ? <tr><td colSpan={5} className="py-20 text-center text-sm text-slate-400">没有符合条件的应用</td></tr> : apps.map(app => { const appSources = sources.filter(source => source.app_id === app.id); const latestCheck = appSources.map(source => source.last_checked_at).filter(Boolean).sort().at(-1) ?? null; return <tr key={app.id}><td className="px-5 py-4"><p className="text-sm font-semibold text-slate-900">{app.name}</p><p className="mt-1 text-xs text-slate-400">{PLATFORM_LABELS[app.platform]}{app.package_identifier ? ` · ${app.package_identifier}` : ''}</p></td><td className="px-4 py-4 font-mono text-sm text-slate-700">{app.latest_approved_version ?? '—'}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{appSources.map(source => <a key={source.id} href={source.source_url} target="_blank" rel="noreferrer" title={source.last_error ?? source.source_url} className={`rounded px-2 py-1 text-xs ${source.last_status === 'error' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{source.source_name}</a>)}</div></td><td className="px-4 py-4 text-sm text-slate-500">{formatTime(latestCheck)}</td><td className="px-5 py-4 text-right"><button onClick={() => openNewSource(app)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-700">添加来源</button></td></tr> })}</tbody></table></div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[800px]"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-5 py-3">开始时间</th><th className="px-4 py-3">应用</th><th className="px-4 py-3">来源</th><th className="px-4 py-3">结果</th><th className="px-4 py-3">发现版本</th><th className="px-5 py-3">错误</th></tr></thead><tbody className="divide-y divide-slate-100">{runs.length === 0 ? <tr><td colSpan={6} className="py-20 text-center text-sm text-slate-400">没有符合条件的运行记录</td></tr> : runs.map(run => <tr key={run.id}><td className="px-5 py-4 text-sm text-slate-500">{formatTime(run.started_at)}</td><td className="px-4 py-4 text-sm font-medium text-slate-800">{run.app_name}</td><td className="px-4 py-4 text-sm text-slate-600">{run.source_name}</td><td className="px-4 py-4 text-sm text-slate-600">{{ running: '运行中', completed: '发现新版本', no_change: '没有变化', failed: '失败' }[run.status] ?? run.status}</td><td className="px-4 py-4 font-mono text-sm text-slate-700">{run.discovered_version ?? '—'}</td><td className="max-w-sm px-5 py-4 text-sm text-red-600"><p className="truncate" title={run.error_message ?? ''}>{run.error_message ?? '—'}</p></td></tr>)}</tbody></table></div>
          )}
          {!loading && total > 0 && <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="text-slate-500">共 {total} {tab === 'updates' ? '个应用' : '条'} · 第 {page} / {totalPages} 页</p><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))} className="h-9 rounded-lg border border-slate-200 px-4 font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">上一页</button><button type="button" disabled={page >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))} className="h-9 rounded-lg border border-slate-200 px-4 font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">下一页</button></div></div>}
        </section>
      </main>

      {discoveryOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
            <div><h2 className="text-lg font-bold text-slate-950">{{ app_store: '发现AppStore新应用', google_play: '发现GooglePlay新应用', taptap: '发现TapTap新应用' }[discoveryOpen]}</h2><p className="mt-1 text-xs leading-5 text-slate-500">不填写链接会扫描排行榜；填写后只导入指定应用。点击下方按钮后才会开始执行。</p></div>
            <button type="button" onClick={() => setDiscoveryOpen(null)} className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="关闭">✕</button>
          </div>
          <div className="space-y-4 px-6 py-5">
            {discoveryOpen !== 'taptap' && <label className="block text-sm font-medium text-slate-700">商店地区<select value={discoveryCountry} onChange={event => setDiscoveryCountry(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3"><option value={discoveryOpen === 'app_store' ? 'cn' : 'us'}>{discoveryOpen === 'app_store' ? '中国大陆' : '美国'}</option><option value="my">马来西亚</option><option value="sg">新加坡</option>{discoveryOpen === 'app_store' && <><option value="us">美国</option><option value="hk">中国香港</option><option value="tw">中国台湾</option></>}</select></label>}
            <label className="block text-sm font-medium text-slate-700">{{ app_store: 'App Store 链接或 Apple ID（可不填）', google_play: 'Google Play 链接或包名（可不填）', taptap: 'TapTap 链接或应用 ID（可不填）' }[discoveryOpen]}<textarea value={discoveryEntries} onChange={event => setDiscoveryEntries(event.target.value)} rows={6} placeholder={{ app_store: 'https://apps.apple.com/.../id123456789\n987654321', google_play: 'https://play.google.com/store/apps/details?id=com.example.app\ncom.example.app', taptap: 'https://www.taptap.cn/app/123456\n123456' }[discoveryOpen]} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-3 font-mono text-sm outline-none focus:border-blue-400" /></label>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-800">{discoveryEntries.trim() ? '本次只会查询并导入上面填写的应用。' : '本次会从该商店排行榜自动发现新应用，已有应用会跳过，并更新版本资料。'}</div>
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4"><button type="button" disabled={discovering !== null} onClick={() => setDiscoveryOpen(null)} className="h-10 rounded-lg border border-slate-200 px-4 text-sm">取消</button><button type="button" disabled={discovering !== null} onClick={startDiscovery} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50">{discovering ? '正在发现…' : discoveryEntries.trim() ? '导入指定应用' : '开始扫描排行榜'}</button></div>
        </div>
      </div>}

      {targetOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><div><h2 className="text-lg font-bold text-slate-950">{sourceApp ? `为 ${sourceApp.name} 添加来源` : '新增实验应用'}</h2><p className="mt-1 text-xs text-slate-400">先填写公开更新页面，GitHub Actions 会尝试自动识别资料。</p></div><button onClick={() => setTargetOpen(false)} className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100">✕</button></div><div className="grid gap-4 px-6 py-5 sm:grid-cols-2">{!sourceApp && <><label className="text-sm font-medium text-slate-700">应用名称<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400" /></label><label className="text-sm font-medium text-slate-700">平台<select value={form.platform} onChange={event => setForm(current => ({ ...current, platform: event.target.value }))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3">{Object.entries(PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">包名或应用标识（可不填）<input value={form.packageIdentifier} onChange={event => setForm(current => ({ ...current, packageIdentifier: event.target.value }))} placeholder="例如 com.example.app" className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400" /></label></>}<label className="text-sm font-medium text-slate-700">来源名称<input value={form.sourceName} onChange={event => setForm(current => ({ ...current, sourceName: event.target.value }))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400" /></label><label className="text-sm font-medium text-slate-700">来源类型<select value={form.sourceType} onChange={event => setForm(current => ({ ...current, sourceType: event.target.value }))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3">{Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">更新页面 URL<input value={form.sourceUrl} onChange={event => setForm(current => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://..." className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400" /></label></div><div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4"><button onClick={() => setTargetOpen(false)} className="h-10 rounded-lg border border-slate-200 px-4 text-sm">取消</button><button disabled={saving} onClick={saveTarget} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : '保存'}</button></div></div></div>}

      {detail && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
        <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
            <div><p className="text-xs text-slate-400">{PLATFORM_LABELS[detail.app_platform] ?? detail.app_platform}</p><h2 className="mt-1 text-xl font-bold text-slate-950">{detail.app_name}</h2><p className="mt-1 text-xs text-slate-500">{detailLoading ? '正在读取历史版本…' : `共保留 ${detail.release_count} 个版本，最新版本排在前面`}</p></div>
            <div className="flex items-center gap-2">{canManage && <button type="button" disabled={saving} onClick={() => deleteApp(detail.app_id, detail.app_name)} className="h-9 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">删除应用</button>}<button onClick={() => setDetail(null)} className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="关闭">✕</button></div>
          </div>
          <div className="space-y-4 overflow-y-auto bg-slate-50/70 px-6 py-5">
            {detailLoading && <p className="py-12 text-center text-sm text-slate-500">正在读取历史版本…</p>}
            {detailError && <div className="flex items-center justify-between gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-700"><span>{detailError}</span><button type="button" onClick={() => openDetail(detail)} className="font-semibold underline">重试</button></div>}
            {detail.releases.map((release, index) => { const meta = REVIEW_META[release.review_status]; return <article key={release.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-mono text-base font-bold text-slate-900">版本 {release.version}</h3>{index === 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">最新</span>}<span className={`rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}>{meta.label}</span></div><p className="mt-1 text-xs text-slate-400">{release.release_date ?? '发布日期未识别'} · {release.source_name} · {formatTime(release.discovered_at)} 发现</p></div>
                <p className="text-xs text-slate-400">识别可信度 {release.extraction_confidence}%</p>
              </div>
              <p className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-7 text-slate-700">{release.changelog || '这个版本没有提取到更新日志。'}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-3"><a href={release.source_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-700">来源页面 ↗</a>{release.download_url && <a href={release.download_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-700">下载链接 ↗</a>}</div><div className="flex gap-2"><button disabled={saving} onClick={() => reviewRelease(release.id, 'rejected')} className="h-9 rounded-lg px-3 text-sm font-semibold text-slate-500 hover:bg-red-50 hover:text-red-600">忽略</button><button disabled={saving} onClick={() => reviewRelease(release.id, 'approved')} className="h-9 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">确认更新</button></div></div>
            </article> })}
          </div>
        </div>
      </div>}
    </div>
  )
}
