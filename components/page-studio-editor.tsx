'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Component, Editor } from 'grapesjs'
import AppDialog from '@/components/app-dialog'
import PageStudioDevtools from '@/components/page-studio-devtools'
import PageStudioModuleLibrary from '@/components/page-studio-module-library'
import PageStudioQuickStyle from '@/components/page-studio-quick-style'
import {
  PageStudioFavoriteModule,
  PageStudioPage,
  PageStudioProject,
  PageStudioProjectVersion,
  addPageStudioPage,
  buildPageChangeReport,
  buildPageDocument,
  buildPagePrototypeDocument,
  copyPageDocument,
  createPageStudioFavoriteModule,
  deletePageStudioFavoriteModule,
  downloadPageDocument,
  diffPageCode,
  extractImportedCode,
  getPageStudioProject,
  loadPageStudioFavoriteModules,
  loadPageStudioProjectVersions,
  savePageStudioProject,
  updatePageStudioFavoriteModule,
} from '@/lib/page-studio'

type AuditItem = { label: string; ok: boolean; detail: string }

const FAVORITE_BLOCK_PREFIX = 'favorite-module:'
const STUDIO_ANIMATION_CSS = `
@keyframes studio-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes studio-fade-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
@keyframes studio-scale-in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
[data-studio-animation="fade-in"] { animation: studio-fade-in var(--studio-animation-duration, 600ms) ease both; animation-delay: var(--studio-animation-delay, 0ms); }
[data-studio-animation="fade-up"] { animation: studio-fade-up var(--studio-animation-duration, 600ms) ease both; animation-delay: var(--studio-animation-delay, 0ms); }
[data-studio-animation="scale-in"] { animation: studio-scale-in var(--studio-animation-duration, 600ms) ease both; animation-delay: var(--studio-animation-delay, 0ms); }
@media (prefers-reduced-motion: reduce) { [data-studio-animation] { animation: none !important; } }
`

const STUDIO_IMAGE_PLACEHOLDER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#f1f5f9"/><rect x="1" y="1" width="318" height="178" rx="12" fill="none" stroke="#94a3b8" stroke-dasharray="8 6"/><path d="m80 135 58-61 37 39 25-27 45 49H80z" fill="#cbd5e1"/><circle cx="220" cy="55" r="14" fill="#cbd5e1"/></svg>')}`

const ICON_PATHS = {
  section: '<path d="M4 5h16v14H4zM4 9h16"/>',
  row: '<path d="M4 5h7v14H4zM13 5h7v14h-7z"/>',
  columns: '<path d="M3 5h5v14H3zM10 5h5v14h-5zM17 5h4v14h-4z"/>',
  heading: '<path d="M5 5v14M19 5v14M5 12h14"/>',
  text: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  button: '<rect x="3" y="7" width="18" height="10" rx="3"/><path d="M8 12h8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m5 17 5-5 3 3 2-2 4 4M16.5 8h.01"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  home: '<path d="m3 11 9-8 9 8v10h-6v-6H9v6H3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  refresh: '<path d="M20 6v6h-6M4 18v-6h6M18.5 9A7 7 0 0 0 6 7M5.5 15A7 7 0 0 0 18 17"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
} as const

function iconSvg(path: string, size = 24) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
}

function blockLabel(path: string, label: string) {
  return `<span class="studio-block-label">${iconSvg(path, 22)}<span>${label}</span></span>`
}

function iconBlock(path: string, label: string) {
  return `<span role="img" aria-label="${label}" style="display:inline-flex;width:40px;height:40px;align-items:center;justify-content:center;color:#0f766e;">${iconSvg(path, 28)}</span>`
}

