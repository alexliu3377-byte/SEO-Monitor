'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

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
}
type RunRow = {
  id: string; app_id: string; source_id: string; status: string; discovered_version: string | null
  error_message: string | null; action_run_id: string | null; started_at: string; completed_at: string | null
}
type FormState = {
  name: string; platform: string; packageIdentifier: string
  sourceName: string; sourceType: string; sourceUrl: string
}

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

export default function AppUpdateCenterClient() {
  const [tab, setTab] = useState<'updates' | 'apps' | 'runs'>('updates')
  const [apps, setApps] = useState<AppRow[]>([])
  const [sources, setSources] = useState<SourceRow[]>([])
  const [releases, setReleases] = useState<ReleaseRow[]>([])
  const [runs, setRuns] = useState<RunRow[]>([])
  const [summary, setSummary] = useState({ apps: 0, pending: 0, failingSources: 0, approved: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [reviewFilter, setReviewFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detail, setDetail] = useState<ReleaseRow | null>(null)
  const [targetOpen, setTargetOpen] = useState(false)
  const [appStoreImportOpen, setAppStoreImportOpen] = useState(false)
  const [appStoreEntries, setAppStoreEntries] = useState('')
  const [appStoreCountry, setAppStoreCountry] = useState('cn')
  const [sourceApp, setSourceApp] = useState<AppRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const appMap = useMemo(() => new Map(apps.map(app => [app.id, app])), [apps])
  const sourceMap = useMemo(() => new Map(sources.map(source => [source.id, source])), [sources])
  const visibleReleases = useMemo(() => releases.filter(release => {
    const app = appMap.get(release.app_id)
    const keyword = search.trim().toLocaleLowerCase('zh-CN')
    return (!reviewFilter || release.review_status === reviewFilter)
      && (!keyword || `${app?.name ?? ''} ${release.version} ${release.changelog}`.toLocaleLowerCase('zh-CN').includes(keyword))
  }), [appMap, releases, reviewFilter, search])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/app-updates', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '应用更新资料读取失败')
      setApps(data.apps ?? []); setSources(data.sources ?? []); setReleases(data.releases ?? [])
      setRuns(data.runs ?? []); setSummary(data.summary ?? { apps: 0, pending: 0, failingSources: 0, approved: 0 })
      setSelectedIds(current => current.filter(id => (data.releases ?? []).some((release: ReleaseRow) => release.id === id)))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '应用更新资料读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

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

  async function exportSelected() {
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/app-updates/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selectedIds }),
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

  async function importAppStoreApps(chart?: 'top-free' | 'top-paid') {
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/app-updates/import-app-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: chart ? '' : appStoreEntries,
          country: appStoreCountry,
          chart: chart ?? null,
          limit: 100,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'App Store 批量导入失败')
      const missing = Array.isArray(data.missingIds) && data.missingIds.length > 0
        ? `；${data.missingIds.length} 个 ID 未找到`
        : ''
      setNotice(`App Store 导入完成：新增应用 ${data.imported} 个，已有 ${data.existing} 个，新增版本资料 ${data.releasesCreated} 条${missing}`)
      setAppStoreImportOpen(false); setAppStoreEntries(''); await load()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'App Store 批量导入失败')
    } finally {
      setSaving(false)
    }
  }

  function openNewTarget() {
    setSourceApp(null); setForm(EMPTY_FORM); setTargetOpen(true)
  }
  function openNewSource(app: AppRow) {
    setSourceApp(app); setForm({ ...EMPTY_FORM, name: app.name, platform: app.platform, packageIdentifier: app.package_identifier ?? '' }); setTargetOpen(true)
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><p className="text-xs font-semibold tracking-[0.18em] text-blue-600">V4.0.0 · 超管实验</p><span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600">未正式发布</span></div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">应用更新中心</h1>
            <p className="mt-2 text-sm text-slate-500">集中发现应用新版本、审核更新日志并批量导出。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="https://github.com/alexliu3377-byte/SEO-Monitor/actions/workflows/app-store-discovery.yml" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">Apple 目录扩展</a>
            <a href="https://github.com/alexliu3377-byte/SEO-Monitor/actions/workflows/marketplace-discovery.yml" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">安卓目录扩展</a>
            <a href="https://github.com/alexliu3377-byte/SEO-Monitor/actions/workflows/app-update-crawl.yml" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">打开抓取任务</a>
            <button type="button" onClick={() => { setError(''); setNotice(''); setAppStoreImportOpen(true) }} className="h-10 rounded-lg border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50">批量导入 App Store</button>
            <button type="button" onClick={openNewTarget} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">＋ 新增应用</button>
          </div>
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
              {([['updates', '更新待审核'], ['apps', '应用与来源'], ['runs', '抓取记录']] as const).map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`relative h-14 text-sm font-semibold ${tab === key ? 'text-blue-700' : 'text-slate-500'}`}>{label}{tab === key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600" />}</button>)}
            </div>
            {tab === 'updates' && <div className="flex gap-2 py-3"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索应用或版本" className="h-10 w-44 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" /><select value={reviewFilter} onChange={event => setReviewFilter(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm"><option value="">全部状态</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已忽略</option></select><button disabled={selectedIds.length === 0 || saving} onClick={exportSelected} className="h-10 rounded-lg border border-blue-200 px-3 text-sm font-semibold text-blue-700 disabled:opacity-40">导出 {selectedIds.length || ''}</button></div>}
          </div>

          {loading ? <div className="py-24 text-center text-sm text-slate-400">正在读取资料…</div> : tab === 'updates' ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[980px] table-fixed"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="w-12 px-5 py-3"></th><th className="w-52 px-3 py-3">应用</th><th className="w-28 px-3 py-3">版本</th><th className="px-3 py-3">更新日志</th><th className="w-32 px-3 py-3">来源</th><th className="w-28 px-3 py-3">状态</th><th className="w-32 px-3 py-3">发现时间</th><th className="w-24 px-3 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">
              {visibleReleases.length === 0 ? <tr><td colSpan={8} className="py-20 text-center text-sm text-slate-400">还没有更新记录。新增应用后，从 GitHub Actions 手动运行实验任务。</td></tr> : visibleReleases.map(release => { const app = appMap.get(release.app_id); const source = sourceMap.get(release.source_id); const meta = REVIEW_META[release.review_status]; return <tr key={release.id} className="hover:bg-blue-50/30"><td className="px-5 py-4"><input type="checkbox" checked={selectedIds.includes(release.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, release.id] : current.filter(id => id !== release.id))} /></td><td className="px-3 py-4"><p className="truncate text-sm font-semibold text-slate-900">{app?.name ?? '未知应用'}</p><p className="mt-1 text-xs text-slate-400">{PLATFORM_LABELS[app?.platform ?? ''] ?? app?.platform}</p></td><td className="px-3 py-4"><p className="font-mono text-sm font-semibold text-slate-800">{release.version}</p><p className="mt-1 text-xs text-slate-400">{release.package_size ?? '大小未知'}</p></td><td className="px-3 py-4"><p className="line-clamp-2 text-sm leading-6 text-slate-600">{release.changelog || '未提取到更新日志'}</p></td><td className="px-3 py-4 text-sm text-slate-600">{source?.source_name ?? '—'}</td><td className="px-3 py-4"><span className={`rounded-full border px-2.5 py-1 text-xs ${meta.className}`}>{meta.label}</span></td><td className="px-3 py-4 text-xs text-slate-500">{formatTime(release.discovered_at)}</td><td className="px-3 py-4"><button onClick={() => setDetail(release)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-700">查看</button></td></tr> })}
            </tbody></table></div>
          ) : tab === 'apps' ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[850px]"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-5 py-3">应用</th><th className="px-4 py-3">已通过版本</th><th className="px-4 py-3">抓取来源</th><th className="px-4 py-3">最近检查</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{apps.length === 0 ? <tr><td colSpan={5} className="py-20 text-center text-sm text-slate-400">还没有实验应用</td></tr> : apps.map(app => { const appSources = sources.filter(source => source.app_id === app.id); const latestCheck = appSources.map(source => source.last_checked_at).filter(Boolean).sort().at(-1) ?? null; return <tr key={app.id}><td className="px-5 py-4"><p className="text-sm font-semibold text-slate-900">{app.name}</p><p className="mt-1 text-xs text-slate-400">{PLATFORM_LABELS[app.platform]}{app.package_identifier ? ` · ${app.package_identifier}` : ''}</p></td><td className="px-4 py-4 font-mono text-sm text-slate-700">{app.latest_approved_version ?? '—'}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{appSources.map(source => <a key={source.id} href={source.source_url} target="_blank" rel="noreferrer" title={source.last_error ?? source.source_url} className={`rounded px-2 py-1 text-xs ${source.last_status === 'error' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{source.source_name}</a>)}</div></td><td className="px-4 py-4 text-sm text-slate-500">{formatTime(latestCheck)}</td><td className="px-5 py-4 text-right"><button onClick={() => openNewSource(app)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-700">添加来源</button></td></tr> })}</tbody></table></div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[800px]"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-5 py-3">开始时间</th><th className="px-4 py-3">应用</th><th className="px-4 py-3">来源</th><th className="px-4 py-3">结果</th><th className="px-4 py-3">发现版本</th><th className="px-5 py-3">错误</th></tr></thead><tbody className="divide-y divide-slate-100">{runs.length === 0 ? <tr><td colSpan={6} className="py-20 text-center text-sm text-slate-400">还没有运行记录</td></tr> : runs.map(run => <tr key={run.id}><td className="px-5 py-4 text-sm text-slate-500">{formatTime(run.started_at)}</td><td className="px-4 py-4 text-sm font-medium text-slate-800">{appMap.get(run.app_id)?.name ?? '—'}</td><td className="px-4 py-4 text-sm text-slate-600">{sourceMap.get(run.source_id)?.source_name ?? '—'}</td><td className="px-4 py-4 text-sm text-slate-600">{{ running: '运行中', completed: '发现新版本', no_change: '没有变化', failed: '失败' }[run.status] ?? run.status}</td><td className="px-4 py-4 font-mono text-sm text-slate-700">{run.discovered_version ?? '—'}</td><td className="max-w-sm px-5 py-4 text-sm text-red-600"><p className="truncate" title={run.error_message ?? ''}>{run.error_message ?? '—'}</p></td></tr>)}</tbody></table></div>
          )}
        </section>
      </main>

      {appStoreImportOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 px-6 py-4"><div><h2 className="text-lg font-bold text-slate-950">批量补全 App Store 应用</h2><p className="mt-1 text-xs leading-5 text-slate-400">可以直接从 Apple 公开榜单建档，也可以粘贴指定应用。导入时会一并取得当前版本和更新日志。</p></div><button onClick={() => setAppStoreImportOpen(false)} className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100">✕</button></div><div className="space-y-4 px-6 py-5"><label className="block text-sm font-medium text-slate-700">商店地区<select value={appStoreCountry} onChange={event => setAppStoreCountry(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3"><option value="cn">中国大陆</option><option value="my">马来西亚</option><option value="us">美国</option><option value="hk">中国香港</option><option value="tw">中国台湾</option></select></label><div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="text-sm font-semibold text-slate-800">无需填写 Apple ID</p><p className="mt-1 text-xs leading-5 text-slate-500">自动读取所选地区榜单前 100 名，重复应用会跳过，版本资料会更新。</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={saving} onClick={() => importAppStoreApps('top-free')} className="h-10 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? '补全中…' : '补全免费榜 100 个'}</button><button type="button" disabled={saving} onClick={() => importAppStoreApps('top-paid')} className="h-10 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 disabled:opacity-50">{saving ? '补全中…' : '补全付费榜 100 个'}</button></div></div><div className="flex items-center gap-3"><span className="h-px flex-1 bg-slate-200" /><span className="text-xs text-slate-400">或导入指定应用</span><span className="h-px flex-1 bg-slate-200" /></div><label className="block text-sm font-medium text-slate-700">应用链接或 ID<textarea value={appStoreEntries} onChange={event => setAppStoreEntries(event.target.value)} rows={6} placeholder={'https://apps.apple.com/cn/app/.../id123456789\n987654321'} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-3 font-mono text-sm outline-none focus:border-blue-400" /></label><p className="text-xs leading-5 text-slate-400">资料来自 Apple 的公开榜单和 Lookup 接口，不需要登录 Apple 开发者账号。</p></div><div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4"><button onClick={() => setAppStoreImportOpen(false)} className="h-10 rounded-lg border border-slate-200 px-4 text-sm">取消</button><button disabled={saving || !appStoreEntries.trim()} onClick={() => importAppStoreApps()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? '导入中…' : '导入指定应用'}</button></div></div></div>}

      {targetOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><div><h2 className="text-lg font-bold text-slate-950">{sourceApp ? `为 ${sourceApp.name} 添加来源` : '新增实验应用'}</h2><p className="mt-1 text-xs text-slate-400">先填写公开更新页面，GitHub Actions 会尝试自动识别资料。</p></div><button onClick={() => setTargetOpen(false)} className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100">✕</button></div><div className="grid gap-4 px-6 py-5 sm:grid-cols-2">{!sourceApp && <><label className="text-sm font-medium text-slate-700">应用名称<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400" /></label><label className="text-sm font-medium text-slate-700">平台<select value={form.platform} onChange={event => setForm(current => ({ ...current, platform: event.target.value }))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3">{Object.entries(PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">包名或应用标识（可不填）<input value={form.packageIdentifier} onChange={event => setForm(current => ({ ...current, packageIdentifier: event.target.value }))} placeholder="例如 com.example.app" className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400" /></label></>}<label className="text-sm font-medium text-slate-700">来源名称<input value={form.sourceName} onChange={event => setForm(current => ({ ...current, sourceName: event.target.value }))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400" /></label><label className="text-sm font-medium text-slate-700">来源类型<select value={form.sourceType} onChange={event => setForm(current => ({ ...current, sourceType: event.target.value }))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3">{Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">更新页面 URL<input value={form.sourceUrl} onChange={event => setForm(current => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://..." className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400" /></label></div><div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4"><button onClick={() => setTargetOpen(false)} className="h-10 rounded-lg border border-slate-200 px-4 text-sm">取消</button><button disabled={saving} onClick={saveTarget} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : '保存'}</button></div></div></div>}

      {detail && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 px-6 py-4"><div><p className="text-xs text-slate-400">{appMap.get(detail.app_id)?.name}</p><h2 className="mt-1 text-xl font-bold text-slate-950">版本 {detail.version}</h2></div><button onClick={() => setDetail(null)} className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100">✕</button></div><div className="overflow-y-auto px-6 py-5"><div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">发布日期</p><p className="mt-1 text-slate-700">{detail.release_date ?? '未识别'}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">自动识别可信度</p><p className="mt-1 text-slate-700">{detail.extraction_confidence}%</p></div></div><h3 className="mt-5 text-sm font-semibold text-slate-800">更新日志</h3><p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">{detail.changelog || '这个来源没有提取到更新日志。'}</p><div className="mt-4 flex flex-wrap gap-3"><a href={detail.source_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-700">查看来源页面 ↗</a>{detail.download_url && <a href={detail.download_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-700">查看下载链接 ↗</a>}</div></div><div className="flex justify-between border-t border-slate-100 px-6 py-4"><button disabled={saving} onClick={() => reviewRelease(detail.id, 'rejected')} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-500 hover:bg-red-50 hover:text-red-600">忽略</button><button disabled={saving} onClick={() => reviewRelease(detail.id, 'approved')} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">确认这条更新</button></div></div></div>}
    </div>
  )
}
