'use client'

import { useMemo, useState } from 'react'
import type { Editor } from 'grapesjs'
import type { PageStudioFavoriteModule } from '@/lib/page-studio'

type ModuleCategory = '常用' | '导航' | '内容' | '广告' | '布局' | '基础组件' | '我的模块'
type PreviewKind = 'nav' | 'banner' | 'waterfall' | 'list' | 'feature' | 'columns2' | 'columns3' | 'title' | 'text' | 'image' | 'icon' | 'buttons' | 'pager' | 'carousel'

type StudioModule = {
  id: string
  name: string
  description: string
  category: Exclude<ModuleCategory, '我的模块'>
  preview: PreviewKind
  html: string
}

const PLACEHOLDER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#eef2f7"/><path d="m145 285 120-128 78 82 58-61 96 107H145z" fill="#cbd5e1"/><circle cx="438" cy="112" r="32" fill="#cbd5e1"/></svg>')}`
const section = 'box-sizing:border-box;width:100%;max-width:1200px;margin:0 auto 16px;padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;'
const heading = 'margin:0;color:#0f172a;font-size:24px;line-height:1.3;'
const button = 'display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:8px;background:#059669;color:#fff;text-decoration:none;font-weight:700;'

const MODULES: StudioModule[] = [
  { id: 'nav-logo', name: 'Logo＋主导航', description: 'Logo、栏目和搜索入口', category: '导航', preview: 'nav', html: `<header data-studio-module="导航栏" style="${section}display:flex;align-items:center;gap:28px;"><img src="${PLACEHOLDER}" alt="网站 Logo" style="width:160px;height:52px;object-fit:contain;"/><nav aria-label="主导航" style="display:flex;flex:1;align-items:center;justify-content:center;gap:30px;"><a href="#" style="color:#059669;font-weight:800;text-decoration:none;">首页</a><a href="#" style="color:#334155;text-decoration:none;">手机游戏</a><a href="#" style="color:#334155;text-decoration:none;">手机应用</a><a href="#" style="color:#334155;text-decoration:none;">新闻资讯</a><a href="#" style="color:#334155;text-decoration:none;">排行榜</a></nav><a href="#" aria-label="搜索" style="color:#475569;text-decoration:none;font-size:20px;">⌕</a></header>` },
  { id: 'nav-compact', name: '简洁栏目导航', description: '适合页面内部栏目切换', category: '导航', preview: 'nav', html: `<nav data-studio-module="栏目导航" aria-label="栏目导航" style="${section}display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;"><a href="#" style="padding:10px 18px;border-radius:8px;background:#059669;color:#fff;text-decoration:none;font-weight:700;">推荐</a><a href="#" style="padding:10px 18px;color:#475569;text-decoration:none;">游戏</a><a href="#" style="padding:10px 18px;color:#475569;text-decoration:none;">应用</a><a href="#" style="padding:10px 18px;color:#475569;text-decoration:none;">专题</a></nav>` },
  { id: 'waterfall', name: '瀑布图片栏', description: '图片卡片自动换行排列', category: '内容', preview: 'waterfall', html: `<section data-studio-module="瀑布图片栏" style="${section}"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><h2 style="${heading}">热门推荐</h2><a href="#" style="color:#0284c7;text-decoration:none;">更多 ›</a></div><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;">${[1,2,3,4,5,6,7,8].map(i => `<article style="overflow:hidden;border:1px solid #e2e8f0;border-radius:10px;background:#fff;"><img src="${PLACEHOLDER}" alt="推荐图片 ${i}" style="display:block;width:100%;aspect-ratio:16/10;object-fit:cover;"/><div style="padding:10px;"><strong style="display:block;color:#0f172a;">内容标题 ${i}</strong><span style="color:#94a3b8;font-size:12px;">内容说明</span></div></article>`).join('')}</div></section>` },
  { id: 'info-list', name: '文章资讯列表', description: '标题、日期，可选查看按钮', category: '内容', preview: 'list', html: `<section data-studio-module="文章资讯列表" style="${section}"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><h2 style="${heading}">最新资讯</h2><a href="#" style="color:#0284c7;text-decoration:none;">更多 ›</a></div><div>${[1,2,3,4,5,6].map(i => `<article style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid #f1f5f9;"><a href="#" style="overflow:hidden;color:#1e293b;text-decoration:none;text-overflow:ellipsis;white-space:nowrap;">这里是文章资讯标题 ${i}</a><time style="color:#94a3b8;font-size:13px;">2026/10/01</time><a href="#" style="padding:6px 12px;border:1px solid #bae6fd;border-radius:6px;color:#0284c7;text-decoration:none;font-size:13px;">查看</a></article>`).join('')}</div></section>` },
  { id: 'download-list', name: '下载资源列表', description: '图标、名称、说明和下载按钮', category: '内容', preview: 'list', html: `<section data-studio-module="下载资源列表" style="${section}"><h2 style="${heading}margin-bottom:12px;">热门下载</h2><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">${[1,2,3,4].map(i => `<article style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;"><img src="${PLACEHOLDER}" alt="应用图标 ${i}" style="width:58px;height:58px;border-radius:12px;object-fit:cover;"/><div style="min-width:0;flex:1;"><strong style="display:block;color:#0f172a;">应用名称 ${i}</strong><span style="color:#94a3b8;font-size:12px;">版本与简短介绍</span></div><a href="#" style="${button}min-height:34px;padding:0 12px;font-size:13px;">下载</a></article>`).join('')}</div></section>` },
  { id: 'banner-ad', name: '横幅广告位', description: '整行广告图，可修改链接', category: '广告', preview: 'banner', html: `<aside data-studio-module="横幅广告" aria-label="广告" style="${section}padding:0;overflow:hidden;"><a href="#" style="display:block;"><img src="${PLACEHOLDER}" alt="横幅广告" style="display:block;width:100%;height:150px;object-fit:cover;"/></a></aside>` },
  { id: 'feature-cards', name: '专题图片广告', description: '专题、攻略或文章入口', category: '广告', preview: 'feature', html: `<section data-studio-module="专题图片广告" style="${section}"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><h2 style="${heading}">精选专题</h2><a href="#" style="color:#0284c7;text-decoration:none;">更多 ›</a></div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;">${[1,2,3].map(i => `<a href="#" style="position:relative;display:block;overflow:hidden;border-radius:10px;color:#fff;text-decoration:none;"><img src="${PLACEHOLDER}" alt="专题 ${i}" style="display:block;width:100%;aspect-ratio:16/9;object-fit:cover;filter:brightness(.72);"/><strong style="position:absolute;left:14px;right:14px;bottom:12px;font-size:16px;">专题或文章标题 ${i}</strong></a>`).join('')}</div></section>` },
  { id: 'two-columns', name: '一屏两个模块', description: '左右各放一个内容模块', category: '布局', preview: 'columns2', html: `<section data-studio-module="双栏布局" style="${section}display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;"><div data-studio-slot="左侧模块" style="min-height:180px;padding:20px;border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc;"><h3 style="margin:0 0 8px;">左侧模块</h3><p style="margin:0;color:#64748b;">把内容放在这里</p></div><div data-studio-slot="右侧模块" style="min-height:180px;padding:20px;border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc;"><h3 style="margin:0 0 8px;">右侧模块</h3><p style="margin:0;color:#64748b;">把内容放在这里</p></div></section>` },
  { id: 'three-columns', name: '一屏三个模块', description: '三个等宽内容区域', category: '布局', preview: 'columns3', html: `<section data-studio-module="三栏布局" style="${section}display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;">${['左侧模块','中间模块','右侧模块'].map(label => `<div data-studio-slot="${label}" style="min-height:170px;padding:18px;border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc;"><h3 style="margin:0 0 8px;">${label}</h3><p style="margin:0;color:#64748b;">把内容放在这里</p></div>`).join('')}</section>` },
  { id: 'title', name: '标题栏', description: '标题和可选更多入口', category: '基础组件', preview: 'title', html: `<div data-studio-module="标题栏" style="${section}display:flex;align-items:center;justify-content:space-between;padding:12px 16px;"><h2 style="${heading}">区块标题</h2><a href="#" style="color:#0284c7;text-decoration:none;">更多 ›</a></div>` },
  { id: 'text', name: '文字说明', description: '可直接双击修改的段落', category: '基础组件', preview: 'text', html: `<div data-studio-module="文字说明" style="${section}"><p style="margin:0;color:#475569;line-height:1.8;">双击这里修改文字，可以填写模块说明、文章简介或其他内容。</p></div>` },
  { id: 'image', name: '单张图片', description: 'Logo、配图或广告图片', category: '基础组件', preview: 'image', html: `<div data-studio-module="单张图片" style="${section}padding:0;overflow:hidden;"><img src="${PLACEHOLDER}" alt="图片说明" style="display:block;width:100%;height:auto;object-fit:cover;"/></div>` },
  { id: 'icon-text', name: 'Icon＋文字', description: '图标搭配短说明', category: '基础组件', preview: 'icon', html: `<div data-studio-module="图标文字" style="${section}display:flex;align-items:center;gap:12px;"><span aria-hidden="true" style="display:inline-flex;width:42px;height:42px;align-items:center;justify-content:center;border-radius:10px;background:#ecfdf5;color:#047857;font-size:22px;">★</span><div><strong style="display:block;color:#0f172a;">功能标题</strong><span style="color:#64748b;font-size:13px;">在这里填写功能说明</span></div></div>` },
  { id: 'buttons', name: '操作按钮组', description: '下载、查看和更多按钮', category: '基础组件', preview: 'buttons', html: `<div data-studio-module="操作按钮" style="${section}display:flex;align-items:center;justify-content:center;gap:12px;"><a href="#" style="${button}">下载</a><a href="#" style="${button}background:#0284c7;">查看</a><a href="#" style="${button}background:#fff;color:#475569;border:1px solid #cbd5e1;">更多</a></div>` },
  { id: 'pager', name: '翻页按钮', description: '上一页、页码和下一页', category: '基础组件', preview: 'pager', html: `<nav data-studio-module="翻页按钮" aria-label="分页" style="${section}display:flex;align-items:center;justify-content:center;gap:8px;"><a href="#" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;color:#475569;text-decoration:none;">上一页</a><a href="#" style="padding:8px 12px;border-radius:7px;background:#059669;color:#fff;text-decoration:none;">1</a><a href="#" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;color:#475569;text-decoration:none;">2</a><a href="#" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;color:#475569;text-decoration:none;">下一页</a></nav>` },
  { id: 'carousel-arrows', name: '左右切换按钮', description: '用于轮播或横向内容区', category: '基础组件', preview: 'carousel', html: `<div data-studio-module="左右切换按钮" style="${section}display:flex;align-items:center;justify-content:space-between;min-height:100px;"><button type="button" aria-label="上一项" style="width:44px;height:44px;border:1px solid #cbd5e1;border-radius:50%;background:#fff;color:#334155;font-size:24px;">‹</button><span style="color:#94a3b8;">轮播内容区域</span><button type="button" aria-label="下一项" style="width:44px;height:44px;border:1px solid #cbd5e1;border-radius:50%;background:#fff;color:#334155;font-size:24px;">›</button></div>` },
]

const CATEGORIES: ModuleCategory[] = ['常用', '导航', '内容', '广告', '布局', '基础组件', '我的模块']
const COMMON_IDS = new Set(['nav-logo', 'waterfall', 'info-list', 'banner-ad', 'feature-cards', 'two-columns', 'three-columns', 'buttons'])

function ModulePreview({ kind }: { kind: PreviewKind }) {
  const bars = kind === 'columns3' ? 3 : kind === 'columns2' ? 2 : kind === 'waterfall' ? 4 : 1
  if (kind === 'nav') return <div className="flex h-full items-center gap-2 px-2"><span className="h-4 w-10 rounded bg-emerald-500" /><span className="ml-auto h-2 w-8 rounded bg-slate-300" /><span className="h-2 w-8 rounded bg-slate-300" /><span className="h-2 w-8 rounded bg-slate-300" /></div>
  if (kind === 'list') return <div className="space-y-1.5 p-2">{[1,2,3].map(item => <div key={item} className="flex items-center gap-2"><span className="h-2 flex-1 rounded bg-slate-300" /><span className="h-3 w-8 rounded bg-sky-200" /></div>)}</div>
  if (kind === 'buttons' || kind === 'pager' || kind === 'carousel') return <div className="flex h-full items-center justify-center gap-2">{[1,2,3].map(item => <span key={item} className={`h-5 rounded ${item === 2 ? 'w-8 bg-emerald-500' : 'w-7 bg-slate-300'}`} />)}</div>
  if (kind === 'title' || kind === 'text' || kind === 'icon') return <div className="flex h-full items-center gap-2 px-3"><span className="h-6 w-6 rounded bg-emerald-200" /><div className="flex-1 space-y-1.5"><div className="h-2 w-2/3 rounded bg-slate-400" /><div className="h-1.5 rounded bg-slate-200" /></div></div>
  return <div className="grid h-full gap-1.5 p-2" style={{ gridTemplateColumns: `repeat(${bars}, minmax(0, 1fr))` }}>{Array.from({ length: kind === 'waterfall' ? 8 : bars }).map((_, item) => <span key={item} className={`${kind === 'banner' || kind === 'image' ? 'min-h-10' : 'min-h-5'} rounded bg-gradient-to-br from-slate-200 to-slate-300`} />)}</div>
}

export default function PageStudioModuleLibrary({ editor, favorites, onManageFavorites }: { editor: Editor | null; favorites: PageStudioFavoriteModule[]; onManageFavorites: () => void }) {
  const [category, setCategory] = useState<ModuleCategory>('常用')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const modules = useMemo(() => MODULES.filter(module => {
    const matchesCategory = category === '常用' ? COMMON_IDS.has(module.id) : category === '我的模块' ? false : module.category === category
    return matchesCategory && (!normalizedQuery || `${module.name} ${module.description}`.toLowerCase().includes(normalizedQuery))
  }), [category, normalizedQuery])
  const visibleFavorites = category === '我的模块' ? favorites.filter(item => !normalizedQuery || `${item.name} ${item.category}`.toLowerCase().includes(normalizedQuery)) : []

  function addHtml(html: string, css?: string) {
    if (!editor) return
    const added = editor.addComponents(html)
    if (css) editor.addStyle(css)
    const component = Array.isArray(added) ? added[0] : added
    if (component) editor.select(component)
  }

  return <div className="bg-white">
    <div className="border-b border-slate-200 p-3">
      <label className="block"><span className="sr-only">搜索模块</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索导航、列表、广告…" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
      <p className="mt-2 text-[11px] leading-4 text-slate-500">点击模块即可加入页面底部，再到右侧修改图片、文字和样式。</p>
    </div>
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-2" style={{ scrollbarWidth: 'thin' }}>{CATEGORIES.map(item => <button key={item} type="button" onClick={() => setCategory(item)} className={`h-8 shrink-0 rounded-md px-2.5 text-xs font-medium ${category === item ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{item}</button>)}</div>
    <div className="grid grid-cols-2 gap-2 p-3">
      {modules.map(module => <button key={module.id} type="button" disabled={!editor} onClick={() => addHtml(module.html)} className="group overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-emerald-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-50">
        <div className="h-16 border-b border-slate-100 bg-slate-50"><ModulePreview kind={module.preview} /></div>
        <span className="block px-2.5 pt-2 text-xs font-semibold text-slate-800 group-hover:text-emerald-800">{module.name}</span>
        <span className="block px-2.5 pb-2 pt-0.5 text-[10px] leading-4 text-slate-500">{module.description}</span>
      </button>)}
      {visibleFavorites.map(module => <button key={module.id} type="button" disabled={!editor} onClick={() => addHtml(module.html, module.css)} className="group overflow-hidden rounded-lg border border-amber-200 bg-white text-left hover:border-amber-400 hover:shadow-sm">
        <div className="flex h-16 items-center justify-center border-b border-amber-100 bg-amber-50 text-xs font-semibold text-amber-700">我的模块</div>
        <span className="block px-2.5 pt-2 text-xs font-semibold text-slate-800">{module.name}</span><span className="block px-2.5 pb-2 pt-0.5 text-[10px] text-slate-500">{module.category}</span>
      </button>)}
    </div>
    {category === '我的模块' && <div className="border-t border-slate-100 p-3"><button type="button" onClick={onManageFavorites} className="h-9 w-full rounded-md border border-amber-300 bg-amber-50 text-xs font-semibold text-amber-800 hover:bg-amber-100">管理我的模块</button></div>}
    {modules.length === 0 && visibleFavorites.length === 0 && <div className="px-4 py-10 text-center text-xs text-slate-400">没有找到符合条件的模块</div>}
  </div>
}