function registerFavoriteBlock(editor: Editor, module: PageStudioFavoriteModule) {
  editor.BlockManager.add(`${FAVORITE_BLOCK_PREFIX}${module.id}`, {
    label: module.name,
    category: { id: 'favorite-modules', label: '我的收藏', open: true },
    content: module.html,
    attributes: { title: `${module.category} · 拖到画布中使用` },
  })
}

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
  const favoriteModulesRef = useRef<PageStudioFavoriteModule[]>([])
  const persistRef = useRef<(createVersion?: boolean, label?: string) => Promise<PageStudioProject | null>>(async () => null)
  const pendingInteractionRef = useRef<{ trigger: Component; mode: 'hover-show' | 'click-toggle' } | null>(null)
  const componentClipboardRef = useRef<Component | null>(null)
  const shortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined)
  const [project, setProject] = useState<PageStudioProject | null>(null)
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState(true)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [leftPanel, setLeftPanel] = useState<'blocks' | 'layers'>('blocks')
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [rightPanel, setRightPanel] = useState<'quick' | 'style' | 'devtools' | 'traits'>('quick')
  const [advancedMode, setAdvancedMode] = useState(false)
  const [dialog, setDialog] = useState<'preview' | 'audit' | 'add-page' | 'import-code' | 'changes' | 'save-module' | 'module-library' | 'module-versions' | 'import-module' | 'animation' | 'interaction' | 'versions' | null>(null)
  const [newPageName, setNewPageName] = useState('')
  const [newPageDevice, setNewPageDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [newPageSource, setNewPageSource] = useState<'blank' | 'code'>('blank')
  const [codeHtml, setCodeHtml] = useState('')
  const [codeCss, setCodeCss] = useState('')
  const [codeRemoveImages, setCodeRemoveImages] = useState(true)
  const [previewDocument, setPreviewDocument] = useState('')
  const [copied, setCopied] = useState(false)
  const [reportCopied, setReportCopied] = useState(false)
  const [selectedComponentName, setSelectedComponentName] = useState<string | null>(null)
  const [favoriteModules, setFavoriteModules] = useState<PageStudioFavoriteModule[]>([])
  const [favoriteName, setFavoriteName] = useState('')
  const [favoriteCategory, setFavoriteCategory] = useState('通用')
  const [storageError, setStorageError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [moduleHtml, setModuleHtml] = useState('')
  const [moduleCss, setModuleCss] = useState('')
  const [moduleSourceName, setModuleSourceName] = useState('')
  const [moduleSourceUrl, setModuleSourceUrl] = useState('')
  const [animationPreset, setAnimationPreset] = useState<'none' | 'fade-in' | 'fade-up' | 'scale-in'>('none')
  const [animationDuration, setAnimationDuration] = useState(600)
  const [animationDelay, setAnimationDelay] = useState(0)
  const [versions, setVersions] = useState<PageStudioProjectVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [selectedFavorite, setSelectedFavorite] = useState<PageStudioFavoriteModule | null>(null)
  const [interactionMode, setInteractionMode] = useState<'hover-show' | 'click-toggle'>('hover-show')
  const [interactionPicking, setInteractionPicking] = useState(false)
  const [showInteractionLayers, setShowInteractionLayers] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [hasCopiedComponent, setHasCopiedComponent] = useState(false)

  useEffect(() => {
    let disposed = false
    async function initialize() {
      const stored = await getPageStudioProject(projectId)
      if (disposed) return
      if (!stored) {
        setReady(true)
        return
      }
      const initialProject = stored
      projectRef.current = stored
      setProject(stored)
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
            { name: '布局', open: true, buildProps: ['flex-direction', 'flex-wrap', 'flex-grow', 'flex-basis', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'overflow'] },
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
      const storedFavoriteModules = await loadPageStudioFavoriteModules()
      favoriteModulesRef.current = storedFavoriteModules
      setFavoriteModules(storedFavoriteModules)
      storedFavoriteModules.forEach(module => registerFavoriteBlock(editor, module))
      blocks.add('section', { label: blockLabel(ICON_PATHS.section, '内容区块'), category: '基础结构', content: '<section style="padding:48px 6%;"><h2>区块标题</h2><p>在这里输入内容。</p></section>', attributes: { title: '加入内容区块' } })
      blocks.add('horizontal-row', {
        label: blockLabel(ICON_PATHS.row, '横向排列'),
        category: '基础结构',
        attributes: { title: '先放入横向区，再把多个模块拖进去左右排列' },
        content: {
          tagName: 'section',
          attributes: { 'data-studio-layout': 'horizontal' },
          style: { display: 'flex', 'flex-wrap': 'wrap', gap: '16px', 'min-height': '96px', padding: '12px' },
          droppable: true,
        },
      })
      blocks.add('two-columns', { label: blockLabel(ICON_PATHS.row, '双栏布局'), category: '基础结构', content: '<section style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:40px 6%;"><div><h2>左栏</h2><p>输入内容</p></div><div><h2>右栏</h2><p>输入内容</p></div></section>' })
      blocks.add('two-drop-columns', {
        label: blockLabel(ICON_PATHS.row, '两个自由栏'),
        category: '基础结构',
        attributes: { title: '把模块分别拖入左右栏' },
        content: '<section data-studio-layout="columns" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:12px;"><div data-studio-slot="左栏" style="min-height:96px;"></div><div data-studio-slot="右栏" style="min-height:96px;"></div></section>',
      })
      blocks.add('three-drop-columns', {
        label: blockLabel(ICON_PATHS.columns, '三个自由栏'),
        category: '基础结构',
        attributes: { title: '把模块分别拖入三个栏位' },
        content: '<section data-studio-layout="columns" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:12px;"><div data-studio-slot="左栏" style="min-height:96px;"></div><div data-studio-slot="中栏" style="min-height:96px;"></div><div data-studio-slot="右栏" style="min-height:96px;"></div></section>',
      })
      blocks.add('heading', { label: blockLabel(ICON_PATHS.heading, '标题'), category: '文字', content: '<h2>请输入标题</h2>' })
      blocks.add('text', { label: blockLabel(ICON_PATHS.text, '文字'), category: '文字', content: '<p>双击修改这段文字。</p>' })
      blocks.add('button', { label: blockLabel(ICON_PATHS.button, '链接按钮'), category: '常用组件', content: '<a href="#" style="display:inline-block;padding:10px 16px;border:1px solid #059669;border-radius:8px;color:#047857;text-decoration:none;font-weight:700;">按钮文字</a>' })
      blocks.add('list', { label: blockLabel(ICON_PATHS.list, '列表模块'), category: '常用组件', content: '<section style="padding:32px;border:1px solid #e2e8f0;border-radius:12px;"><h2>列表标题</h2><ul><li>列表内容一</li><li>列表内容二</li><li>列表内容三</li></ul></section>' })
      blocks.add('ad-slot', { label: blockLabel(ICON_PATHS.section, '广告位'), category: '常用组件', content: '<aside aria-label="广告" style="min-height:120px;display:flex;align-items:center;justify-content:center;border:1px dashed #94a3b8;background:#f8fafc;color:#64748b;">广告位 1200 × 120</aside>' })

      blocks.add('image', { label: blockLabel(ICON_PATHS.image, '单张图片'), category: '图片', content: { type: 'image', attributes: { src: STUDIO_IMAGE_PLACEHOLDER, alt: '图片说明' }, style: { display: 'block', 'max-width': '100%', height: 'auto', 'border-radius': '8px' } } })
      blocks.add('logo-image', { label: blockLabel(ICON_PATHS.image, 'Logo 图片'), category: '图片', content: `<img src="${STUDIO_IMAGE_PLACEHOLDER}" alt="网站 Logo" style="display:block;width:180px;height:64px;object-fit:contain;"/>` })
      blocks.add('round-image', { label: blockLabel(ICON_PATHS.image, '圆形图片'), category: '图片', content: `<img src="${STUDIO_IMAGE_PLACEHOLDER}" alt="圆形图片" style="display:block;width:96px;height:96px;object-fit:cover;border-radius:999px;"/>` })
      blocks.add('banner-image', { label: blockLabel(ICON_PATHS.image, '横幅图片'), category: '图片', content: `<img src="${STUDIO_IMAGE_PLACEHOLDER}" alt="横幅图片" style="display:block;width:100%;height:180px;object-fit:cover;border-radius:12px;"/>` })
      blocks.add('image-card', { label: blockLabel(ICON_PATHS.image, '图片卡片'), category: '图片', content: `<article style="overflow:hidden;border:1px solid #e2e8f0;border-radius:12px;background:#fff;max-width:320px;"><img src="${STUDIO_IMAGE_PLACEHOLDER}" alt="卡片图片" style="display:block;width:100%;height:170px;object-fit:cover;"/><div style="padding:16px;"><h3 style="margin:0 0 8px;">卡片标题</h3><p style="margin:0;color:#64748b;">双击修改卡片说明。</p></div></article>` })
      blocks.add('image-gallery', { label: blockLabel(ICON_PATHS.columns, '三图网格'), category: '图片', content: `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">${[1, 2, 3].map(index => `<img src="${STUDIO_IMAGE_PLACEHOLDER}" alt="网格图片 ${index}" style="display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;"/>`).join('')}</div>` })
      blocks.add('image-text-row', { label: blockLabel(ICON_PATHS.image, '图片加文字'), category: '图片', content: `<div style="display:flex;align-items:center;gap:14px;"><img src="${STUDIO_IMAGE_PLACEHOLDER}" alt="图文图片" style="width:72px;height:72px;object-fit:cover;border-radius:12px;flex:0 0 72px;"/><div><h3 style="margin:0 0 6px;">图文标题</h3><p style="margin:0;color:#64748b;">双击修改说明文字。</p></div></div>` })

      ;([
        ['home-icon', '首页图标', ICON_PATHS.home],
        ['search-icon', '搜索图标', ICON_PATHS.search],
        ['download-icon', '下载图标', ICON_PATHS.download],
        ['heart-icon', '收藏图标', ICON_PATHS.heart],
        ['refresh-icon', '刷新图标', ICON_PATHS.refresh],
        ['star-icon', '星标图标', ICON_PATHS.star],
      ] as const).forEach(([id, label, path]) => blocks.add(id, { label: blockLabel(path, label), category: '图标', content: iconBlock(path, label) }))
      blocks.add('icon-button', { label: blockLabel(ICON_PATHS.button, '图标按钮'), category: '图标', content: `<a href="#" aria-label="按钮说明" style="display:inline-flex;width:44px;height:44px;align-items:center;justify-content:center;border:1px solid #cbd5e1;border-radius:10px;color:#0f766e;background:#fff;text-decoration:none;">${iconSvg(ICON_PATHS.search, 22)}</a>` })
      blocks.add('icon-text', { label: blockLabel(ICON_PATHS.star, '图标加文字'), category: '图标', content: `<div style="display:flex;align-items:center;gap:10px;color:#0f172a;"><span style="display:inline-flex;color:#0f766e;">${iconSvg(ICON_PATHS.star, 24)}</span><span>双击修改文字</span></div>` })

      const installLayoutGuides = () => {
        const documentValue = editor.Canvas.getDocument()
        if (!documentValue || documentValue.getElementById('page-studio-layout-guides')) return
        const style = documentValue.createElement('style')
        style.id = 'page-studio-layout-guides'
        style.textContent = `
          [data-studio-layout="horizontal"]:empty,
          [data-studio-slot]:empty {
            position: relative;
            outline: 1px dashed #94a3b8;
            outline-offset: -1px;
            background: #f8fafc;
          }
          [data-studio-layout="horizontal"]:empty::before,
          [data-studio-slot]:empty::before {
            content: attr(data-studio-slot);
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #64748b;
            font: 13px/1.4 system-ui, sans-serif;
            pointer-events: none;
          }
          [data-studio-layout="horizontal"]:empty::before {
            content: '把多个模块拖到这里，它们会左右排列';
          }
          html.studio-show-interaction-layers [data-studio-interaction-target] {
            display: var(--studio-interaction-display, block) !important;
            visibility: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
            outline: 2px dashed #f59e0b !important;
            outline-offset: 2px;
          }
        `
        documentValue.head.appendChild(style)
      }
      const installCanvasHelpers = () => {
        installLayoutGuides()
        const documentValue = editor.Canvas.getDocument()
        if (!documentValue || documentValue.documentElement.dataset.studioShortcuts === 'true') return
        documentValue.documentElement.dataset.studioShortcuts = 'true'
        documentValue.addEventListener('keydown', event => shortcutHandlerRef.current(event), true)
      }
      editor.on('load canvas:frame:load', installCanvasHelpers)
      editor.on('block:drag:stop', (component: Component | undefined, block) => {
        if (!component || !block) return
        const blockId = String(block.getId())
        if (!blockId.startsWith(FAVORITE_BLOCK_PREFIX)) return
        const moduleId = blockId.slice(FAVORITE_BLOCK_PREFIX.length)
        const favorite = favoriteModulesRef.current.find(item => item.id === moduleId)
        if (favorite?.css) editor.addStyle(favorite.css)
      })

      if (page.projectData) editor.loadProjectData(page.projectData)
      if (page.baselineHtml === undefined || page.baselineCss === undefined) {
        const baselineHtml = editor.getHtml()
        const baselineCss = editor.getCss() ?? ''
        const withBaseline = {
          ...initialProject,
          pages: initialProject.pages.map(item => item.id === page.id ? { ...item, baselineHtml, baselineCss } : item),
        }
        projectRef.current = withBaseline
        setProject(withBaseline)
      }
      const initialDevice = page.targetDevice === 'mobile' ? 'Mobile' : 'Desktop'
      editor.setDevice(initialDevice)
      const refreshHistory = () => {
        setCanUndo(editor.UndoManager.hasUndo())
        setCanRedo(editor.UndoManager.hasRedo())
      }
      editor.on('update undo redo', () => {
        setSaved(false)
        refreshHistory()
      })
      editor.on('component:selected', (component: Component) => {
        const pendingInteraction = pendingInteractionRef.current
        if (pendingInteraction && component !== pendingInteraction.trigger) {
          const interactionId = `studio-target-${Date.now().toString(36)}`
          const display = String(component.getStyle()?.display || 'block')
          const previousTargetId = pendingInteraction.trigger.getAttributes()['data-studio-target']
          const wrapper = editor.getWrapper()
          if (previousTargetId && wrapper) {
            wrapper.find(`[data-studio-interaction-target="${previousTargetId}"]`).forEach(previousTarget => {
              previousTarget.removeAttributes(['data-studio-interaction-target', 'data-studio-display'])
            })
          }
          pendingInteraction.trigger.addAttributes({
            'data-studio-interaction': pendingInteraction.mode,
            'data-studio-target': interactionId,
            'aria-haspopup': 'true',
            'aria-expanded': 'false',
          })
          component.addAttributes({
            'data-studio-interaction-target': interactionId,
            'data-studio-display': display === 'none' ? 'block' : display,
          })
          pendingInteractionRef.current = null
          setInteractionPicking(false)
          setShowInteractionLayers(true)
          editor.Canvas.getDocument()?.documentElement.classList.add('studio-show-interaction-layers')
          setSaved(false)
        }
        const attributes = component.getAttributes()
        setSelectedComponentName(String(attributes['data-studio-module'] || attributes['data-studio-slot'] || component.getName() || component.get('tagName') || '区块'))
        if (component.parent() && !component.is('text')) {
          component.set('resizable', {
            tl: false,
            tc: false,
            tr: false,
            cl: true,
            cr: true,
            bl: false,
            bc: false,
            br: false,
            keepAutoHeight: true,
          })
        }
      })
      editor.on('component:deselected', () => setSelectedComponentName(null))
      editorRef.current = editor
      refreshHistory()
      setReady(true)
    }
    void initialize().catch(error => {
      if (disposed) return
      setStorageError(error instanceof Error ? error.message : '页面设计资料读取失败')
      setReady(true)
    })
    return () => {
      disposed = true
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [projectId])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => shortcutHandlerRef.current(event)
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    if (!ready || saved || syncing || !project) return
    const timer = window.setTimeout(() => { void persistRef.current(false, '自动保存') }, 3000)
    return () => window.clearTimeout(timer)
  }, [project, ready, saved, syncing])

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

  async function persist(createVersion = false, label = '手动保存') {
    const current = snapshotCurrent()
    if (!current) return null
    setSyncing(true)
    try {
      const next = await savePageStudioProject(current, { createVersion, label })
      projectRef.current = next
      setProject(next)
      setSaved(true)
      setStorageError('')
      return next
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '页面保存失败')
      return null
    } finally {
      setSyncing(false)
    }
  }
  persistRef.current = persist

  function selectParentComponent() {
    const editor = editorRef.current
    const parent = editor?.getSelected()?.parent()
    if (editor && parent && parent.parent()) editor.select(parent)
  }

  function copySelectedComponent() {
    const component = editorRef.current?.getSelected()
    if (!component?.parent()) return
    componentClipboardRef.current = component.clone()
    setHasCopiedComponent(true)
  }

  function pasteSelectedComponent() {
    const editor = editorRef.current
    const copied = componentClipboardRef.current
    if (!editor || !copied) return
    const selected = editor.getSelected()
    const parent = selected?.parent() ?? editor.getWrapper()
    if (!parent) return
    const siblings = parent.components().models
    const selectedIndex = selected && selected.parent() === parent ? siblings.indexOf(selected) : siblings.length - 1
    const [pasted] = parent.append(copied.clone(), { at: selectedIndex + 1 })
    if (pasted) editor.select(pasted)
    setSaved(false)
  }

  function duplicateSelectedComponent() {
    const editor = editorRef.current
    const component = editor?.getSelected()
    const parent = component?.parent()
    if (!editor || !component || !parent || component.get('copyable') === false) return
    const index = parent.components().models.indexOf(component)
    const [duplicate] = parent.append(component.clone(), { at: index + 1 })
    if (duplicate) editor.select(duplicate)
    setSaved(false)
  }

  function deleteSelectedComponent() {
    const editor = editorRef.current
    const component = editor?.getSelected()
    if (!editor || !component?.parent() || component.get('removable') === false) return
    component.remove()
    editor.selectRemove(component)
    setSaved(false)
  }

  function handleEditorShortcut(event: KeyboardEvent) {
    const editor = editorRef.current
    if (!editor) return
    const target = event.target as HTMLElement | null
    if (editor.getEditing() || target?.closest('input, textarea, select, [contenteditable="true"]')) return

    const key = event.key.toLowerCase()
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) editor.UndoManager.redo()
      else editor.UndoManager.undo()
      return
    }
    if (modifier && key === 'c') {
      event.preventDefault()
      copySelectedComponent()
      return
    }
    if (modifier && key === 'v') {
      event.preventDefault()
      pasteSelectedComponent()
      return
    }
    if (modifier && key === 'd') {
      event.preventDefault()
      duplicateSelectedComponent()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteSelectedComponent()
    }
  }
  shortcutHandlerRef.current = handleEditorShortcut

  function makeSelectedHorizontal() {
    const component = editorRef.current?.getSelected()
    if (!component) return
    const currentStyle = component.getStyle()
    component.addStyle({
      display: 'flex',
      'flex-direction': 'row',
      'flex-wrap': 'wrap',
      'align-items': 'stretch',
      gap: currentStyle.gap || '16px',
    })
    component.addAttributes({ 'data-studio-layout': 'horizontal' })
    setSaved(false)
  }

  function setSelectedWidth(width: '33.333%' | '50%' | '100%') {
    const component = editorRef.current?.getSelected()
    if (!component) return
    const basis = width === '33.333%' ? 'calc(33.333% - 11px)' : width === '50%' ? 'calc(50% - 8px)' : '100%'
    component.addStyle({
      width,
      'max-width': 'none',
      'flex-basis': basis,
      'flex-grow': '0',
      'box-sizing': 'border-box',
    })
    setSaved(false)
  }

  function centerSelectedComponent() {
    const component = editorRef.current?.getSelected()
    if (!component) return
    component.addStyle({ 'margin-left': 'auto', 'margin-right': 'auto' })
    setSaved(false)
  }

  function openSaveModuleDialog() {
    const component = editorRef.current?.getSelected()
    if (!component) return
    setFavoriteName(component.getName() || component.get('tagName') || '未命名模块')
    setFavoriteCategory('通用')
    setDialog('save-module')
  }

  async function saveSelectedAsFavorite() {
    const editor = editorRef.current
    const component = editor?.getSelected()
    if (!editor || !component || !favoriteName.trim()) return
    let favorite: PageStudioFavoriteModule
    try {
      favorite = await createPageStudioFavoriteModule({
        name: favoriteName,
        category: favoriteCategory,
        html: editor.getHtml({ component }),
        css: editor.getCss({ component }) ?? '',
      })
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '收藏模块保存失败')
      return
    }
    const next = [favorite, ...favoriteModulesRef.current]
    favoriteModulesRef.current = next
    setFavoriteModules(next)
    registerFavoriteBlock(editor, favorite)
    setDialog(null)
    setFavoriteName('')
    setLeftPanelOpen(true)
    setLeftPanel('blocks')
  }

  async function removeFavoriteModule(module: PageStudioFavoriteModule) {
    if (!window.confirm(`删除收藏模块“${module.name}”？`)) return
    try {
      await deletePageStudioFavoriteModule(module.id)
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '收藏模块删除失败')
      return
    }
    const next = favoriteModulesRef.current.filter(item => item.id !== module.id)
    favoriteModulesRef.current = next
    setFavoriteModules(next)
    editorRef.current?.BlockManager.remove(`${FAVORITE_BLOCK_PREFIX}${module.id}`)
  }

  async function importExternalModule() {
    if (!favoriteName.trim() || !moduleHtml.trim()) return
    const editor = editorRef.current
    if (!editor) return
    const imported = extractImportedCode(moduleHtml, moduleCss, { removeImages: true })
    try {
      const favorite = await createPageStudioFavoriteModule({
        name: favoriteName,
        category: favoriteCategory,
        html: imported.html,
        css: imported.css,
        sourceName: moduleSourceName,
        sourceUrl: moduleSourceUrl,
      })
      const next = [favorite, ...favoriteModulesRef.current]
      favoriteModulesRef.current = next
      setFavoriteModules(next)
      registerFavoriteBlock(editor, favorite)
      setModuleHtml('')
      setModuleCss('')
      setModuleSourceName('')
      setModuleSourceUrl('')
      setFavoriteName('')
      setStorageError('')
      setDialog(null)
      setLeftPanelOpen(true)
      setLeftPanel('blocks')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '外部模块导入失败')
    }
  }

  async function updateFavoriteFromSelection(favorite: PageStudioFavoriteModule) {
    const editor = editorRef.current
    const component = editor?.getSelected()
    if (!editor || !component) {
      setStorageError('请先在画布中选中要作为新版本的模块')
      return
    }
    if (!window.confirm(`用当前选中内容更新“${favorite.name}”？旧版会保留。`)) return
    try {
      const updated = await updatePageStudioFavoriteModule(favorite.id, {
        html: editor.getHtml({ component }),
        css: editor.getCss({ component }) ?? '',
      })
      const next = favoriteModulesRef.current.map(item => item.id === updated.id ? updated : item)
      favoriteModulesRef.current = next
      setFavoriteModules(next)
      editor.BlockManager.remove(`${FAVORITE_BLOCK_PREFIX}${favorite.id}`)
      registerFavoriteBlock(editor, updated)
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '模块版本更新失败')
    }
  }

  async function restoreFavoriteVersion(version: NonNullable<PageStudioFavoriteModule['versions']>[number]) {
    const favorite = selectedFavorite
    const editor = editorRef.current
    if (!favorite || !editor || !window.confirm(`将“${favorite.name}”恢复到 v${version.version}？`)) return
    try {
      const updated = await updatePageStudioFavoriteModule(favorite.id, { html: version.html, css: version.css })
      const next = favoriteModulesRef.current.map(item => item.id === updated.id ? updated : item)
      favoriteModulesRef.current = next
      setFavoriteModules(next)
      setSelectedFavorite(updated)
      editor.BlockManager.remove(`${FAVORITE_BLOCK_PREFIX}${favorite.id}`)
      registerFavoriteBlock(editor, updated)
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '模块版本恢复失败')
    }
  }

  function openAnimationDialog() {
    const component = editorRef.current?.getSelected()
    if (!component) return
    const attributes = component.getAttributes()
    const style = component.getStyle()
    const preset = attributes['data-studio-animation']
    setAnimationPreset(preset === 'fade-in' || preset === 'fade-up' || preset === 'scale-in' ? preset : 'none')
    setAnimationDuration(Number.parseInt(String(style['--studio-animation-duration'] ?? '600'), 10) || 600)
    setAnimationDelay(Number.parseInt(String(style['--studio-animation-delay'] ?? '0'), 10) || 0)
    setDialog('animation')
  }

  function applyAnimation() {
    const editor = editorRef.current
    const component = editor?.getSelected()
    if (!editor || !component) return
    if (animationPreset === 'none') {
      component.removeAttributes('data-studio-animation')
      component.removeStyle('--studio-animation-duration')
      component.removeStyle('--studio-animation-delay')
    } else {
      component.addAttributes({ 'data-studio-animation': animationPreset })
      component.addStyle({
        '--studio-animation-duration': `${Math.max(100, Math.min(5000, animationDuration))}ms`,
        '--studio-animation-delay': `${Math.max(0, Math.min(5000, animationDelay))}ms`,
      })
      editor.addStyle(STUDIO_ANIMATION_CSS)
    }
    setSaved(false)
    setDialog(null)
  }

  async function openVersions() {
    if (!projectRef.current) return
    setDialog('versions')
    setVersionsLoading(true)
    try {
      setVersions(await loadPageStudioProjectVersions(projectRef.current.id))
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '版本记录读取失败')
    } finally {
      setVersionsLoading(false)
    }
  }

  async function restoreVersion(version: PageStudioProjectVersion) {
    const editor = editorRef.current
    if (!editor || !window.confirm(`恢复到版本 ${version.versionNo}？当前项目会先保留为一个版本。`)) return
    await persist(true, '恢复版本前')
    const restored = { ...version.project, id: projectId, status: 'draft' as const }
    try {
      const next = await savePageStudioProject(restored, { createVersion: true, label: `恢复至版本 ${version.versionNo}` })
      projectRef.current = next
      setProject(next)
      const page = next.pages.find(item => item.id === next.activePageId) ?? next.pages[0]
      editor.DomComponents.clear()
      editor.CssComposer.clear()
      if (page.projectData) editor.loadProjectData(page.projectData)
      else {
        editor.setComponents(page.html)
        editor.setStyle(page.css)
      }
      editor.setDevice(page.targetDevice === 'mobile' ? 'Mobile' : 'Desktop')
      setSaved(true)
      setStorageError('')
      setDialog(null)
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '版本恢复失败')
    }
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
    const normalizedHtml = editor.getHtml()
    const normalizedCss = editor.getCss() ?? ''
    next = {
      ...next,
      pages: next.pages.map(item => item.id === page.id ? { ...item, html: normalizedHtml, css: normalizedCss, baselineHtml: normalizedHtml, baselineCss: normalizedCss } : item),
    }
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
    setPreviewDocument(buildPagePrototypeDocument(current, page))
    setDialog('preview')
  }

  function openInteractionDialog() {
    const attributes = editorRef.current?.getSelected()?.getAttributes() ?? {}
    setInteractionMode(attributes['data-studio-interaction'] === 'click-toggle' ? 'click-toggle' : 'hover-show')
    setDialog('interaction')
  }

  function startPickingInteractionTarget() {
    const trigger = editorRef.current?.getSelected()
    if (!trigger) return
    pendingInteractionRef.current = { trigger, mode: interactionMode }
    setInteractionPicking(true)
    setLeftPanelOpen(true)
    setLeftPanel('layers')
    setDialog(null)
  }

  function cancelPickingInteractionTarget() {
    pendingInteractionRef.current = null
    setInteractionPicking(false)
  }

  function removeSelectedInteraction() {
    const editor = editorRef.current
    const trigger = editor?.getSelected()
    if (!editor || !trigger) return
    const attributes = trigger.getAttributes()
    const targetId = attributes['data-studio-target']
    trigger.removeAttributes(['data-studio-interaction', 'data-studio-target', 'aria-haspopup', 'aria-expanded'])
    const wrapper = editor.getWrapper()
    if (targetId && wrapper) {
      wrapper.find(`[data-studio-interaction-target="${targetId}"]`).forEach(target => {
        target.removeAttributes(['data-studio-interaction-target', 'data-studio-display'])
      })
    }
    setSaved(false)
    setDialog(null)
  }

  function toggleInteractionLayers() {
    const next = !showInteractionLayers
    setShowInteractionLayers(next)
    editorRef.current?.Canvas.getDocument()?.documentElement.classList.toggle('studio-show-interaction-layers', next)
  }

  async function exportCurrent() {
    const current = await persist()
    if (!current) return
    const page = current.pages.find(item => item.id === current.activePageId) ?? current.pages[0]
    downloadPageDocument(current, page)
    try {
      const next = await savePageStudioProject({ ...current, status: 'exported' })
      projectRef.current = next
      setProject(next)
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '导出状态保存失败')
    }
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
    const normalizedHtml = editor.getHtml()
    const normalizedCss = editor.getCss() ?? ''
    const next = {
      ...current,
      pages: current.pages.map(page => page.id === current.activePageId ? { ...page, html: normalizedHtml, css: normalizedCss, baselineHtml: normalizedHtml, baselineCss: normalizedCss, projectData: undefined } : page),
    }
    projectRef.current = next
    setProject(next)
    setSaved(false)
    setDialog(null)
    setCodeHtml('')
    setCodeCss('')
    setCodeRemoveImages(true)
  }

  async function copyChangeReport() {
    const current = snapshotCurrent()
    if (!current) return
    const page = current.pages.find(item => item.id === current.activePageId) ?? current.pages[0]
    await navigator.clipboard.writeText(buildPageChangeReport(current, page))
    setReportCopied(true)
    window.setTimeout(() => setReportCopied(false), 1800)
  }

  if (!project) {
    if (!ready) return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">正在从数据库读取项目…</div>
    return <div className="flex min-h-screen items-center justify-center bg-slate-100"><div className="max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-lg font-semibold text-slate-900">{storageError ? '项目读取失败' : '找不到这个项目'}</h1><p className={`mt-2 text-sm ${storageError ? 'text-red-600' : 'text-slate-500'}`}>{storageError || '这份项目可能已被删除。'}</p><Link href="/page-studio" className="btn-primary mt-5">返回项目管理</Link></div></div>
  }

  const activePage = project.pages.find(page => page.id === project.activePageId) ?? project.pages[0]
  const audits = typeof window !== 'undefined' ? auditPage({ ...activePage, html: editorRef.current?.getHtml() ?? activePage.html }) : []
  const selectedHasInteraction = Boolean(editorRef.current?.getSelected()?.getAttributes()['data-studio-interaction'])

  return (
    <div className="flex h-screen min-w-[1040px] flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3">
        <Link href={`/page-studio/projects/${project.id}`} aria-label="返回项目页面管理" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 5-5 5 5 5" /></svg></Link>
        <div className="min-w-0 max-w-64"><p className="truncate text-sm font-semibold text-slate-950">{project.name}</p><p className={`text-[11px] ${saved && !syncing ? 'text-slate-400' : 'text-amber-600'}`}>{syncing ? '正在同步…' : saved ? '已保存到 Supabase' : '有未保存修改'}</p></div>
        <div className="mx-2 h-6 w-px bg-slate-200" />
        <select aria-label="当前页面" value={project.activePageId} onChange={event => loadPage(event.target.value)} className="h-9 min-w-40 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option disabled>选择页面</option>{project.pages.map(page => <option key={page.id} value={page.id}>{page.name} · {page.path}</option>)}</select>
        <button type="button" onClick={() => setDialog('add-page')} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">+ 页面</button>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
          <button type="button" disabled={!canUndo} onClick={() => editorRef.current?.UndoManager.undo()} className="inline-flex h-9 items-center px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35" title="撤销（Ctrl+Z）" aria-label="撤销">↶</button>
          <button type="button" disabled={!canRedo} onClick={() => editorRef.current?.UndoManager.redo()} className="inline-flex h-9 items-center border-l border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35" title="重做（Ctrl+Shift+Z）" aria-label="重做">↷</button>
        </div>

        <span className="ml-auto inline-flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700">{activePage.targetDevice === 'mobile' ? 'M端页面 · 375px' : 'PC页面 · 1440px'}</span>
        <button type="button" aria-pressed={leftPanelOpen} onClick={() => setLeftPanelOpen(value => !value)} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50">{leftPanelOpen ? '隐藏模块' : '选择模块'}</button>
        <button type="button" aria-pressed={rightPanelOpen} onClick={() => setRightPanelOpen(value => !value)} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50">{rightPanelOpen ? '隐藏设置' : '显示设置'}</button>
        <button type="button" onClick={showPreview} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">预览</button>
        {advancedMode && <><button type="button" onClick={() => setDialog('audit')} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">百度检查</button><button type="button" onClick={() => setDialog('import-code')} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">粘贴代码</button><button type="button" onClick={() => void openVersions()} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">版本</button><button type="button" onClick={() => setDialog('changes')} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">修改记录</button></>}
        <button type="button" aria-pressed={advancedMode} onClick={() => { setAdvancedMode(value => !value); setRightPanel('quick') }} className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-medium ${advancedMode ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{advancedMode ? '退出高级' : '高级模式'}</button>
        <button type="button" disabled={syncing} onClick={() => void persist(true, '手动保存')} className="inline-flex h-9 items-center rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{syncing ? '保存中' : '保存'}</button>
        <button type="button" onClick={() => void copyCurrentCode()} className="inline-flex h-9 items-center rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">{copied ? '已复制' : '复制代码'}</button>
        <button type="button" onClick={() => void exportCurrent()} className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700">导出当前页</button>
      </header>

      {storageError && <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{storageError}</div>}

      <div className="flex min-h-0 flex-1">
        <aside className={`${leftPanelOpen ? 'w-80' : 'hidden'} shrink-0 overflow-y-auto border-r border-slate-200 bg-white`}>
          <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white p-1.5"><button type="button" onClick={() => setLeftPanel('blocks')} className={`h-8 flex-1 rounded-md text-xs font-medium ${leftPanel === 'blocks' ? 'bg-emerald-50 text-emerald-800' : 'text-slate-500'}`}>选择模块</button><button type="button" onClick={() => setLeftPanel('layers')} className={`h-8 flex-1 rounded-md text-xs font-medium ${leftPanel === 'layers' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>高级结构</button></div>
          <div className={leftPanel === 'blocks' ? '' : 'hidden'}><PageStudioModuleLibrary editor={editorRef.current} favorites={favoriteModules} onManageFavorites={() => setDialog('module-library')} /><div id="page-studio-blocks" className="hidden" /></div>
          <div id="page-studio-layers" className={`page-studio-panel ${leftPanel === 'layers' ? '' : 'hidden'}`} />
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col gap-2 bg-slate-200 p-4">
          {!ready && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100 text-sm text-slate-500">正在准备编辑画布…</div>}
          {interactionPicking && <div className="flex shrink-0 items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm"><strong>请选择下拉层</strong><span>直接点击画布里的目标层；若它被隐藏，请从左侧“页面结构”选择。</span><button type="button" onClick={cancelPickingInteractionTarget} className="ml-auto rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100">取消</button></div>}
          {selectedComponentName && <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto rounded-lg border border-slate-300 bg-white px-2 shadow-sm">
            <span className="mr-1 max-w-36 truncate text-xs text-slate-500" title={selectedComponentName}>已选：{selectedComponentName}</span>
            <button type="button" onClick={selectParentComponent} className="h-7 shrink-0 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50" title="选中包住当前元素的外框">上一级</button>
            <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
              <button type="button" onClick={copySelectedComponent} className="h-7 px-2.5 text-xs text-slate-700 hover:bg-slate-50" title="复制当前元素（Ctrl+C）">复制</button>
              <button type="button" disabled={!hasCopiedComponent} onClick={pasteSelectedComponent} className="h-7 border-l border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35" title="粘贴到当前元素后面（Ctrl+V）">粘贴</button>
              <button type="button" onClick={duplicateSelectedComponent} className="h-7 border-l border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50" title="直接复制一份（Ctrl+D）">复制一份</button>
              <button type="button" onClick={deleteSelectedComponent} className="h-7 border-l border-red-200 px-2.5 text-xs font-medium text-red-600 hover:bg-red-50" title="删除当前元素（Delete）">删除</button>
            </div>
            <button type="button" onClick={makeSelectedHorizontal} className="h-7 shrink-0 rounded-md border border-emerald-300 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50" title="让这个外框里的子模块左右排列">改为横排</button>
            <span className="ml-1 text-[11px] text-slate-400">当前宽度</span>
            <button type="button" onClick={() => setSelectedWidth('33.333%')} className="h-7 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50">1/3</button>
            <button type="button" onClick={() => setSelectedWidth('50%')} className="h-7 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50">1/2</button>
            <button type="button" onClick={() => setSelectedWidth('100%')} className="h-7 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50">全宽</button>
            <button type="button" onClick={centerSelectedComponent} className="h-7 shrink-0 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50">模块居中</button>
            {advancedMode && <><button type="button" onClick={openInteractionDialog} className={`h-7 shrink-0 rounded-md border px-2.5 text-xs ${selectedHasInteraction ? 'border-amber-300 bg-amber-50 font-medium text-amber-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>交互{selectedHasInteraction ? '已设' : ''}</button><button type="button" aria-pressed={showInteractionLayers} onClick={toggleInteractionLayers} className="h-7 shrink-0 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50">{showInteractionLayers ? '隐藏交互层' : '显示交互层'}</button><button type="button" onClick={openAnimationDialog} className="h-7 shrink-0 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50">动画</button></>}
            <button type="button" onClick={openSaveModuleDialog} className="ml-auto h-7 shrink-0 rounded-md border border-amber-300 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-50">存为我的模块</button>
          </div>}
          <div id="page-studio-canvas" className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm" />
        </main>

        <aside className={`${rightPanelOpen ? 'w-80' : 'hidden'} shrink-0 overflow-y-auto border-l border-slate-200 bg-white`}>
          <div className={`sticky top-0 z-10 grid ${advancedMode ? 'grid-cols-4' : 'grid-cols-2'} border-b border-slate-200 bg-white p-1.5`}><button type="button" onClick={() => setRightPanel('quick')} className={`h-8 rounded-md text-[11px] font-medium ${rightPanel === 'quick' ? 'bg-emerald-50 text-emerald-800' : 'text-slate-500'}`}>常用设置</button><button type="button" onClick={() => setRightPanel('traits')} className={`h-8 rounded-md text-[11px] font-medium ${rightPanel === 'traits' ? 'bg-emerald-50 text-emerald-800' : 'text-slate-500'}`}>图片与链接</button>{advancedMode && <><button type="button" onClick={() => setRightPanel('style')} className={`h-8 rounded-md text-[11px] font-medium ${rightPanel === 'style' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>详细样式</button><button type="button" onClick={() => setRightPanel('devtools')} className={`h-8 rounded-md text-[11px] font-medium ${rightPanel === 'devtools' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>CSS 高级</button></>}</div>
          <div className={rightPanel === 'quick' ? '' : 'hidden'}><PageStudioQuickStyle editor={editorRef.current} onAdvanced={() => { setAdvancedMode(true); setRightPanel('devtools') }} /></div>
          <div id="page-studio-styles" className={`page-studio-panel ${rightPanel === 'style' ? '' : 'hidden'}`} />
          <div className={rightPanel === 'devtools' ? '' : 'hidden'}><PageStudioDevtools editor={editorRef.current} /></div>
          <div id="page-studio-traits" className={`page-studio-panel ${rightPanel === 'traits' ? '' : 'hidden'}`} />
        </aside>
      </div>

      {dialog === 'preview' && <AppDialog title={`${activePage.name} · 页面预览`} description="可测试链接，以及你设定的悬停或点击展开交互。" onClose={() => setDialog(null)} width="max-w-6xl" bodyClassName="min-h-0 flex-1 bg-slate-200 p-3"><iframe title="页面预览" srcDoc={previewDocument} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" className="h-[72vh] w-full rounded-lg border border-slate-300 bg-white" /></AppDialog>}
      {dialog === 'audit' && <AppDialog title="百度基础检查" description="这是导出前的结构提醒，不代表搜索排名保证。" onClose={() => setDialog(null)} width="max-w-xl"><div className="space-y-3">{audits.map(item => <div key={item.label} className={`rounded-lg border p-4 ${item.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center justify-between"><strong className="text-sm text-slate-900">{item.label}</strong><span className={`text-xs font-semibold ${item.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{item.ok ? '通过' : '需检查'}</span></div><p className="mt-1 text-sm text-slate-600">{item.detail}</p></div>)}</div></AppDialog>}
      {dialog === 'add-page' && <AppDialog title="增加页面" description="可以从空白开始，也可以直接粘贴这个页面的 HTML 与 CSS。" onClose={() => setDialog(null)} width={newPageSource === 'code' ? 'max-w-5xl' : 'max-w-md'} footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" disabled={!newPageName.trim() || (newPageSource === 'code' && !codeHtml.trim())} onClick={addPage} className="btn-primary">增加页面</button></div>}><label className="block text-sm font-medium text-slate-700">页面名称<input autoFocus value={newPageName} onChange={event => setNewPageName(event.target.value)} placeholder="例如：关于我们" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500" /></label><fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">建立方式</legend><div className="mt-2 grid grid-cols-2 gap-3">{([['blank', '空白页面'], ['code', '粘贴页面代码']] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-lg border px-4 py-3 text-sm font-semibold ${newPageSource === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}><input type="radio" name="new-page-source" value={value} checked={newPageSource === value} onChange={() => setNewPageSource(value)} className="sr-only" />{label}</label>)}</div></fieldset><fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">主要设计尺寸</legend><div className="mt-2 grid grid-cols-2 gap-3">{([['desktop', '电脑端'], ['mobile', '手机端']] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-lg border px-4 py-3 text-sm font-semibold ${newPageDevice === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}><input type="radio" name="new-page-device" value={value} checked={newPageDevice === value} onChange={() => setNewPageDevice(value)} className="sr-only" />{label}</label>)}</div></fieldset>{newPageSource === 'code' && <CodeImportFields html={codeHtml} css={codeCss} removeImages={codeRemoveImages} onHtml={setCodeHtml} onCss={setCodeCss} onRemoveImages={setCodeRemoveImages} />}</AppDialog>}
      {dialog === 'import-code' && <AppDialog title={`粘贴代码到“${activePage.name}”`} description="确认后会替换当前页面的画布内容；尚未保存的当前内容会被覆盖。" onClose={() => setDialog(null)} width="max-w-5xl" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" disabled={!codeHtml.trim()} onClick={replaceCurrentWithCode} className="btn-primary">替换当前页面</button></div>}><CodeImportFields html={codeHtml} css={codeCss} removeImages={codeRemoveImages} onHtml={setCodeHtml} onCss={setCodeCss} onRemoveImages={setCodeRemoveImages} /></AppDialog>}
      {dialog === 'changes' && <ChangeReportDialog project={snapshotCurrent() ?? project} pageId={project.activePageId} copied={reportCopied} onCopy={() => void copyChangeReport()} onClose={() => setDialog(null)} />}
      {dialog === 'save-module' && <AppDialog title="收藏选中模块" description="保存后会出现在左侧“我的收藏”，可拖到其他页面重复使用。" onClose={() => setDialog(null)} width="max-w-md" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" disabled={!favoriteName.trim()} onClick={() => void saveSelectedAsFavorite()} className="btn-primary">加入收藏</button></div>}><label className="block text-sm font-medium text-slate-700">模块名称<input autoFocus value={favoriteName} onChange={event => setFavoriteName(event.target.value)} placeholder="例如：首页游戏推荐列表" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500" /></label><label className="mt-5 block text-sm font-medium text-slate-700">分类<select value={favoriteCategory} onChange={event => setFavoriteCategory(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500">{['通用', '列表', '导航', '广告位', '内容区', '卡片', '页尾'].map(item => <option key={item}>{item}</option>)}</select></label><p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">将保留选中模块的 HTML 和相关 CSS；不会把整个页面一起收藏。</p></AppDialog>}
      {dialog === 'module-library' && <AppDialog title="我的收藏模块" description="可重复拖入页面；选中画布内容后可将它保存为模块新版本。" onClose={() => setDialog(null)} width="max-w-5xl" headerActions={<button type="button" onClick={() => { setFavoriteName(''); setFavoriteCategory('通用'); setDialog('import-module') }} className="btn-secondary">导入外部模块</button>}>{favoriteModules.length === 0 ? <div className="py-12 text-center"><p className="text-sm font-medium text-slate-700">还没有收藏模块</p><p className="mt-1 text-xs text-slate-500">先选中画布模块进行收藏，或导入你有权使用的 HTML/CSS。</p></div> : <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">模块名称</th><th className="w-20 px-4 py-3 font-medium">版本</th><th className="w-24 px-4 py-3 font-medium">分类</th><th className="w-72 px-4 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{favoriteModules.map(module => <tr key={module.id}><td className="px-4 py-3"><p className="font-medium text-slate-900">{module.name}</p>{module.sourceName && <p className="mt-0.5 text-xs text-slate-400">来源：{module.sourceName}</p>}</td><td className="px-4 py-3 text-slate-500">v{module.version ?? 1}</td><td className="px-4 py-3 text-slate-500">{module.category}</td><td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" disabled={!module.versions?.length} onClick={() => { setSelectedFavorite(module); setDialog('module-versions') }} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">历史</button><button type="button" onClick={() => void updateFavoriteFromSelection(module)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">用选中内容更新</button><button type="button" onClick={() => void removeFavoriteModule(module)} className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">删除</button></div></td></tr>)}</tbody></table></div>}</AppDialog>}
      {dialog === 'module-versions' && selectedFavorite && <AppDialog title={`${selectedFavorite.name} · 模块历史`} description={`当前版本 v${selectedFavorite.version ?? 1}，最多保留 20 个旧版本。`} onClose={() => setDialog('module-library')} width="max-w-2xl">{selectedFavorite.versions?.length ? <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">{[...selectedFavorite.versions].reverse().map(version => <div key={`${version.version}-${version.createdAt}`} className="flex items-center justify-between gap-4 px-4 py-3"><div><p className="text-sm font-semibold text-slate-900">v{version.version}</p><p className="mt-0.5 text-xs text-slate-500">{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(version.createdAt))}</p></div><button type="button" onClick={() => void restoreFavoriteVersion(version)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">恢复为新版本</button></div>)}</div> : <div className="py-12 text-center text-sm text-slate-500">暂无旧版本</div>}</AppDialog>}
      {dialog === 'import-module' && <AppDialog title="导入外部模块" description="可从 Uiverse 等来源粘贴 HTML/CSS；脚本、iframe、追踪代码和外部 @import 会被移除。" onClose={() => setDialog('module-library')} width="max-w-5xl" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog('module-library')} className="btn-secondary">返回</button><button type="button" disabled={!favoriteName.trim() || !moduleHtml.trim()} onClick={() => void importExternalModule()} className="btn-primary">导入到收藏</button></div>}><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">模块名称<input value={favoriteName} onChange={event => setFavoriteName(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3" /></label><label className="text-sm font-medium text-slate-700">分类<select value={favoriteCategory} onChange={event => setFavoriteCategory(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{['通用', '列表', '导航', '广告位', '内容区', '卡片', '按钮', '页尾'].map(item => <option key={item}>{item}</option>)}</select></label><label className="text-sm font-medium text-slate-700">来源名称（可选）<input value={moduleSourceName} onChange={event => setModuleSourceName(event.target.value)} placeholder="Uiverse / React Bits / 自己设计" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3" /></label><label className="text-sm font-medium text-slate-700">来源网址（可选）<input value={moduleSourceUrl} onChange={event => setModuleSourceUrl(event.target.value)} placeholder="https://..." className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3" /></label></div><div className="mt-5 grid gap-4 lg:grid-cols-2"><label className="text-sm font-medium text-slate-700">HTML<textarea value={moduleHtml} onChange={event => setModuleHtml(event.target.value)} className="mt-2 h-64 w-full rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100" /></label><label className="text-sm font-medium text-slate-700">CSS<textarea value={moduleCss} onChange={event => setModuleCss(event.target.value)} className="mt-2 h-64 w-full rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100" /></label></div><p className="mt-3 text-xs leading-5 text-slate-500">React Bits / Aceternity 的 React 组件不能直接拖入 GrapesJS；请先转为静态 HTML/CSS，交互逻辑留给技术部接回。</p></AppDialog>}
      {dialog === 'animation' && <AppDialog title="动画参数" description="只使用可导出的 CSS 动画，不向页面加入 JavaScript。" onClose={() => setDialog(null)} width="max-w-lg" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" onClick={applyAnimation} className="btn-primary">应用动画</button></div>}><fieldset><legend className="text-sm font-medium text-slate-700">效果</legend><div className="mt-2 grid grid-cols-2 gap-2">{([['none', '无动画'], ['fade-in', '淡入'], ['fade-up', '向上淡入'], ['scale-in', '缩放淡入']] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-lg border px-3 py-3 text-sm ${animationPreset === value ? 'border-emerald-500 bg-emerald-50 font-semibold text-emerald-800' : 'border-slate-200'}`}><input type="radio" checked={animationPreset === value} onChange={() => setAnimationPreset(value)} className="sr-only" />{label}</label>)}</div></fieldset><div className="mt-5 grid grid-cols-2 gap-4"><label className="text-sm font-medium text-slate-700">时长（ms）<input type="number" min="100" max="5000" step="50" value={animationDuration} onChange={event => setAnimationDuration(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3" /></label><label className="text-sm font-medium text-slate-700">延迟（ms）<input type="number" min="0" max="5000" step="50" value={animationDelay} onChange={event => setAnimationDelay(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3" /></label></div></AppDialog>}
      {dialog === 'interaction' && <AppDialog title="设置展开交互" description="先选中菜单按钮，再指定要出现的下拉层。原网站脚本不会被执行。" onClose={() => setDialog(null)} width="max-w-lg" footer={<div className="flex w-full items-center justify-between gap-2">{selectedHasInteraction ? <button type="button" onClick={removeSelectedInteraction} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">移除交互</button> : <span />}<div className="flex gap-2"><button type="button" onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" onClick={startPickingInteractionTarget} className="btn-primary">下一步：选择下拉层</button></div></div>}><fieldset><legend className="text-sm font-medium text-slate-700">打开方式</legend><div className="mt-2 grid grid-cols-2 gap-3">{([['hover-show', '鼠标移入展开'], ['click-toggle', '点击展开']] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-lg border px-4 py-3 text-sm font-semibold ${interactionMode === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}><input type="radio" name="interaction-mode" checked={interactionMode === value} onChange={() => setInteractionMode(value)} className="sr-only" />{label}</label>)}</div></fieldset><div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600"><p className="font-semibold text-slate-800">操作方法</p><p className="mt-1">1. 当前选中的元素会作为菜单按钮。</p><p>2. 点击“下一步”后，再选择整块下拉菜单。</p><p>3. 点击顶部“预览”测试效果；编辑画布内不会直接触发展开。</p></div></AppDialog>}
      {dialog === 'versions' && <AppDialog title="项目版本记录" description="自动保存更新当前草稿；手动保存、AI 初稿与恢复操作会生成可恢复版本。" onClose={() => setDialog(null)} width="max-w-2xl">{versionsLoading ? <div className="py-12 text-center text-sm text-slate-500">正在读取版本…</div> : versions.length === 0 ? <div className="py-12 text-center text-sm text-slate-500">还没有版本，点击一次“保存”即会建立。</div> : <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">版本</th><th className="px-4 py-3">说明</th><th className="px-4 py-3">时间</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{versions.map(version => <tr key={version.id}><td className="px-4 py-3 font-semibold text-slate-900">v{version.versionNo}</td><td className="px-4 py-3 text-slate-600">{version.label}</td><td className="px-4 py-3 text-slate-500">{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(version.createdAt))}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => void restoreVersion(version)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">恢复</button></td></tr>)}</tbody></table></div>}</AppDialog>}
    </div>
  )
}

function CodeImportFields({ html, css, removeImages, onHtml, onCss, onRemoveImages }: { html: string; css: string; removeImages: boolean; onHtml: (value: string) => void; onCss: (value: string) => void; onRemoveImages: (value: boolean) => void }) {
  return <><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"><input type="checkbox" checked={removeImages} onChange={event => onRemoveImages(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600" /><span><span className="block text-sm font-semibold text-slate-900">替换原页面图片</span><span className="mt-0.5 block text-xs text-slate-600">保留图片标签、class 与尺寸，只替换图片内容。</span></span></label><div className="mt-5 grid gap-4 lg:grid-cols-2"><label className="block text-sm font-medium text-slate-700">HTML<textarea value={html} onChange={event => onHtml(event.target.value)} placeholder="粘贴完整页面 HTML" className="mt-2 h-64 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500" /></label><label className="block text-sm font-medium text-slate-700">CSS（可选）<textarea value={css} onChange={event => onCss(event.target.value)} placeholder="依次粘贴页面使用的 CSS" className="mt-2 h-64 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500" /></label></div></>
}

function ChangeReportDialog({ project, pageId, copied, onCopy, onClose }: { project: PageStudioProject; pageId: string; copied: boolean; onCopy: () => void; onClose: () => void }) {
  const page = project.pages.find(item => item.id === pageId) ?? project.pages[0]
  const htmlDiff = diffPageCode(page.baselineHtml ?? page.html, page.html, 'html').filter(line => line.type !== 'same')
  const cssDiff = diffPageCode(page.baselineCss ?? page.css, page.css, 'css').filter(line => line.type !== 'same')
  const changedCount = htmlDiff.length + cssDiff.length

  const codeSection = (title: string, lines: typeof htmlDiff) => <section>
    <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">{title}</h3><span className="text-xs text-slate-500">{lines.length} 行变化</span></div>
    <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-950 py-2 font-mono text-xs leading-5">
      {lines.length === 0 ? <p className="px-3 py-4 text-center text-slate-400">没有修改</p> : lines.map((line, index) => <div key={`${line.type}-${index}`} className={`grid grid-cols-[24px_1fr] gap-2 px-3 ${line.type === 'removed' ? 'bg-red-950/70 text-red-200' : 'bg-emerald-950/70 text-emerald-200'}`}><span className="select-none text-center font-bold">{line.type === 'removed' ? '−' : '+'}</span><code className="whitespace-pre-wrap break-all">{line.value}</code></div>)}
    </div>
  </section>

  return <AppDialog title={`${page.name} · 修改记录`} description="红色是原代码中被移除的内容，绿色是当前新增内容；这里只用于交接，不会写进正式 HTML。" onClose={onClose} width="max-w-5xl" footer={<div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">共 {changedCount} 行变化</span><div className="flex gap-2"><button type="button" onClick={onClose} className="btn-secondary">关闭</button><button type="button" onClick={onCopy} className="btn-primary">{copied ? '已复制修改说明' : '复制修改说明'}</button></div></div>}><div className="space-y-6">{codeSection('HTML 修改', htmlDiff)}{codeSection('CSS 修改', cssDiff)}</div></AppDialog>
}
