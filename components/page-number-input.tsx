'use client'

import { useId, useState } from 'react'
import { resolvePageJump, validPageCount } from '@/lib/page-jump'

// Always one-based, regardless of whether the calling API uses zero or one.
// Draft edits stay local; only Enter invokes the page's existing paging action.
export function PageNumberInput({ page, totalPages, onChange, disabled = false, label = '跳转页码' }: {
  page: number
  totalPages: number
  onChange: (page: number) => void
  disabled?: boolean
  label?: string
}) {
  const pages = validPageCount(totalPages)
  const current = Math.max(1,Math.min(pages,Number.isFinite(page) ? Math.floor(page) : 1))
  const key = `${current}|${pages}|${disabled}`
  const [draft, setDraft] = useState<{ key: string; value: string } | null>(null)
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(null)
  const helpId = useId()
  const value = draft?.key === key ? draft.value : String(current)
  const unavailable = disabled || pages <= 1
  return (
    <span className="inline-flex items-center align-middle">
      <input aria-label={label} aria-describedby={helpId} data-page-number-input
        type="text" inputMode="numeric" autoComplete="off" maxLength={32}
        value={value} disabled={unavailable}
        title={`输入 1–${pages} 页，按 Enter 跳转`}
        style={{ width: `${Math.max(4,String(pages).length+2)}ch` }}
        className="h-7 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-center text-xs tabular-nums text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-50"
        onFocus={event => event.currentTarget.select()}
        onChange={event => { setDraft({key,value:event.target.value});setNotice(null) }}
        onBlur={() => setDraft(null)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            if (draft?.key === key) { event.preventDefault();event.stopPropagation();setDraft(null);setNotice(null) }
            return
          }
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (unavailable) return
          const next = resolvePageJump(value,pages)
          setDraft(null)
          if (next === null) {
            setNotice({key,text:`请输入整数页码，已恢复第 ${current} 页`})
            return
          }
          setNotice(null)
          if (next !== current) onChange(next)
        }} />
      <span id={helpId} className="sr-only">输入 1 至 {pages} 的整数页码后按 Enter 跳转，Esc 取消编辑。</span>
      <span role="status" aria-live="polite" className="sr-only">{notice?.key === key ? notice.text : ''}</span>
    </span>
  )
}
