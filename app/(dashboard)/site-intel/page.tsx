'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserClient } from '@/lib/supabase'

export default function SiteIntelPage() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [notFound, setNotFound] = useState<string | null>(null)

  async function fetchSuggestions(raw: string) {
    const q = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
    if (!q) { setSuggestions([]); return }
    const supabase = getBrowserClient()
    const { data: rows } = await supabase.from('sites').select('domain').ilike('domain', `%${q}%`).limit(8)
    setSuggestions((rows || []).map((r: { domain: string }) => r.domain))
  }

  async function handleSearch(e?: React.FormEvent, domainOverride?: string) {
    e?.preventDefault()
    const d = (domainOverride ?? input).trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
    if (!d) return
    setShowSuggestions(false)
    setSuggestions([])
    setNotFound(null)

    setLoading(true)
    try {
      const supabase = getBrowserClient()
      const { data: siteRow } = await supabase.from('sites')
        .select('id').eq('domain', d).maybeSingle() as { data: { id: string } | null }

      if (siteRow?.id) {
        router.push(`/site-intel/${siteRow.id}`)
      } else {
        setNotFound(d)
      }
    } catch {
      setNotFound(d)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">站点情报</h1>
        <p className="text-gray-500 text-sm mt-1">搜索已追踪站点，查看权重、收录、关键词等完整数据</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3 mb-6 max-w-xl">
        <div className="relative flex-1">
          <label htmlFor="site-intel-search" className="sr-only">搜索站点域名</label>
          <input
            id="site-intel-search"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls="site-intel-suggestions"
            aria-activedescendant={highlightIdx >= 0 ? `site-intel-option-${highlightIdx}` : undefined}
            value={input}
            onChange={e => {
              setInput(e.target.value)
              setHighlightIdx(-1)
              setNotFound(null)
              fetchSuggestions(e.target.value)
              setShowSuggestions(true)
            }}
            onKeyDown={e => {
              if (!showSuggestions || suggestions.length === 0) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, -1)) }
              else if (e.key === 'Enter' && highlightIdx >= 0) {
                e.preventDefault()
                const chosen = suggestions[highlightIdx]
                setInput(chosen)
                setSuggestions([])
                setShowSuggestions(false)
                setHighlightIdx(-1)
                handleSearch(undefined, chosen)
              } else if (e.key === 'Escape') { setShowSuggestions(false) }
            }}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="输入域名关键字，如 game、apk…"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul id="site-intel-suggestions" role="listbox" className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
              {suggestions.map((s, i) => (
                <li
                  id={`site-intel-option-${i}`}
                  role="option"
                  aria-selected={i === highlightIdx}
                  key={s}
                  onMouseDown={() => {
                    setInput(s)
                    setSuggestions([])
                    setShowSuggestions(false)
                    handleSearch(undefined, s)
                  }}
                  className={`px-4 py-2 text-sm cursor-pointer ${i === highlightIdx ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '查询中…' : '查询'}
        </button>
      </form>

      {notFound && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
          <p className="text-gray-500 text-sm mb-3">
            <span className="font-medium text-gray-700">{notFound}</span> 未在追踪列表中
          </p>
          <p className="text-xs text-gray-400 mb-4">该站点尚未添加到监控系统，可前往爱站网查询基础数据</p>
          <a
            href={`https://www.aizhan.com/siteinfo/${notFound}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm hover:bg-blue-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            在爱站查询 {notFound}
          </a>
        </div>
      )}
    </div>
  )
}
