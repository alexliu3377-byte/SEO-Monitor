'use client'

import { useState, useEffect } from 'react'

interface Site {
  id?: string
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
}

interface HtmlSource {
  url: string
  titleSelector: string
  dateSelector: string
  contentType: 'game' | 'app'
  urlSelector: string
}

interface PreviewRow {
  original: string
  cleaned: string
}

interface AddSiteModalProps {
  site?: Site | null
  onClose: () => void
  onSaved: () => void
}

interface AiSelectorSuggestion {
  title_selector: string
  date_selector: string
  url_selector: string
  confidence: number | null
  notes: string
}

// 粘贴一段列表页HTML，让 Gemini 分析出 标题/日期/文章链接 三个CSS选择器——
// 手动摸 CSS 选择器经常要来回试，容易配错，2026-07-29 加入。每个"来源"块独立
// 一份，本地状态自己管理，通过 onApply 把结果写回父组件的表单字段。
function AiSelectorHelper({ onApply }: { onApply: (sug: { title_selector: string; date_selector: string; url_selector: string }) => void }) {
  const [open, setOpen] = useState(false)
  const [htmlInput, setHtmlInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiSelectorSuggestion | null>(null)

  async function analyze() {
    if (!htmlInput.trim() || analyzing) return
    setAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/sites/analyze-selector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlInput }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'AI 分析失败')
      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'AI 分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="border border-dashed border-indigo-200 rounded-lg p-3 bg-indigo-50/30">
      <button type="button" onClick={() => setOpen(!open)}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
        <span>{open ? '▾' : '▸'}</span> AI 帮我识别选择器
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea
            value={htmlInput}
            onChange={(e) => setHtmlInput(e.target.value)}
            placeholder="粘贴一条或几条列表项的HTML代码（右键“检查”复制出来）；如果这个站是翻页JSON接口，也可以直接粘贴整段JSON响应"
            rows={5}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white resize-none"
          />
          <button type="button" onClick={analyze} disabled={analyzing || !htmlInput.trim()}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {analyzing ? '分析中...' : 'AI 分析'}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {result && (
            <div className="border border-indigo-200 rounded-lg bg-white p-3 space-y-1.5">
              <div className="text-xs text-gray-600"><span className="font-medium text-gray-500">标题选择器：</span><code className="text-indigo-700">{result.title_selector || '（空）'}</code></div>
              <div className="text-xs text-gray-600"><span className="font-medium text-gray-500">日期选择器：</span><code className="text-indigo-700">{result.date_selector || '（空）'}</code></div>
              <div className="text-xs text-gray-600"><span className="font-medium text-gray-500">链接选择器：</span><code className="text-indigo-700">{result.url_selector || '（空）'}</code></div>
              {result.notes && <p className="text-xs text-gray-400 italic">{result.notes}</p>}
              <button type="button"
                onClick={() => { onApply(result); setOpen(false); setResult(null); setHtmlInput('') }}
                className="mt-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition-colors">
                应用到上面的选择器
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const defaultForm: Site = {
  domain: '',
  name: '',
  category: 'medium',
  crawl_type: 'html',
  focus_level: 3,
  list_url: '',
  title_selector: '',
  date_selector: '',
  source_types: '',
  url_selectors: '',
  capture_source_url: false,
  crawl_frequency: 'daily',
  enable_version_clean: false,
  version_suffixes: [],
  friend_links: [],
  is_enabled: true,
}

const SRC_SEP = '|||'

function splitSources(str: string | null | undefined): string[] {
  if (!str) return []
  return str.includes(SRC_SEP) ? str.split(SRC_SEP) : str.split('\n').map(s => s.trim()).filter(Boolean).map(s => s)
}

function sitToSources(s: Site | null): HtmlSource[] {
  if (!s) return [{ url: '', titleSelector: '', dateSelector: '', contentType: 'app', urlSelector: '' }]
  // New format: ||| separates sources; old format: \n separates sources (each has 1 URL)
  const isNew = (s.list_url || '').includes(SRC_SEP)
  if (isNew) {
    const urlBlocks = (s.list_url || '').split(SRC_SEP)
    const titles = (s.title_selector || '').split(SRC_SEP)
    const dates = (s.date_selector || '').split(SRC_SEP)
    const types = (s.source_types || '').split(SRC_SEP)
    const urlSels = (s.url_selectors || '').split(SRC_SEP)
    if (urlBlocks.length === 0) return [{ url: '', titleSelector: '', dateSelector: '', contentType: 'app', urlSelector: '' }]
    return urlBlocks.map((urlBlock, i) => ({
      url: urlBlock.trim(),
      titleSelector: (titles[i] ?? titles[0] ?? '').trim(),
      dateSelector: (dates[i] ?? dates[0] ?? '').trim(),
      contentType: ((types[i] ?? '').trim() === 'game' ? 'game' : 'app') as 'game' | 'app',
      urlSelector: (urlSels[i] ?? '').trim(),
    }))
  }
  // Old format: each \n is a separate source with one URL
  const urls = (s.list_url || '').split('\n').map((u) => u.trim()).filter(Boolean)
  const titles = (s.title_selector || '').split('\n').map((t) => t.trim())
  const dates = (s.date_selector || '').split('\n').map((d) => d.trim())
  const types = (s.source_types || '').split('\n').map((t) => t.trim())
  if (urls.length === 0) return [{ url: '', titleSelector: '', dateSelector: '', contentType: 'app', urlSelector: '' }]
  return urls.map((url, i) => ({
    url,
    titleSelector: titles[i] ?? titles[0] ?? '',
    dateSelector: dates[i] ?? dates[0] ?? '',
    contentType: (types[i] === 'game' ? 'game' : 'app') as 'game' | 'app',
    urlSelector: '',
  }))
}

export default function AddSiteModal({ site, onClose, onSaved }: AddSiteModalProps) {
  const [form, setForm] = useState<Site>(site ? { ...site } : { ...defaultForm })
  const [htmlSources, setHtmlSources] = useState<HtmlSource[]>(() => sitToSources(site ?? null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newFriendLink, setNewFriendLink] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewRow[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    setForm(site ? { ...site, friend_links: site.friend_links || [] } : { ...defaultForm })
    setHtmlSources(sitToSources(site ?? null))
    setPreviewData(null)
    setPreviewError(null)
  }, [site])

  function updateSource(idx: number, field: keyof HtmlSource, value: string) {
    const next = htmlSources.map((s, i) => i === idx ? { ...s, [field]: value } : s)
    setHtmlSources(next)
    const valid = next.filter((s) => s.url.trim())
    setForm((prev) => ({
      ...prev,
      list_url: valid.map((s) => s.url).join(SRC_SEP),
      title_selector: valid.map((s) => s.titleSelector).join(SRC_SEP),
      date_selector: valid.map((s) => s.dateSelector).join(SRC_SEP),
      source_types: valid.map((s) => s.contentType).join(SRC_SEP),
      url_selectors: valid.map((s) => s.urlSelector).join(SRC_SEP),
    }))
  }

  function applyAiSuggestion(idx: number, sug: { title_selector: string; date_selector: string; url_selector: string }) {
    const next = htmlSources.map((s, i) => i === idx
      ? { ...s, titleSelector: sug.title_selector, dateSelector: sug.date_selector, urlSelector: sug.url_selector }
      : s)
    setHtmlSources(next)
    const valid = next.filter((s) => s.url.trim())
    setForm((prev) => ({
      ...prev,
      list_url: valid.map((s) => s.url).join(SRC_SEP),
      title_selector: valid.map((s) => s.titleSelector).join(SRC_SEP),
      date_selector: valid.map((s) => s.dateSelector).join(SRC_SEP),
      source_types: valid.map((s) => s.contentType).join(SRC_SEP),
      url_selectors: valid.map((s) => s.urlSelector).join(SRC_SEP),
    }))
  }

  function addSource() {
    setHtmlSources([...htmlSources, { url: '', titleSelector: '', dateSelector: '', contentType: 'app', urlSelector: '' }])
  }

  function removeSource(idx: number) {
    const next = htmlSources.filter((_, i) => i !== idx)
    setHtmlSources(next)
    const valid = next.filter((s) => s.url.trim())
    setForm((prev) => ({
      ...prev,
      list_url: valid.map((s) => s.url).join(SRC_SEP),
      title_selector: valid.map((s) => s.titleSelector).join(SRC_SEP),
      date_selector: valid.map((s) => s.dateSelector).join(SRC_SEP),
      source_types: valid.map((s) => s.contentType).join(SRC_SEP),
      url_selectors: valid.map((s) => s.urlSelector).join(SRC_SEP),
    }))
  }

  function update<K extends keyof Site>(key: K, value: Site[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function addFriendLink() {
    const s = newFriendLink.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
    if (!s || form.friend_links.includes(s)) return
    update('friend_links', [...(form.friend_links || []), s])
    setNewFriendLink('')
  }

  function removeFriendLink(s: string) {
    update('friend_links', (form.friend_links || []).filter((x) => x !== s))
  }

  async function handlePreview() {
    setPreviewing(true)
    setPreviewData(null)
    setPreviewError(null)
    try {
      const src = htmlSources[0]
      const previewUrl = src.url.split('\n').map((u: string) => u.trim()).filter(Boolean)[0] || src.url
      const res = await fetch('/api/crawl/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: previewUrl,
          type: 'html',
          titleSelector: src.titleSelector,
          dateSelector: src.dateSelector,
          enableVersionClean: form.enable_version_clean,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '预览失败')
      setPreviewData(data.items)
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : '预览失败')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const method = form.id ? 'PUT' : 'POST'
      const res = await fetch('/api/sites', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {form.id ? '编辑网站' : '新增网站'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Domain */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">域名</label>
              <input
                type="text"
                value={form.domain}
                onChange={(e) => update('domain', e.target.value)}
                placeholder="example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">站点名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="站点显示名称"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Category & Focus */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
              <select
                value={form.category}
                onChange={(e) => update('category', e.target.value as Site['category'])}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="large">大站</option>
                <option value="medium">中站</option>
                <option value="small">小站</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">关注</label>
              <select
                value={form.focus_level}
                onChange={(e) => update('focus_level', Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value={1}>重点关注</option>
                <option value={2}>侧重关注</option>
                <option value={3}>普通关注</option>
              </select>
            </div>
          </div>

          {/* Friend Links */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">友情链接 <span className="text-gray-400 font-normal">（同公司站点）</span></label>
            <div className="flex flex-wrap gap-2 mb-2">
              {(form.friend_links || []).map((link) => (
                <span key={link} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                  {link}
                  <button onClick={() => removeFriendLink(link)} className="text-blue-300 hover:text-red-500 ml-0.5">×</button>
                </span>
              ))}
              {(form.friend_links || []).length === 0 && (
                <span className="text-xs text-gray-400">未设置</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newFriendLink}
                onChange={(e) => setNewFriendLink(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFriendLink()}
                placeholder="输入域名，如：example.com"
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button type="button" onClick={addFriendLink} className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors">
                添加
              </button>
            </div>
          </div>

          {/* HTML sources */}
          <div className="space-y-3">
            {htmlSources.map((src, idx) => (
                <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">来源 {idx + 1}</span>
                    <div className="flex items-center gap-2">
                      <div className="flex rounded-md overflow-hidden border border-gray-200 text-xs">
                        <button
                          type="button"
                          onClick={() => updateSource(idx, 'contentType', 'app')}
                          className={`px-2.5 py-1 font-medium transition-colors ${src.contentType === 'app' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                        >应用</button>
                        <button
                          type="button"
                          onClick={() => updateSource(idx, 'contentType', 'game')}
                          className={`px-2.5 py-1 font-medium transition-colors ${src.contentType === 'game' ? 'bg-purple-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                        >游戏</button>
                      </div>
                      {idx > 0 && (
                        <button type="button" onClick={() => removeSource(idx)} className="text-xs text-red-400 hover:text-red-600">
                          移除
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">列表页URL（多页用换行分隔）</label>
                    <textarea
                      value={src.url}
                      onChange={(e) => updateSource(idx, 'url', e.target.value)}
                      placeholder={"https://example.com/new/\nhttps://example.com/new-2/"}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">标题CSS选择器</label>
                      <input
                        type="text"
                        value={src.titleSelector}
                        onChange={(e) => updateSource(idx, 'titleSelector', e.target.value)}
                        placeholder=".article-title a"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">日期CSS选择器</label>
                      <input
                        type="text"
                        value={src.dateSelector}
                        onChange={(e) => updateSource(idx, 'dateSelector', e.target.value)}
                        placeholder="td:last-child"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">文章链接CSS选择器 <span className="text-gray-400 font-normal">（填写才抓取文章URL；留空不记录）</span></label>
                    <input
                      type="text"
                      value={src.urlSelector}
                      onChange={(e) => updateSource(idx, 'urlSelector', e.target.value)}
                      placeholder=".item a"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    />
                  </div>
                  <AiSelectorHelper onApply={(sug) => applyAiSuggestion(idx, sug)} />
                </div>
              ))}
              <button
                type="button"
                onClick={addSource}
                className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-400 hover:border-green-400 hover:text-green-600 transition-colors"
              >
                + 添加来源（不同页面布局）
              </button>
            </div>

          {/* Version Clean */}
          <div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <div
                onClick={() => update('enable_version_clean', !form.enable_version_clean)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  form.enable_version_clean ? 'bg-green-600' : 'bg-gray-300'
                }`}
              >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  form.enable_version_clean ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </div>
              <span className="text-sm font-medium text-gray-700">启用版本号清洗</span>
            </label>

          </div>

          {/* Preview Button */}
          <div>
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing || !form.list_url}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              {previewing ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  预览中...
                </span>
              ) : '预览抓取'}
            </button>

            {previewError && (
              <p className="mt-2 text-xs text-red-600">{previewError}</p>
            )}

            {previewData && previewData.length > 0 && (
              <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 border-b border-gray-200">
                  抓取预览（前{previewData.length}条）
                </div>
                <div className="divide-y divide-gray-100">
                  {previewData.map((row, i) => (
                    <div key={i} className="px-3 py-2">
                      <p className="text-xs text-gray-500">原始：{row.original}</p>
                      {row.original !== row.cleaned && (
                        <p className="text-xs text-green-700 mt-0.5">清洗：{row.cleaned}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-3 ml-auto">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
