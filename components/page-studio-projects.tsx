'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import AppDialog from '@/components/app-dialog'
import {
  PageStudioProject,
  createPageStudioProject,
  deletePageStudioProject,
  downloadPageDocument,
  extractImportedCode,
  loadPageStudioProjects,
  readPageStudioProjects,
  savePageStudioProject,
} from '@/lib/page-studio'

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value)).replaceAll('/', '-')
}

export default function PageStudioProjects() {
  const router = useRouter()
  const [projects, setProjects] = useState<PageStudioProject[]>([])
  const [dialog, setDialog] = useState<'blank' | 'import' | 'ai' | null>(null)
  const [name, setName] = useState('')
  const [html, setHtml] = useState('')
  const [css, setCss] = useState('')
  const [removeImages, setRemoveImages] = useState(true)
  const [storageError, setStorageError] = useState('')
  const [loading, setLoading] = useState(true)
  const [aiDescription, setAiDescription] = useState('')
  const [aiDevice, setAiDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    let active = true
    loadPageStudioProjects()
      .then(items => { if (active) setProjects(items) })
      .catch(error => {
        if (!active) return
        setProjects(readPageStudioProjects())
        setStorageError(error instanceof Error ? error.message : '页面设计资料读取失败')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects]
  )

  async function createProject(importCode: boolean) {
    const code = importCode ? extractImportedCode(html, css, { removeImages }) : undefined
    const project = createPageStudioProject(name, code?.html, code?.css)
    let saved: PageStudioProject
    try {
      saved = await savePageStudioProject(project)
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '项目保存失败')
      return
    }
    setProjects(current => [saved, ...current])
    setDialog(null)
    setName('')
    setHtml('')
    setCss('')
    setRemoveImages(true)
    router.push(`/page-studio/editor/${saved.id}`)
  }

  async function removeProject(project: PageStudioProject) {
    if (!window.confirm(`删除“${project.name}”？数据库中的这份草稿将无法恢复。`)) return
    try {
      await deletePageStudioProject(project.id)
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '项目删除失败')
      return
    }
    setProjects(current => current.filter(item => item.id !== project.id))
  }

  async function generateProject() {
    if (aiDescription.trim().length < 10) return
    setGenerating(true)
    setStorageError('')
    try {
      const response = await fetch('/api/page-studio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiDescription, device: aiDevice }),
      })
      const data = await response.json() as { page?: { name?: string; html: string; css: string }; error?: string }
      if (!response.ok || !data.page) throw new Error(data.error || 'AI 生成失败')
      const code = extractImportedCode(data.page.html, data.page.css, { removeImages: true })
      const draft = createPageStudioProject(name || data.page.name || 'AI 页面初稿', code.html, code.css)
      const project = aiDevice === 'mobile'
        ? { ...draft, pages: draft.pages.map(page => ({ ...page, targetDevice: 'mobile' as const })) }
        : draft
      const saved = await savePageStudioProject(project, { createVersion: true, label: 'AI 生成初稿' })
      setProjects(current => [saved, ...current])
      setDialog(null)
      setName('')
      setAiDescription('')
      router.push(`/page-studio/editor/${saved.id}`)
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'AI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-[1380px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-emerald-700">简易页面搭建器</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">页面项目</h1>
            <p className="mt-1 text-sm text-slate-500">选择现成模块、替换内容和调整布局，再交给前端实现。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDialog('ai')} className="btn-secondary">AI 生成初稿</button>
            <button type="button" onClick={() => setDialog('import')} className="btn-secondary">粘贴页面代码</button>
            <button type="button" onClick={() => setDialog('blank')} className="btn-primary">新建空白项目</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1380px] p-5 sm:p-8">
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between"><span><strong>保存位置：</strong>Supabase 云端数据库。</span><span className="text-xs text-emerald-700">本机旧资料会在首次打开时自动导入。</span></div>
        {storageError && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{storageError}</div>}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">我的项目</h2>
              <p className="mt-0.5 text-xs text-slate-500">完成后可直接删除，不影响网站线上页面。</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{sortedProjects.length} 个</span>
          </div>

          {loading ? <div className="flex min-h-72 items-center justify-center text-sm text-slate-500">正在从数据库读取项目…</div> : sortedProjects.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-5 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM8 9h8M8 13h5" /></svg>
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">还没有页面项目</h3>
              <p className="mt-1 max-w-md text-sm text-slate-500">可以从空白模板开始，也可以粘贴你有权使用的 HTML 与 CSS 再进行修改。</p>
              <button type="button" onClick={() => setDialog('blank')} className="btn-primary mt-5">建立第一个项目</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr><th className="px-5 py-3">项目名称</th><th className="px-4 py-3">页面</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">最后修改</th><th className="px-5 py-3 text-right">操作</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedProjects.map(project => {
                    const activePage = project.pages.find(page => page.id === project.activePageId) ?? project.pages[0]
                    return (
                      <tr key={project.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3"><Link href={`/page-studio/projects/${project.id}`} className="font-semibold text-slate-900 hover:text-emerald-700">{project.name}</Link><p className="mt-0.5 text-xs text-slate-400">{project.id}</p></td>
                        <td className="px-4 py-3 text-sm text-slate-600">{project.pages.length} 页</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${project.status === 'exported' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{project.status === 'exported' ? '已导出' : '草稿'}</span></td>
                        <td className="px-4 py-3 text-sm text-slate-500">{formatTime(project.updatedAt)}</td>
                        <td className="px-5 py-3"><div className="flex justify-end gap-2"><Link href={`/page-studio/projects/${project.id}`} className="btn-ghost">打开</Link><button type="button" onClick={() => activePage && downloadPageDocument(project, activePage)} className="btn-ghost">导出首页</button><button type="button" onClick={() => void removeProject(project)} className="inline-flex min-h-11 items-center rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50">删除</button></div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {dialog && dialog !== 'ai' && (
        <AppDialog
          title={dialog === 'import' ? '粘贴页面代码' : '新建空白项目'}
          description={dialog === 'import' ? '支持完整 HTML 文件或页面主体代码。脚本、追踪代码和外部样式导入会被移除。' : '从一个适合电脑和手机的基础页面开始。'}
          onClose={() => setDialog(null)}
          width={dialog === 'import' ? 'max-w-4xl' : 'max-w-lg'}
          footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" onClick={() => void createProject(dialog === 'import')} className="btn-primary">建立并进入编辑</button></div>}
        >
          <label className="block text-sm font-medium text-slate-700">项目名称<input value={name} onChange={event => setName(event.target.value)} placeholder="例如：游戏专题页改版" className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
          {dialog === 'import' && <><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"><input type="checkbox" checked={removeImages} onChange={event => setRemoveImages(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span><span className="block text-sm font-semibold text-slate-900">替换原页面图片（建议）</span><span className="mt-0.5 block text-xs leading-5 text-slate-600">保留原来的图片标签、class、宽高和圆角，只把图片内容及 CSS 背景图换成占位内容，之后再替换成自己的图片。</span></span></label><div className="mt-5 grid gap-4 lg:grid-cols-2"><label className="block text-sm font-medium text-slate-700">HTML<textarea value={html} onChange={event => setHtml(event.target.value)} placeholder="粘贴完整页面 HTML" className="mt-2 h-72 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500" /></label><label className="block text-sm font-medium text-slate-700">CSS（可选）<textarea value={css} onChange={event => setCss(event.target.value)} placeholder="粘贴 CSS；HTML 内的 style 也会自动提取" className="mt-2 h-72 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-emerald-500" /></label></div></>}
        </AppDialog>
      )}
      {dialog === 'ai' && <AppDialog title="AI 生成页面初稿" description="说明用途、主要内容、区块和视觉偏好；生成后会直接进入画布继续修改。" onClose={() => !generating && setDialog(null)} width="max-w-2xl" closeOnBackdrop={!generating} footer={<div className="flex justify-end gap-2"><button type="button" disabled={generating} onClick={() => setDialog(null)} className="btn-secondary">取消</button><button type="button" disabled={generating || aiDescription.trim().length < 10} onClick={() => void generateProject()} className="btn-primary">{generating ? '正在生成…' : '生成并进入画布'}</button></div>}><label className="block text-sm font-medium text-slate-700">项目名称（可选）<input value={name} onChange={event => setName(event.target.value)} placeholder="AI 会根据描述自动命名" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500" /></label><fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">页面端</legend><div className="mt-2 grid grid-cols-2 gap-3">{([['desktop', 'PC 端 1440px'], ['mobile', 'M 端 375px']] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-lg border px-4 py-3 text-sm font-semibold ${aiDevice === value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200'}`}><input type="radio" checked={aiDevice === value} onChange={() => setAiDevice(value)} className="sr-only" />{label}</label>)}</div></fieldset><label className="mt-5 block text-sm font-medium text-slate-700">页面要求<textarea autoFocus value={aiDescription} onChange={event => setAiDescription(event.target.value)} placeholder="例如：做一个手机游戏专题首页，包含顶部导航、推荐游戏、最新资讯和下载引导…" className="mt-2 h-44 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-emerald-500" /></label><p className="mt-3 text-xs leading-5 text-slate-500">AI 只生成 HTML/CSS，不会执行脚本；图片会先转为占位内容。</p></AppDialog>}
    </div>
  )
}
