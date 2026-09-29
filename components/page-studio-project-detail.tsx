'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AppDialog from '@/components/app-dialog'
import {
  PageStudioProject,
  addPageStudioPage,
  copyPageDocument,
  downloadPageDocument,
  extractImportedCode,
  getPageStudioProject,
  savePageStudioProject,
} from '@/lib/page-studio'

export default function PageStudioProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [project, setProject] = useState<PageStudioProject | null | undefined>(undefined)
  const [showAddPage, setShowAddPage] = useState(false)
  const [pageName, setPageName] = useState('')
  const [targetDevice, setTargetDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [pageSource, setPageSource] = useState<'blank' | 'code'>('blank')
  const [pageHtml, setPageHtml] = useState('')
  const [pageCss, setPageCss] = useState('')
  const [removeImages, setRemoveImages] = useState(true)
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null)

  useEffect(() => setProject(getPageStudioProject(projectId)), [projectId])

  function openPage(pageId: string) {
    if (!project) return
    savePageStudioProject({ ...project, activePageId: pageId })
    router.push(`/page-studio/editor/${project.id}`)
  }

  function createPage() {
    if (!project || !pageName.trim()) return
    let draft = addPageStudioPage(project, pageName, targetDevice)
    if (pageSource === 'code') {
      const imported = extractImportedCode(pageHtml, pageCss, { removeImages })
      draft = { ...draft, pages: draft.pages.map(page => page.id === draft.activePageId ? { ...page, html: imported.html, css: imported.css } : page) }
    }
    const next = savePageStudioProject(draft)
    setProject(next)
    setShowAddPage(false)
    setPageName('')
    setTargetDevice('desktop')
    setPageSource('blank')
    setPageHtml('')
    setPageCss('')
    setRemoveImages(true)
  }

  function deletePage(pageId: string) {
    if (!project || project.pages.length <= 1) return
    const page = project.pages.find(item => item.id === pageId)
    if (!page || !window.confirm(`删除页面“${page.name}”？这份本地草稿将无法恢复。`)) return
    const pages = project.pages.filter(item => item.id !== pageId)
    const next = savePageStudioProject({
      ...project,
      pages,
      activePageId: project.activePageId === pageId ? pages[0].id : project.activePageId,
    })
    setProject(next)
  }

  async function copyCode(pageId: string) {
    if (!project) return
    const page = project.pages.find(item => item.id === pageId)
    if (!page) return
    await copyPageDocument(project, page)
    setCopiedPageId(pageId)
    window.setTimeout(() => setCopiedPageId(current => current === pageId ? null : current), 1800)
  }

  if (project === undefined) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500">正在读取项目…</div>
  }

  if (project === null) {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="text-center"><h1 className="text-lg font-semibold text-slate-900">找不到这个项目</h1><Link href="/page-studio" className="btn-primary mt-5">返回项目管理</Link></div></div>
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-[1380px] flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <nav aria-label="面包屑" className="flex items-center gap-2 text-xs text-slate-500"><Link href="/page-studio" className="hover:text-emerald-700">页面项目</Link><span>/</span><span className="text-slate-700">{project.name}</span></nav>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{project.name}</h1>
            <p className="mt-1 text-sm text-slate-500">选择要编辑的页面，像打开文件一样进入画布。</p>
          </div>
          <button type="button" onClick={() => setShowAddPage(true)} className="btn-primary">新增页面</button>
        </div>
      </header>

      <main className="mx-auto max-w-[1380px] p-5 sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <div><h2 className="text-sm font-semibold text-slate-950">页面文件</h2><p className="mt-0.5 text-xs text-slate-500">{project.pages.length} 个页面，代码分别导出。</p></div>
          <Link href="/page-studio" className="btn-ghost">返回全部项目</Link>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                <tr><th className="px-5 py-3">页面名称</th><th className="px-4 py-3">文件名</th><th className="px-4 py-3">主要设计端</th><th className="px-4 py-3">修改状态</th><th className="px-5 py-3 text-right">操作</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {project.pages.map(page => (
                  <tr key={page.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <button type="button" onClick={() => openPage(page.id)} className="flex items-center gap-3 text-left font-semibold text-slate-900 hover:text-emerald-700">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6m-6 4h6" /></svg></span>
                        <span className="truncate">{page.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{page.path}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{page.targetDevice === 'mobile' ? '手机端' : '电脑端'}</td>
                    <td className="px-4 py-3 text-sm">{page.baselineHtml !== undefined && (page.html !== page.baselineHtml || page.css !== page.baselineCss) ? <span className="font-medium text-amber-700">已有修改</span> : <span className="text-slate-400">未修改</span>}</td>
                    <td className="px-5 py-3"><div className="flex justify-end gap-2"><button type="button" onClick={() => openPage(page.id)} className="btn-ghost">编辑</button><button type="button" onClick={() => void copyCode(page.id)} className="btn-ghost">{copiedPageId === page.id ? '已复制' : '复制代码'}</button><button type="button" onClick={() => downloadPageDocument(project, page)} className="btn-ghost">下载</button>{project.pages.length > 1 && <button type="button" onClick={() => deletePage(page.id)} className="inline-flex min-h-11 items-center rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50">删除</button>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {showAddPage && <AppDialog title="新增页面" description="可以从空白开始，也可以直接粘贴这个页面的 HTML 与 CSS。" onClose={() => setShowAddPage(false)} width={pageSource === 'code' ? 'max-w-5xl' : 'max-w-lg'} footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setShowAddPage(false)} className="btn-secondary">取消</button><button type="button" disabled={!pageName.trim() || (pageSource === 'code' && !pageHtml.trim())} onClick={createPage} className="btn-primary">新增页面</button></div>}>
        <label className="block text-sm font-medium text-slate-700">页面名称<input autoFocus value={pageName} onChange={event => setPageName(event.target.value)} placeholder="例如：游戏下载页" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
        <fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">建立方式</legend><div className="mt-2 grid grid-cols-2 gap-3">{([['blank', '空白页面', '使用基础响应式模板'], ['code', '粘贴页面代码', '导入 HTML 与 CSS 后修改']] as const).map(([value, label, description]) => <label key={value} className={`cursor-pointer rounded-lg border p-4 ${pageSource === value ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}><input type="radio" name="page-source" value={value} checked={pageSource === value} onChange={() => setPageSource(value)} className="sr-only" /><span className="block text-sm font-semibold text-slate-900">{label}</span><span className="mt-1 block text-xs text-slate-500">{description}</span></label>)}</div></fieldset>
        <fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">主要设计尺寸</legend><div className="mt-2 grid grid-cols-2 gap-3">{([['desktop', '电脑端', '以宽屏页面为主要设计画布'], ['mobile', '手机端', '以 375px 手机页面开始设计']] as const).map(([value, label, description]) => <label key={value} className={`cursor-pointer rounded-lg border p-4 ${targetDevice === value ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}><input type="radio" name="target-device" value={value} checked={targetDevice === value} onChange={() => setTargetDevice(value)} className="sr-only" /><span className="block text-sm font-semibold text-slate-900">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></label>)}</div></fieldset>
        {pageSource === 'code' && <><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"><input type="checkbox" checked={removeImages} onChange={event => setRemoveImages(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600" /><span><span className="block text-sm font-semibold text-slate-900">替换原页面图片</span><span className="mt-0.5 block text-xs text-slate-600">保留图片标签、class 与尺寸，只替换图片内容。</span></span></label><div className="mt-5 grid gap-4 lg:grid-cols-2"><label className="block text-sm font-medium text-slate-700">HTML<textarea value={pageHtml} onChange={event => setPageHtml(event.target.value)} placeholder="粘贴完整页面 HTML" className="mt-2 h-64 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500" /></label><label className="block text-sm font-medium text-slate-700">CSS（可选）<textarea value={pageCss} onChange={event => setPageCss(event.target.value)} placeholder="依次粘贴页面使用的 CSS" className="mt-2 h-64 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500" /></label></div></>}
      </AppDialog>}
    </div>
  )
}
