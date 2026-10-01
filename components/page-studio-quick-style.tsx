'use client'

import { useEffect, useState } from 'react'
import type { Component, Editor } from 'grapesjs'

const BACKGROUNDS = ['#ffffff', '#f8fafc', '#ecfdf5', '#eff6ff', '#fff7ed', '#0f172a']
const TEXT_COLORS = ['#0f172a', '#475569', '#047857', '#0369a1', '#c2410c', '#ffffff']

function labelFor(component: Component) {
  const attributes = component.getAttributes()
  const tag = String(component.get('tagName') || 'div').toLowerCase()
  const className = String(attributes.class || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
  return `${tag}${attributes.id ? `#${attributes.id}` : ''}${className ? `.${className}` : ''}`
}

function ChoiceRow({ title, choices, onChoose }: { title: string; choices: Array<{ label: string; value: string }>; onChoose: (value: string) => void }) {
  return <div className="border-b border-slate-100 px-3 py-3"><p className="mb-2 text-[11px] font-semibold text-slate-600">{title}</p><div className="grid grid-cols-4 gap-1.5">{choices.map(choice => <button key={choice.value} type="button" onClick={() => onChoose(choice.value)} className="h-8 rounded-md border border-slate-200 bg-white px-1 text-[11px] text-slate-700 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-800">{choice.label}</button>)}</div></div>
}

export default function PageStudioQuickStyle({ editor, onAdvanced }: { editor: Editor | null; onAdvanced: () => void }) {
  const [, setRevision] = useState(0)
  useEffect(() => {
    if (!editor) return
    const refresh = () => setRevision(value => value + 1)
    editor.on('component:selected component:deselected update undo redo', refresh)
    return () => { editor.off('component:selected component:deselected update undo redo', refresh) }
  }, [editor])

  const selected = editor?.getSelected() ?? null
  if (!editor || !selected) return <div className="p-6 text-center text-xs leading-5 text-slate-500">先点击画布中的文字、图片或区块，这里会出现常用修改按钮。</div>
  const component = selected

  const apply = (style: Record<string, string>) => component.addStyle(style)
  const tagName = String(component.get('tagName') || '').toLowerCase()
  const isImage = tagName === 'img'
  const isLink = tagName === 'a'
  const isEditableText = component.is('text') || ['p', 'span', 'strong', 'h1', 'h2', 'h3', 'h4', 'a', 'button'].includes(tagName)
  const selectedElement = component.getEl()
  const visibleText = selectedElement?.textContent ?? String(component.get('content') || '')

  function uploadImage(file?: File) {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => component.addAttributes({ src: String(reader.result || '') })
    reader.readAsDataURL(file)
  }

  return (
    <div className="bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-[10px] font-medium text-slate-400">当前选择</p>
        <p className="mt-1 truncate font-mono text-xs font-semibold text-slate-800" title={labelFor(component)}>{labelFor(component)}</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">下面的设置只改当前选中的元素，适合快速调整。</p>
      </div>

      {isImage ? <div className="border-b border-blue-100 bg-blue-50 px-3 py-3"><p className="text-xs font-semibold text-blue-900">替换图片或 Logo</p><label className="mt-2 flex h-9 cursor-pointer items-center justify-center rounded-md border border-blue-200 bg-white px-3 text-xs font-medium text-blue-700 hover:bg-blue-100">从电脑选择图片<input type="file" accept="image/*" onChange={event => uploadImage(event.target.files?.[0])} className="sr-only" /></label><label className="mt-2 block text-[11px] font-medium text-blue-900">或者粘贴图片网址<input value={String(component.getAttributes().src || '')} onChange={event => component.addAttributes({ src: event.target.value })} placeholder="https://…" className="mt-1 h-9 w-full rounded-md border border-blue-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400" /></label><div className="mt-2 grid grid-cols-3 gap-1.5">{([['完整显示', 'contain'], ['填满裁切', 'cover'], ['拉伸', 'fill']] as const).map(([label, value]) => <button key={value} type="button" onClick={() => apply({ 'object-fit': value })} className="h-8 rounded-md border border-blue-200 bg-white text-[11px] text-blue-700 hover:bg-blue-100">{label}</button>)}</div></div> : null}

      {isEditableText ? <div className="border-b border-slate-100 px-3 py-3"><label className="block text-[11px] font-semibold text-slate-600">文字内容<textarea value={visibleText} onChange={event => component.components(event.target.value)} rows={3} className="mt-2 w-full resize-y rounded-md border border-slate-300 bg-white p-2 text-sm leading-5 text-slate-800 outline-none focus:border-emerald-500" /></label>{isLink && <label className="mt-3 block text-[11px] font-semibold text-slate-600">点击后前往<input value={String(component.getAttributes().href || '')} onChange={event => component.addAttributes({ href: event.target.value })} placeholder="https://… 或 /页面地址" className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-emerald-500" /></label>}</div> : null}

      {!isImage && !isEditableText ? <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-600">先选中模块里面的文字或图片，就能直接修改内容；要改整个模块的大小和背景，则选中外框。</div> : null}

      <ChoiceRow title="宽度" choices={[{ label: '自动', value: 'auto' }, { label: '1/3', value: '33.333%' }, { label: '一半', value: '50%' }, { label: '全宽', value: '100%' }]} onChoose={value => apply({ width: value, 'max-width': value === 'auto' ? 'none' : value })} />
      <ChoiceRow title="高度" choices={[{ label: '自动', value: 'auto' }, { label: '小 44', value: '44px' }, { label: '中 64', value: '64px' }, { label: '大 96', value: '96px' }]} onChoose={value => apply({ height: value })} />
      <ChoiceRow title="内部留白" choices={[{ label: '无', value: '0' }, { label: '紧凑', value: '8px' }, { label: '正常', value: '16px' }, { label: '宽松', value: '24px' }]} onChoose={value => apply({ padding: value })} />
      <ChoiceRow title="外部间距" choices={[{ label: '无', value: '0' }, { label: '小', value: '8px' }, { label: '中', value: '16px' }, { label: '大', value: '24px' }]} onChoose={value => apply({ margin: value })} />
      <ChoiceRow title="圆角" choices={[{ label: '直角', value: '0' }, { label: '小', value: '6px' }, { label: '圆润', value: '12px' }, { label: '圆形', value: '999px' }]} onChoose={value => apply({ 'border-radius': value })} />
      <ChoiceRow title="对齐" choices={[{ label: '左', value: 'left' }, { label: '居中', value: 'center' }, { label: '右', value: 'right' }, { label: '两端', value: 'justify' }]} onChoose={value => apply({ 'text-align': value })} />

      <div className="border-b border-slate-100 px-3 py-3">
        <p className="mb-2 text-[11px] font-semibold text-slate-600">背景颜色</p>
        <div className="flex items-center gap-2">{BACKGROUNDS.map(color => <button key={color} type="button" onClick={() => apply({ 'background-color': color })} className="h-8 w-8 rounded-md border border-slate-300 shadow-sm" style={{ backgroundColor: color }} title={color} aria-label={`背景颜色 ${color}`} />)}<input type="color" onChange={event => apply({ 'background-color': event.target.value })} className="h-8 w-8 cursor-pointer rounded border border-slate-300 bg-white p-0.5" aria-label="自选背景颜色" /></div>
      </div>

      <div className="border-b border-slate-100 px-3 py-3">
        <p className="mb-2 text-[11px] font-semibold text-slate-600">文字或图标颜色</p>
        <div className="flex items-center gap-2">{TEXT_COLORS.map(color => <button key={color} type="button" onClick={() => apply({ color })} className="h-8 w-8 rounded-md border border-slate-300 shadow-sm" style={{ backgroundColor: color }} title={color} aria-label={`文字颜色 ${color}`} />)}<input type="color" onChange={event => apply({ color: event.target.value })} className="h-8 w-8 cursor-pointer rounded border border-slate-300 bg-white p-0.5" aria-label="自选文字颜色" /></div>
      </div>

      <div className="p-3">
        <button type="button" onClick={onAdvanced} className="h-9 w-full rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50">需要精确数值？打开高级 CSS</button>
      </div>
    </div>
  )
}
