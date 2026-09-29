'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Editor } from 'grapesjs'
import AppDialog from '@/components/app-dialog'
import {
  PageStudioPage,
  PageStudioProject,
  addPageStudioPage,
  buildPageDocument,
  copyPageDocument,
  downloadPageDocument,
  extractImportedCode,
  getPageStudioProject,
  savePageStudioProject,
} from '@/lib/page-studio'

type AuditItem = { label: string; ok: boolean; detail: string }

function auditPage(page: PageStudioPage): AuditItem[] {
  const documentValue = new DOMParser().parseFromString(page.html, 'text/html')
  const h1 = documentValue.querySelectorAll('h1').length
  const images = Array.from(documentValue.querySelectorAll('img'))
  const emptyLinks = Array.from(documentValue.querySelectorAll('a')).filter(anchor => !anchor.getAttribute('href'))
  return [
    { label: '页面主标题', ok: h1 === 1, detail: h1 === 1 ? '有且只有一个 H1' : `检测到 ${h1} 个 H1，建议保留一个` },
    { label: '主体结构', ok: Boolean(documentValue.querySelector('main')), detail: documentValue.querySelector('main') ? '已使用 main 主体标签' : '建议把主要内容放进 main 标签' },
    { label: '图片说明', ok: images.every(image => Boolean(image.getAttribute('alt')?.trim())), detail: images.length ? `${images.filter(image => Boolean(image.getAttribute('alt')?.trim())).length}/${images.length} 张图片有 alt` : '页面暂无图片' },
    { label: '真实链接', ok: emptyLinks.length === 0, detail: emptyLinks.length ? `${emptyLinks.length} 个链接缺少 href` : '所有链接都可以被识别' },
  ]
}

