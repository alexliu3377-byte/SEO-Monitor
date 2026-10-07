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

type PixelProperty = 'width' | 'height' | 'margin-left' | 'margin-right' | 'gap'

function renderedPixelValue(component: Component, property: PixelProperty) {
  const element = component.getEl()
  const view = element?.ownerDocument.defaultView
  const raw = element && view ? view.getComputedStyle(element).getPropertyValue(property) : String(component.getStyle()[property] || '')
  const value = Number.parseFloat(raw)
  if (Number.isFinite(value)) return String(Math.round(value * 10) / 10)
  return ['gap', 'margin-left', 'margin-right'].includes(property) ? '0' : ''
}

function findNumberGroup(component: Component | null) {
  let current = component
  while (current) {
    if (current.getAttributes()['data-studio-number-group']) return current
    current = current.parent() ?? null
  }
  return null
}

const NUMBER_PRESETS = {
  top3: { end: 3, featured: '#f97316', normal: '#f1f5f9', normalText: '#475569' },
  top5: { end: 5, featured: '#2563eb', normal: '#f1f5f9', normalText: '#475569' },
  same: { end: 10, featured: '#475569', normal: '#475569', normalText: '#ffffff' },
} as const

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
  const numberGroup = findNumberGroup(component)

  const apply = (style: Record<string, string>) => component.addStyle(style)
  const tagName = String(component.get('tagName') || '').toLowerCase()
  const isImage = tagName === 'img'
  const isLink = tagName === 'a'
  const isEditableText = component.is('text') || ['p', 'span', 'strong', 'h1', 'h2', 'h3', 'h4', 'a', 'button'].includes(tagName)
  const hasMultipleChildren = component.components().length > 1
  const selectedElement = component.getEl()
  const visibleText = selectedElement?.textContent ?? String(component.get('content') || '')

  function uploadImage(file?: File) {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => component.addAttributes({ src: String(reader.result || '') })
    reader.readAsDataURL(file)
  }

  function applyPixels(property: PixelProperty, rawValue: string) {
    if (rawValue === '') {
      component.removeStyle(property)
      return
    }
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    apply({ [property]: `${Math.max(0, Math.min(4000, value))}px` })
  }

  function removeImage() {
    if (!isImage || component.get('removable') === false) return
    const parent = component.parent()
    component.remove()
    if (parent) editor?.select(parent)
  }

  function updateNumbers(options: { preset?: keyof typeof NUMBER_PRESETS; selected?: number; featured?: string; normal?: string; selectedColor?: string }) {
    if (!numberGroup) return
    const attributes = numberGroup.getAttributes()
    const presetName = options.preset ?? (String(attributes['data-studio-number-group'] || 'top3') as keyof typeof NUMBER_PRESETS)
    const preset = NUMBER_PRESETS[presetName] ?? NUMBER_PRESETS.top3
    const selectedNumber = options.selected ?? Number(attributes['data-studio-selected-number'] || 1)
    const featuredColor = options.featured ?? (options.preset ? preset.featured : String(attributes['data-studio-featured-color'] || preset.featured))
    const normalColor = options.normal ?? (options.preset ? preset.normal : String(attributes['data-studio-normal-color'] || preset.normal))
    const selectedColor = options.selectedColor ?? String(attributes['data-studio-selected-color'] || '#059669')
    numberGroup.addAttributes({
      'data-studio-number-group': presetName,
      'data-studio-selected-number': String(selectedNumber),
      'data-studio-featured-color': featuredColor,
      'data-studio-normal-color': normalColor,
      'data-studio-selected-color': selectedColor,
    })
    numberGroup.components().forEach((child: Component) => {
      const number = Number(child.getAttributes()['data-studio-number'])
      if (!number) return
      const isSelected = number === selectedNumber
      const isFeatured = number <= preset.end
      const background = isSelected ? selectedColor : isFeatured ? featuredColor : normalColor
      child.addStyle({
        background,
        color: isSelected || isFeatured || presetName === 'same' ? '#ffffff' : preset.normalText,
        border: isSelected ? `2px solid ${selectedColor}` : '1px solid #cbd5e1',
        'box-shadow': isSelected ? '0 0 0 3px #a7f3d0' : 'none',
      })
    })
  }

  return (
    <div className="bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-[10px] font-medium text-slate-400">当前选择</p>
        <p className="mt-1 truncate font-mono text-xs font-semibold text-slate-800" title={labelFor(component)}>{labelFor(component)}</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">下面的设置只改当前选中的元素，适合快速调整。</p>
      </div>

      {isImage ? <div className="border-b border-blue-100 bg-blue-50 px-3 py-3">
        <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-blue-900">图片设置</p><button type="button" onClick={removeImage} className="h-7 rounded-md border border-red-200 bg-white px-2.5 text-[11px] font-medium text-red-600 hover:bg-red-50">删除图片</button></div>
        <label className="mt-2 flex h-9 cursor-pointer items-center justify-center rounded-md border border-blue-200 bg-white px-3 text-xs font-medium text-blue-700 hover:bg-blue-100">从电脑选择图片<input type="file" accept="image/*" onChange={event => uploadImage(event.target.files?.[0])} className="sr-only" /></label>
        <label className="mt-2 block text-[11px] font-medium text-blue-900">或者粘贴图片网址<input value={String(component.getAttributes().src || '')} onChange={event => component.addAttributes({ src: event.target.value })} placeholder="https://…" className="mt-1 h-9 w-full rounded-md border border-blue-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400" /></label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([['宽度', 'width'], ['高度', 'height'], ['图片前间距', 'margin-left'], ['图片后间距', 'margin-right']] as const).map(([label, property]) => <label key={property} className="text-[10px] font-semibold text-blue-900">{label}<span className="ml-0.5 font-normal text-blue-500">px</span><input type="number" min="0" max="4000" step="1" value={renderedPixelValue(component, property)} onChange={event => applyPixels(property, event.target.value)} className="mt-1 h-9 w-full rounded-md border border-blue-200 bg-white px-2 text-xs tabular-nums text-slate-800 outline-none focus:border-blue-500" /></label>)}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5"><button type="button" onClick={() => apply({ height: 'auto' })} className="h-8 rounded-md border border-blue-200 bg-white text-[11px] text-blue-700 hover:bg-blue-100">按原比例</button><button type="button" onClick={() => { ['width', 'height', 'margin-left', 'margin-right'].forEach(property => component.removeStyle(property)) }} className="h-8 rounded-md border border-blue-200 bg-white text-[11px] text-blue-700 hover:bg-blue-100">恢复自动尺寸</button></div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">{([['完整显示', 'contain'], ['填满裁切', 'cover'], ['拉伸', 'fill']] as const).map(([label, value]) => <button key={value} type="button" onClick={() => apply({ 'object-fit': value })} className="h-8 rounded-md border border-blue-200 bg-white text-[11px] text-blue-700 hover:bg-blue-100">{label}</button>)}</div>
      </div> : null}

      {isEditableText ? <div className="border-b border-slate-100 px-3 py-3"><label className="block text-[11px] font-semibold text-slate-600">文字内容<textarea value={visibleText} onChange={event => component.components(event.target.value)} rows={3} className="mt-2 w-full resize-y rounded-md border border-slate-300 bg-white p-2 text-sm leading-5 text-slate-800 outline-none focus:border-emerald-500" /></label>{isLink && <label className="mt-3 block text-[11px] font-semibold text-slate-600">点击后前往<input value={String(component.getAttributes().href || '')} onChange={event => component.addAttributes({ href: event.target.value })} placeholder="https://… 或 /页面地址" className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-emerald-500" /></label>}</div> : null}

      {!isImage && !isEditableText ? <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-600">先选中模块里面的文字或图片，就能直接修改内容；要改整个模块的大小和背景，则选中外框。</div> : null}

      {!isImage && hasMultipleChildren ? <div className="border-b border-emerald-100 bg-emerald-50/60 px-3 py-3">
        <label className="block text-[11px] font-semibold text-emerald-900">内容间距 <span className="font-normal text-emerald-600">px</span><input type="number" min="0" max="4000" step="1" value={renderedPixelValue(component, 'gap')} onChange={event => applyPixels('gap', event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-emerald-200 bg-white px-2 text-xs tabular-nums text-slate-800 outline-none focus:border-emerald-500" /></label>
        <p className="mt-1.5 text-[10px] leading-4 text-emerald-700">控制这一行内部图片、标题和日期之间的距离。</p>
        <div className="mt-2 grid grid-cols-4 gap-1.5">{[0, 8, 16, 24].map(value => <button key={value} type="button" onClick={() => applyPixels('gap', String(value))} className="h-8 rounded-md border border-emerald-200 bg-white text-[11px] text-emerald-800 hover:bg-emerald-100">{value}</button>)}</div>
      </div> : null}

      {numberGroup ? <div className="border-b border-emerald-100 bg-emerald-50/60 px-3 py-3">
        <p className="text-xs font-semibold text-emerald-950">数字显示规则</p>
        <p className="mt-1 text-[11px] leading-4 text-emerald-800">排名颜色与当前选中颜色可以分别设置。</p>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {([['前 3 不同色', 'top3'], ['前 5 不同色', 'top5'], ['10 个同色', 'same']] as const).map(([label, value]) => <button key={value} type="button" onClick={() => updateNumbers({ preset: value })} className="h-9 rounded-md border border-emerald-200 bg-white px-1 text-[11px] font-medium text-emerald-800 hover:border-emerald-500 hover:bg-emerald-100">{label}</button>)}
        </div>
        <label className="mt-3 block text-[11px] font-semibold text-slate-600">当前选中数字
          <select value={String(numberGroup.getAttributes()['data-studio-selected-number'] || '1')} onChange={event => updateNumbers({ selected: Number(event.target.value) })} className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-emerald-500">
            {Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 个</option>)}
          </select>
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[['突出颜色', 'featured'], ['普通颜色', 'normal'], ['选中颜色', 'selectedColor']].map(([label, key]) => <label key={key} className="text-[10px] font-medium text-slate-600">{label}<input type="color" defaultValue={key === 'featured' ? '#f97316' : key === 'normal' ? '#f1f5f9' : '#059669'} onChange={event => updateNumbers({ [key]: event.target.value })} className="mt-1 block h-8 w-full cursor-pointer rounded border border-slate-300 bg-white p-0.5" /></label>)}
        </div>
      </div> : null}

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
