'use client'

import { useMemo, useState } from 'react'

interface ImportSite {
  id: string
  domain: string
  name: string
}

interface ImportSummary {
  sheetCount: number
  ignoredSheetCount: number
  totalRows: number
  acceptedRows: number
  uniqueRankRows: number
  uniqueKeywords: number
  rankupRows: number
  rankdownRows: number
  excludedSubdomain: number
  excludedNonPositiveVolume: number
  invalidRows: number
  duplicateRows: number
}

interface PreviewResult {
  site: { id: string; domain: string }
  platform: 'mobile' | 'pc'
  statDate: string
  syncKeywordVolume: boolean
  summary: ImportSummary
}

interface ImportResult extends PreviewResult {
  success: true
  importedRankRows: number
  importedKeywordVolumeRows: number
}

interface RefreshResult {
  success: true
  tracking: { refreshed: boolean; skippedReason?: string }
}

function malaysiaToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export default function RankDataImportModal({ sites, onClose }: { sites: ImportSite[]; onClose: () => void }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [platform, setPlatform] = useState<'mobile' | 'pc'>('mobile')
  const [statDate, setStatDate] = useState(malaysiaToday())
  const [file, setFile] = useState<File | null>(null)
  const [syncKeywordVolume, setSyncKeywordVolume] = useState(true)
  const [refreshEffectiveness, setRefreshEffectiveness] = useState(true)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'import' | 'refresh' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedSite = useMemo(() => sites.find(site => site.id === siteId), [siteId, sites])

  function resetPreview() {
    setPreview(null)
    setResult(null)
    setRefreshResult(null)
    setError(null)
  }

  function buildForm(action: 'preview' | 'import') {
    if (!file) throw new Error('请选择 Excel 文件')
    const form = new FormData()
    form.set('action', action)
    form.set('siteId', siteId)
    form.set('platform', platform)
    form.set('statDate', statDate)
    form.set('syncKeywordVolume', String(syncKeywordVolume && platform === 'mobile'))
    form.set('file', file)
    return form
  }

  async function previewFile() {
    setBusy('preview'); setError(null); setResult(null); setRefreshResult(null)
    try {
      const response = await fetch('/api/sites/rank-import', { method: 'POST', body: buildForm('preview') })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '预览失败')
      setPreview(data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '预览失败')
    } finally {
      setBusy(null)
    }
  }

  async function refreshImportedEffectiveness() {
    setBusy('refresh')
    setError(null)
    try {
      const refreshResponse = await fetch('/api/sites/rank-import/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, statDate }),
      })
      const refreshData = await refreshResponse.json()
      if (!refreshResponse.ok || !refreshData.success) {
        throw new Error(`数据已导入，但成效刷新失败：${refreshData.error || '未知错误'}`)
      }
      setRefreshResult(refreshData)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '数据已导入，但成效刷新失败')
    } finally {
      setBusy(null)
    }
  }

  async function importFile() {
    setBusy('import'); setError(null); setRefreshResult(null)
    try {
      const response = await fetch('/api/sites/rank-import', { method: 'POST', body: buildForm('import') })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '导入失败')
      setResult(data)
      if (refreshEffectiveness) {
        await refreshImportedEffectiveness()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="rank-import-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-5">
          <div>
            <h2 id="rank-import-title" className="text-lg font-semibold text-gray-900">补录爱站排名 Excel</h2>
            <p className="mt-1 text-sm text-gray-500">先预览过滤结果，确认后才写入排名与搜索量资料。</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy !== null} aria-label="关闭" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40">×</button>
        </div>

        <div className="space-y-5 p-6">
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              已导入 {result.importedRankRows.toLocaleString()} 条排名资料
              {result.importedKeywordVolumeRows > 0 && `，同步 ${result.importedKeywordVolumeRows.toLocaleString()} 个搜索量关键词`}
              {refreshResult?.tracking.refreshed && '；当天竞品/组员成效已重算，成效缓存已重建'}
              {refreshResult && !refreshResult.tracking.refreshed && '；历史排名已保留，成效缓存已重建（未改写今天的竞品快照）'}。
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              站点
              <select value={siteId} onChange={event => { setSiteId(event.target.value); resetPreview() }} className="mt-1.5 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm focus:border-emerald-500 focus:outline-none">
                {sites.map(site => <option key={site.id} value={site.id}>{site.name || site.domain} · {site.domain}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">
              数据日期
              <input type="date" value={statDate} onChange={event => { setStatDate(event.target.value); resetPreview() }} className="mt-1.5 min-h-11 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-emerald-500 focus:outline-none" />
            </label>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-gray-700">排名端</legend>
            <div className="mt-2 flex gap-3">
              {([['mobile', 'M 端'], ['pc', 'PC 端']] as const).map(([value, label]) => (
                <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm ${platform === value ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'}`}>
                  <input type="radio" name="platform" value={value} checked={platform === value} onChange={() => { setPlatform(value); if (value === 'pc') setSyncKeywordVolume(false); resetPreview() }} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-medium text-gray-700">
            Excel 文件
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { setFile(event.target.files?.[0] ?? null); resetPreview() }} className="mt-1.5 block min-h-11 w-full rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-white" />
          </label>

          <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <label className={`flex items-start gap-3 text-sm ${platform === 'pc' ? 'text-gray-400' : 'text-gray-700'}`}>
              <input type="checkbox" checked={syncKeywordVolume} disabled={platform === 'pc'} onChange={event => { setSyncKeywordVolume(event.target.checked); resetPreview() }} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600" />
              <span><b>同步到搜索量查询</b><span className="mt-0.5 block text-xs font-normal text-gray-500">写入 keyword_volume，并保留旧 volume 与变化量；只接受 M 端。</span></span>
            </label>
            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={refreshEffectiveness} onChange={event => setRefreshEffectiveness(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600" />
              <span><b>导入后重算成效</b><span className="mt-0.5 block text-xs font-normal text-gray-500">今天的数据会更新竞品成效/组员追踪，再重建成效报告缓存；历史日期只重建缓存。</span></span>
            </label>
          </div>

          {preview && (
            <div className="rounded-xl border border-emerald-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">预览结果 · {selectedSite?.domain}</p>
                  <p className="mt-0.5 text-xs text-gray-500">只保留主域 URL 和明确大于 0 的 zs；子域名及 &lt;10 会排除。</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">可导入 {preview.summary.uniqueRankRows.toLocaleString()} 条</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['上涨', preview.summary.rankupRows], ['下跌', preview.summary.rankdownRows],
                  ['搜索量词', preview.summary.uniqueKeywords], ['重复合并', preview.summary.duplicateRows],
                ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-gray-50 px-3 py-2"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{Number(value).toLocaleString()}</p></div>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                <span>排除子域名 {preview.summary.excludedSubdomain.toLocaleString()}</span>
                <span>排除非正搜索量 {preview.summary.excludedNonPositiveVolume.toLocaleString()}</span>
                <span>无效资料 {preview.summary.invalidRows.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button type="button" onClick={onClose} disabled={busy !== null} className="btn-secondary min-h-11 px-4 disabled:opacity-40">关闭</button>
          <button type="button" onClick={previewFile} disabled={!file || !siteId || busy !== null} className="btn-secondary min-h-11 px-4 disabled:opacity-40">{busy === 'preview' ? '解析中…' : '预览过滤结果'}</button>
          {result && refreshEffectiveness && !refreshResult && (
            <button type="button" onClick={refreshImportedEffectiveness} disabled={busy !== null} className="btn-secondary min-h-11 px-4 disabled:opacity-40">
              {busy === 'refresh' ? '正在重算成效…' : '重试成效刷新'}
            </button>
          )}
          <button type="button" onClick={importFile} disabled={!preview || busy !== null || result !== null} className="btn-primary min-h-11 px-5 disabled:opacity-40">{busy === 'import' ? '导入中…' : busy === 'refresh' ? '正在重算成效…' : '确认导入'}</button>
        </div>
      </div>
    </div>
  )
}