export default function PageStudioEditor({ projectId }: { projectId: string }) {
  const editorRef = useRef<Editor | null>(null)
  const projectRef = useRef<PageStudioProject | null>(null)
  const [project, setProject] = useState<PageStudioProject | null>(null)
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState(true)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [leftPanel, setLeftPanel] = useState<'blocks' | 'layers'>('blocks')
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [rightPanel, setRightPanel] = useState<'style' | 'traits'>('style')
  const [dialog, setDialog] = useState<'preview' | 'audit' | 'add-page' | 'import-code' | null>(null)
  const [newPageName, setNewPageName] = useState('')
  const [newPageDevice, setNewPageDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [newPageSource, setNewPageSource] = useState<'blank' | 'code'>('blank')
  const [codeHtml, setCodeHtml] = useState('')
  const [codeCss, setCodeCss] = useState('')
  const [codeRemoveImages, setCodeRemoveImages] = useState(true)
  const [previewDocument, setPreviewDocument] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const stored = getPageStudioProject(projectId)
    if (!stored) return
    const initialProject = stored
    projectRef.current = stored
    setProject(stored)

    let disposed = false
    async function initialize() {
      const grapesjs = (await import('grapesjs')).default
      if (disposed || editorRef.current) return
      const page = initialProject.pages.find(item => item.id === initialProject.activePageId) ?? initialProject.pages[0]
      const editor = grapesjs.init({
        container: '#page-studio-canvas',
        height: '100%',
        width: 'auto',
        storageManager: false,
        noticeOnUnload: false,
        fromElement: false,
        components: page.html,
        style: page.css,
        blockManager: { appendTo: '#page-studio-blocks' },
        layerManager: { appendTo: '#page-studio-layers' },
        traitManager: { appendTo: '#page-studio-traits' },
        styleManager: {
          appendTo: '#page-studio-styles',
          sectors: [
            { name: '尺寸与位置', open: true, buildProps: ['display', 'position', 'width', 'height', 'max-width', 'min-height', 'margin', 'padding'] },
            { name: '文字', open: true, buildProps: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align', 'text-decoration'] },
            { name: '外观', open: false, buildProps: ['background-color', 'border', 'border-radius', 'box-shadow', 'opacity'] },
            { name: '布局', open: false, buildProps: ['flex-direction', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'overflow'] },
          ],
        },
        panels: { defaults: [] },
        deviceManager: {
          devices: [
            { id: 'Desktop', name: '电脑页面', width: '1440px' },
            { id: 'Mobile', name: 'M端页面', width: '375px' },
          ],
        },
        canvas: { styles: [], scripts: [] },
      })

      const blocks = editor.BlockManager
      blocks.add('section', { label: '内容区块', category: '基础结构', content: '<section style="padding:48px 6%;"><h2>区块标题</h2><p>在这里输入内容。</p></section>', attributes: { title: '加入内容区块' } })
      blocks.add('two-columns', { label: '双栏布局', category: '基础结构', content: '<section style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:40px 6%;"><div><h2>左栏</h2><p>输入内容</p></div><div><h2>右栏</h2><p>输入内容</p></div></section>' })
      blocks.add('heading', { label: '标题', category: '文字', content: '<h2>请输入标题</h2>' })
      blocks.add('text', { label: '文字', category: '文字', content: '<p>双击修改这段文字。</p>' })
      blocks.add('button', { label: '链接按钮', category: '常用组件', content: '<a href="#" style="display:inline-block;padding:10px 16px;border:1px solid #059669;border-radius:8px;color:#047857;text-decoration:none;font-weight:700;">按钮文字</a>' })
      blocks.add('image', { label: '网址图片', category: '常用组件', activate: true, content: { type: 'image', attributes: { alt: '图片说明' }, style: { 'max-width': '100%', height: 'auto' } } })
      blocks.add('list', { label: '列表模块', category: '常用组件', content: '<section style="padding:32px;border:1px solid #e2e8f0;border-radius:12px;"><h2>列表标题</h2><ul><li>列表内容一</li><li>列表内容二</li><li>列表内容三</li></ul></section>' })
      blocks.add('ad-slot', { label: '广告位', category: '常用组件', content: '<aside aria-label="广告" style="min-height:120px;display:flex;align-items:center;justify-content:center;border:1px dashed #94a3b8;background:#f8fafc;color:#64748b;">广告位 1200 × 120</aside>' })

      if (page.projectData) editor.loadProjectData(page.projectData)
      const initialDevice = page.targetDevice === 'mobile' ? 'Mobile' : 'Desktop'
      editor.setDevice(initialDevice)
      editor.on('update', () => setSaved(false))
      editor.on('component:selected', component => {
        if (component.is('image')) component.set('resizable', true)
      })
      editorRef.current = editor
      setReady(true)
    }
    void initialize()
    return () => {
      disposed = true
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [projectId])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      if (event.shiftKey) editorRef.current?.UndoManager.redo()
      else editorRef.current?.UndoManager.undo()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  function snapshotCurrent(base = projectRef.current) {
    const editor = editorRef.current
    if (!base || !editor) return base
    const activeId = base.activePageId
    return {
      ...base,
      pages: base.pages.map(page => page.id === activeId ? {
        ...page,
        html: editor.getHtml(),
        css: editor.getCss() ?? '',
        projectData: editor.getProjectData() as Record<string, unknown>,
      } : page),
    }
  }

  function persist() {
    const current = snapshotCurrent()
    if (!current) return null
    const next = savePageStudioProject(current)
    projectRef.current = next
    setProject(next)
    setSaved(true)
    return next
  }

  function loadPage(pageId: string) {
    const current = snapshotCurrent()
    const editor = editorRef.current
    if (!current || !editor) return
    const next = { ...current, activePageId: pageId }
    const page = next.pages.find(item => item.id === pageId)
    if (!page) return
    editor.DomComponents.clear()
    editor.CssComposer.clear()
    if (page.projectData) editor.loadProjectData(page.projectData)
    else {
      editor.setComponents(page.html)
      editor.setStyle(page.css)
    }
    projectRef.current = next
    setProject(next)
    const nextDevice = page.targetDevice === 'mobile' ? 'Mobile' : 'Desktop'
    editor.setDevice(nextDevice)
    setSaved(false)
  }

  function addPage() {
    const current = snapshotCurrent()
    const editor = editorRef.current
    if (!current || !editor) return
    if (!newPageName.trim()) return
    let next = addPageStudioPage(current, newPageName, newPageDevice)
    if (newPageSource === 'code') {
      const imported = extractImportedCode(codeHtml, codeCss, { removeImages: codeRemoveImages })
      next = { ...next, pages: next.pages.map(item => item.id === next.activePageId ? { ...item, html: imported.html, css: imported.css } : item) }
    }
    const page = next.pages.find(item => item.id === next.activePageId)
    if (!page) return
    editor.DomComponents.clear()
    editor.CssComposer.clear()
    editor.setComponents(page.html)
    editor.setStyle(page.css)
    projectRef.current = next
    setProject(next)
    setDialog(null)
    setNewPageName('')
    setNewPageDevice('desktop')
    setNewPageSource('blank')
    setCodeHtml('')
    setCodeCss('')
    setCodeRemoveImages(true)
    const nextDevice = page.targetDevice === 'mobile' ? 'Mobile' : 'Desktop'
    editor.setDevice(nextDevice)
    setSaved(false)
  }

  function showPreview() {
    const current = snapshotCurrent()
    if (!current) return
    const page = current.pages.find(item => item.id === current.activePageId) ?? current.pages[0]
    setPreviewDocument(buildPageDocument(current, page))
    setDialog('preview')
  }

  function exportCurrent() {
    const current = persist()
    if (!current) return
    const page = current.pages.find(item => item.id === current.activePageId) ?? current.pages[0]
    downloadPageDocument(current, page)
    const next = savePageStudioProject({ ...current, status: 'exported' })
    projectRef.current = next
    setProject(next)
  }

  async function copyCurrentCode() {
    const current = snapshotCurrent()
    if (!current) return
    const page = current.pages.find(item => item.id === current.activePageId) ?? current.pages[0]
    await copyPageDocument(current, page)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function replaceCurrentWithCode() {
    const current = snapshotCurrent()
    const editor = editorRef.current
    if (!current || !editor || !codeHtml.trim()) return
    const imported = extractImportedCode(codeHtml, codeCss, { removeImages: codeRemoveImages })
    editor.DomComponents.clear()
    editor.CssComposer.clear()
    editor.setComponents(imported.html)
    editor.setStyle(imported.css)
    const next = {
      ...current,
      pages: current.pages.map(page => page.id === current.activePageId ? { ...page, html: imported.html, css: imported.css, projectData: undefined } : page),
    }
    projectRef.current = next
    setProject(next)
    setSaved(false)
    setDialog(null)
    setCodeHtml('')
    setCodeCss('')
    setCodeRemoveImages(true)
  }

  if (!project) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100"><div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-lg font-semibold text-slate-900">找不到这个项目</h1><p className="mt-2 text-sm text-slate-500">它可能已被删除，或保存在另一个浏览器中。</p><Link href="/page-studio" className="btn-primary mt-5">返回项目管理</Link></div></div>
  }

  const activePage = project.pages.find(page => page.id === project.activePageId) ?? project.pages[0]
  const audits = typeof window !== 'undefined' ? auditPage({ ...activePage, html: editorRef.current?.getHtml() ?? activePage.html }) : []

  return (
    <div className="flex h-screen min-w-[1040px] flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3">
        <Link href={`/page-studio/projects/${project.id}`} aria-label="返回项目页面管理" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 5-5 5 5 5" /></svg></Link>
        <div className="min-w-0 max-w-64"><p className="truncate text-sm font-semibold text-slate-950">{project.name}</p><p className={`text-[11px] ${saved ? 'text-slate-400' : 'text-amber-600'}`}>{saved ? '已保存到本机' : '有未保存修改'}</p></div>
        <div className="mx-2 h-6 w-px bg-slate-200" />
        <select aria-label="当前页面" value={project.activePageId} onChange={event => loadPage(event.target.value)} className="h-9 min-w-40 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option disabled>选择页面</option>{project.pages.map(page => <option key={page.id} value={page.id}>{page.name} · {page.path}</option>)}</select>
        <button type="button" onClick={() => setDialog('add-page')} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">+ 页面</button>

        <span className="ml-auto inline-flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700">{activePage.targetDevice === 'mobile' ? 'M端页面 · 375px' : 'PC页面 · 1440px'}</span>
        <button type="button" aria-pressed={leftPanelOpen} onClick={() => setLeftPanelOpen(value => !value)} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50">{leftPanelOpen ? '隐藏模块' : '显示模块'}</button>
        <button type="button" aria-pressed={rightPanelOpen} onClick={() => setRightPanelOpen(value => !value)} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50">{rightPanelOpen ? '隐藏属性' : '显示属性'}</button>
        <button type="button" onClick={() => setDialog('audit')} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">百度检查</button>
        <button type="button" onClick={showPreview} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">预览</button>
        <button type="button" onClick={() => setDialog('import-code')} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">粘贴代码</button>
        <button type="button" onClick={persist} className="inline-flex h-9 items-center rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">保存</button>
        <button type="button" onClick={() => void copyCurrentCode()} className="inline-flex h-9 items-center rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">{copied ? '已复制' : '复制代码'}</button>
        <button type="button" onClick={exportCurrent} className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700">导出当前页</button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={`${leftPanelOpen ? 'w-60' : 'hidden'} shrink-0 overflow-y-auto border-r border-slate-200 bg-white`}>
          <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white p-1.5"><button type="button" onClick={() => setLeftPanel('blocks')} className={`h-8 flex-1 rounded-md text-xs font-medium ${leftPanel === 'blocks' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>添加模块</button><button type="button" onClick={() => setLeftPanel('layers')} className={`h-8 flex-1 rounded-md text-xs font-medium ${leftPanel === 'layers' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>页面结构</button></div>
          <div id="page-studio-blocks" className={`page-studio-panel ${leftPanel === 'blocks' ? '' : 'hidden'}`} />
          <div id="page-studio-layers" className={`page-studio-panel ${leftPanel === 'layers' ? '' : 'hidden'}`} />
        </aside>

        <main className="relative min-w-0 flex-1 bg-slate-200 p-4">
          {!ready && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100 text-sm text-slate-500">正在准备编辑画布…</div>}
          <div id="page-studio-canvas" className="h-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm" />
        </main>

        <aside className={`${rightPanelOpen ? 'w-72' : 'hidden'} shrink-0 overflow-y-auto border-l border-slate-200 bg-white`}>
          <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white p-1.5"><button type="button" onClick={() => setRightPanel('style')} className={`h-8 flex-1 rounded-md text-xs font-medium ${rightPanel === 'style' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>样式</button><button type="button" onClick={() => setRightPanel('traits')} className={`h-8 flex-1 rounded-md text-xs font-medium ${rightPanel === 'traits' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>内容属性</button></div>
          <div id="page-studio-styles" className={`page-studio-panel ${rightPanel === 'style' ? '' : 'hidden'}`} />
          <div id="page-studio-traits" className={`page-studio-panel ${rightPanel === 'traits' ? '' : 'hidden'}`} />
        </aside>
      </div>

      {dialog === 'preview' && <AppDialog title={`${activePage.name} · 页面预览`} description="链接可点击；外部网址会在预览框中打开。" onClose={() => setDialog(null)} width="max-w-6xl" bodyClassName="min-h-0 flex-1 bg-slate-200 p-3"><iframe title="页面预览" srcDoc={previewDocument} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-[72vh] w-full rounded-lg border border-slate-300 bg-white" /></AppDialog>}
      {dialog === 'audit' && <AppDialog title="百度基础检查" description="这是导出前的结构提醒，不代表搜索排名保证。" onClose={() => setDialog(null)} width="max-w-xl"><div className="space-y-3">{audits.map(item => <div key={item.label} className={`rounded-lg border p-4 ${item.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center justify-between"><strong className="text-sm text-slate-900">{item.label}</strong><span className={`text-xs font-semibold ${item.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{item.ok ? '通过' : '需检查'}</span></div><p className="mt-1 text-sm text-slate-600">{item.detail}</p></div>)}</div></AppDialog>}
      {dialog === 'add-page' && <AppDialog title="增加页面" description="可以从空白开始，也可以直接粘贴这个页面的 HTML 与 CSS。" onClose={() => setDialog(null)} width={newPageSource === 'code' ? 'max-w-5xl' : 'max-w-md'} footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" disabled={!newPageName.trim() || (newPageSource === 'code' && !codeHtml.trim())} onClick={addPage} className="btn-primary">增加页面</button></div>}><label className="block text-sm font-medium text-slate-700">页面名称<input autoFocus value={newPageName} onChange={event => setNewPageName(event.target.value)} placeholder="例如：关于我们" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500" /></label><fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">建立方式</legend><div className="mt-2 grid grid-cols-2 gap-3">{([['blank', '空白页面'], ['code', '粘贴页面代码']] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-lg border px-4 py-3 text-sm font-semibold ${newPageSource === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}><input type="radio" name="new-page-source" value={value} checked={newPageSource === value} onChange={() => setNewPageSource(value)} className="sr-only" />{label}</label>)}</div></fieldset><fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">主要设计尺寸</legend><div className="mt-2 grid grid-cols-2 gap-3">{([['desktop', '电脑端'], ['mobile', '手机端']] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-lg border px-4 py-3 text-sm font-semibold ${newPageDevice === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}><input type="radio" name="new-page-device" value={value} checked={newPageDevice === value} onChange={() => setNewPageDevice(value)} className="sr-only" />{label}</label>)}</div></fieldset>{newPageSource === 'code' && <CodeImportFields html={codeHtml} css={codeCss} removeImages={codeRemoveImages} onHtml={setCodeHtml} onCss={setCodeCss} onRemoveImages={setCodeRemoveImages} />}</AppDialog>}
      {dialog === 'import-code' && <AppDialog title={`粘贴代码到“${activePage.name}”`} description="确认后会替换当前页面的画布内容；尚未保存的当前内容会被覆盖。" onClose={() => setDialog(null)} width="max-w-5xl" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" disabled={!codeHtml.trim()} onClick={replaceCurrentWithCode} className="btn-primary">替换当前页面</button></div>}><CodeImportFields html={codeHtml} css={codeCss} removeImages={codeRemoveImages} onHtml={setCodeHtml} onCss={setCodeCss} onRemoveImages={setCodeRemoveImages} /></AppDialog>}
    </div>
  )
}

function CodeImportFields({ html, css, removeImages, onHtml, onCss, onRemoveImages }: { html: string; css: string; removeImages: boolean; onHtml: (value: string) => void; onCss: (value: string) => void; onRemoveImages: (value: boolean) => void }) {
  return <><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"><input type="checkbox" checked={removeImages} onChange={event => onRemoveImages(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600" /><span><span className="block text-sm font-semibold text-slate-900">替换原页面图片</span><span className="mt-0.5 block text-xs text-slate-600">保留图片标签、class 与尺寸，只替换图片内容。</span></span></label><div className="mt-5 grid gap-4 lg:grid-cols-2"><label className="block text-sm font-medium text-slate-700">HTML<textarea value={html} onChange={event => onHtml(event.target.value)} placeholder="粘贴完整页面 HTML" className="mt-2 h-64 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500" /></label><label className="block text-sm font-medium text-slate-700">CSS（可选）<textarea value={css} onChange={event => onCss(event.target.value)} placeholder="依次粘贴页面使用的 CSS" className="mt-2 h-64 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500" /></label></div></>
}
