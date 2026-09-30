'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Component, CssRule, Editor } from 'grapesjs'

type PseudoState = 'normal' | 'hover'
type RuleScope = 'element' | 'class'

function componentLabel(component: Component) {
  const attributes = component.getAttributes()
  const tag = String(component.get('tagName') || 'div').toLowerCase()
  const id = attributes.id ? `#${attributes.id}` : ''
  const classes = String(attributes.class || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(value => `.${value}`).join('')
  return `${tag}${id}${classes}`
}

function componentTrail(component: Component | null) {
  const result: Component[] = []
  let current = component
  while (current) {
    if (current.get('type') !== 'wrapper') result.unshift(current)
    current = current.parent() ?? null
  }
  return result
}

function hasInteractivePseudo(selector: string) {
  return /:(hover|active|focus|focus-visible|focus-within)\b/.test(selector)
}

function selectorForMatching(selector: string) {
  return selector.replace(/::[\w-]+/g, '').replace(/:(hover|active|focus|focus-visible|focus-within)\b/g, '')
}

function ruleMatchesElement(rule: CssRule, element: HTMLElement, state: PseudoState) {
  const selector = rule.selectorsToString()
  if (!selector || selector.startsWith('@')) return false
  if (state === 'hover' ? !selector.includes(':hover') : hasInteractivePseudo(selector)) return false
  return selector.split(',').some(part => {
    try {
      return element.matches(selectorForMatching(part.trim()))
    } catch {
      return false
    }
  })
}

function simpleClassSelector(component: Component) {
  const className = String(component.getAttributes().class || '').trim().split(/\s+/).find(Boolean)
  if (className) return `.${className.replace(/[^a-zA-Z0-9_-]/g, '')}`
  return String(component.get('tagName') || 'div').toLowerCase()
}

function elementSelector(component: Component) {
  return `#${component.getId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function displayValue(value: unknown) {
  if (Array.isArray(value)) return value.join(' ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '')
}

function colorInputValue(value: string) {
  const shortHex = value.trim().match(/^#([\da-f])([\da-f])([\da-f])$/i)
  if (shortHex) return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`
  const fullHex = value.trim().match(/^#[\da-f]{6}$/i)
  if (fullHex) return fullHex[0]
  const rgb = value.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i)
  if (!rgb) return '#000000'
  return `#${[rgb[1], rgb[2], rgb[3]].map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0')).join('')}`
}

function BoxModel({ element, revision }: { element?: HTMLElement; revision: number }) {
  const values = useMemo(() => {
    if (!element) return null
    const computed = element.ownerDocument.defaultView?.getComputedStyle(element)
    if (!computed) return null
    return {
      margin: [computed.marginTop, computed.marginRight, computed.marginBottom, computed.marginLeft],
      border: [computed.borderTopWidth, computed.borderRightWidth, computed.borderBottomWidth, computed.borderLeftWidth],
      padding: [computed.paddingTop, computed.paddingRight, computed.paddingBottom, computed.paddingLeft],
      size: `${Math.round(element.getBoundingClientRect().width)} × ${Math.round(element.getBoundingClientRect().height)}`,
    }
  }, [element, revision])

  if (!values) return null
  const layer = (label: string, entries: string[], tone: string, children?: React.ReactNode) => (
    <div className={`relative border px-8 py-5 text-[10px] ${tone}`}>
      <span className="absolute left-1.5 top-1 text-slate-500">{label}</span>
      <span className="absolute left-1/2 top-0.5 -translate-x-1/2">{entries[0]}</span>
      <span className="absolute right-1 top-1/2 -translate-y-1/2">{entries[1]}</span>
      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2">{entries[2]}</span>
      <span className="absolute left-1 top-1/2 -translate-y-1/2">{entries[3]}</span>
      {children}
    </div>
  )

  return (
    <section className="border-b border-slate-200 p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">盒模型</h3>
      {layer('margin', values.margin, 'border-amber-200 bg-amber-50', layer('border', values.border, 'border-orange-200 bg-orange-50', layer('padding', values.padding, 'border-sky-200 bg-sky-50', <div className="flex h-9 items-center justify-center rounded border border-sky-300 bg-white font-mono text-[11px] text-slate-700">{values.size}</div>)))}
    </section>
  )
}

function PropertyRow({ name, value, onChange, onRemove }: { name: string; value: string; onChange: (value: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(value)
  const isColor = name.includes('color')
  useEffect(() => setDraft(value), [value])
  return (
    <div className="group grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_24px] items-center gap-1 border-t border-slate-100 px-2 py-1 first:border-t-0">
      <span className="truncate font-mono text-[11px] text-violet-700" title={name}>{name}</span>
      <div className="flex min-w-0 items-center">
        {isColor ? <input type="color" value={colorInputValue(draft)} onChange={event => { setDraft(event.target.value); onChange(event.target.value) }} className="mr-1 h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`${name} 颜色选择器`} /> : null}
        <input value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => draft !== value && onChange(draft)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 font-mono text-[11px] text-slate-800 hover:border-slate-300 focus:border-emerald-500 focus:bg-white focus:outline-none" aria-label={`${name} 的值`} />
      </div>
      <button type="button" onClick={onRemove} className="h-6 rounded text-slate-300 hover:bg-red-50 hover:text-red-600" title={`删除 ${name}`} aria-label={`删除 ${name}`}>×</button>
    </div>
  )
}

function RuleCard({ rule, onChanged }: { rule: CssRule; onChanged: () => void }) {
  const entries = Object.entries(rule.getStyle()).map(([name, value]) => [name, displayValue(value)] as const)
  return (
    <section className="border-b border-slate-200 bg-white py-2">
      <div className="flex items-start gap-2 px-2 pb-1.5">
        <code className="min-w-0 flex-1 break-all text-[11px] leading-4 text-slate-800">{rule.selectorsToString()}</code>
        {rule.getAtRule() ? <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[9px] text-sky-700" title={rule.getAtRule()}>媒体</span> : null}
      </div>
      <div className="mx-2 overflow-hidden rounded border border-slate-200">
        {entries.length ? entries.map(([name, value]) => <PropertyRow key={name} name={name} value={value} onChange={next => { rule.addStyle(name, next); onChanged() }} onRemove={() => { rule.removeStyle(name); onChanged() }} />) : <p className="px-2 py-2 text-[11px] text-slate-400">这条规则没有声明</p>}
      </div>
    </section>
  )
}

export default function PageStudioDevtools({ editor }: { editor: Editor | null }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<PseudoState>('normal')
  const [scope, setScope] = useState<RuleScope>('element')
  const [property, setProperty] = useState('')
  const [propertyValue, setPropertyValue] = useState('')

  useEffect(() => {
    if (!editor) return
    const refresh = () => setRevision(value => value + 1)
    editor.on('component:selected component:deselected update undo redo', refresh)
    return () => { editor.off('component:selected component:deselected update undo redo', refresh) }
  }, [editor])

  const selected = editor?.getSelected() ?? null
  const element = selected?.getEl() as HTMLElement | undefined
  const trail = useMemo(() => componentTrail(selected), [selected, revision])
  const rules = useMemo(() => {
    if (!editor || !element) return []
    return editor.Css.getRules().filter(rule => ruleMatchesElement(rule, element, state)).reverse()
  }, [editor, element, state, revision])

  useEffect(() => {
    if (!editor) return
    editor.SelectorManager.setState(state === 'normal' ? '' : state)
    const documentValue = editor.Canvas.getDocument()
    documentValue?.getElementById('page-studio-forced-state')?.remove()
    if (state !== 'hover' || !selected || !element || !documentValue) return
    const declarations: Record<string, string> = {}
    editor.Css.getRules().filter(rule => ruleMatchesElement(rule, element, 'hover')).forEach(rule => {
      Object.entries(rule.getStyle()).forEach(([name, value]) => { declarations[name] = displayValue(value) })
    })
    if (!Object.keys(declarations).length) return
    const style = documentValue.createElement('style')
    style.id = 'page-studio-forced-state'
    style.textContent = `${elementSelector(selected)} { ${Object.entries(declarations).map(([name, value]) => `${name}: ${value} !important;`).join(' ')} }`
    documentValue.head.appendChild(style)
    return () => style.remove()
  }, [editor, selected, element, state, revision])

  if (!editor || !selected || !element) return <div className="p-5 text-center text-xs leading-5 text-slate-500">在画布或左侧“页面结构”中选择一个元素，才能查看它的 CSS。</div>

  const targetBase = scope === 'element' ? elementSelector(selected) : simpleClassSelector(selected)
  const targetSelector = state === 'hover' ? `${targetBase}:hover` : targetBase
  const addProperty = () => {
    const name = property.trim().toLowerCase()
    const value = propertyValue.trim()
    if (!name || !value) return
    editor.Css.setRule(targetSelector, { [name]: value }, { addStyles: true })
    setProperty('')
    setPropertyValue('')
    setRevision(current => current + 1)
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <nav aria-label="当前元素层级" className="flex flex-wrap gap-1 border-b border-slate-200 bg-white p-2">
        {trail.map((component, index) => <button key={`${component.getId()}-${index}`} type="button" onClick={() => editor.select(component)} className={`max-w-full truncate rounded px-1.5 py-1 font-mono text-[10px] ${component === selected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{componentLabel(component)}</button>)}
      </nav>

      <div className="border-b border-slate-200 bg-white p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-md border border-slate-200 p-0.5">
            {([['normal', '普通'], ['hover', ':hover']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={state === value} onClick={() => setState(value)} className={`h-7 rounded px-2.5 text-[11px] font-medium ${state === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}
          </div>
          <select value={scope} onChange={event => setScope(event.target.value as RuleScope)} className="h-8 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700" aria-label="新增样式的作用范围">
            <option value="element">仅此元素</option>
            <option value="class">同类元素</option>
          </select>
        </div>
        <p className="mt-1.5 break-all font-mono text-[10px] text-slate-500">新增到 {targetSelector}</p>
      </div>

      <BoxModel element={element} revision={revision} />

      <div className="border-b border-slate-200 bg-white p-2">
        <p className="mb-1.5 text-[11px] font-semibold text-slate-700">新增 CSS 属性</p>
        <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_32px] gap-1">
          <input value={property} onChange={event => setProperty(event.target.value)} placeholder="属性，如 height" className="h-8 min-w-0 rounded border border-slate-300 px-2 font-mono text-[11px] outline-none focus:border-emerald-500" />
          <input value={propertyValue} onChange={event => setPropertyValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addProperty() }} placeholder="值，如 64px" className="h-8 min-w-0 rounded border border-slate-300 px-2 font-mono text-[11px] outline-none focus:border-emerald-500" />
          <button type="button" onClick={addProperty} disabled={!property.trim() || !propertyValue.trim()} className="h-8 rounded bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40" aria-label="添加 CSS 属性">+</button>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-2">
        <h3 className="text-[11px] font-semibold text-slate-700">匹配的 CSS 规则</h3>
        <span className="text-[10px] text-slate-500">{rules.length} 条 · 后声明在前</span>
      </div>
      {rules.length ? rules.map((rule, index) => <RuleCard key={`${rule.cid}-${index}`} rule={rule} onChanged={() => setRevision(value => value + 1)} />) : <div className="p-4 text-center text-[11px] leading-5 text-slate-500">当前状态没有匹配规则。可在上方直接新增属性。</div>}
    </div>
  )
}
