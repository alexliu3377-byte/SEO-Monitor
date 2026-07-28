'use client'

import { useState, useEffect, useCallback } from 'react'

interface CookieEntry { name: string; value: string }

function parseBlockToCookieString(raw: string): string {
  const pairs: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.includes('\t')) {
      const cols = trimmed.split('\t')
      const n = cols[0]?.trim(); const v = cols[1]?.trim()
      if (n && v) pairs.push(`${n}=${v}`)
    } else if (trimmed.includes('=')) {
      pairs.push(trimmed)
    }
  }
  return pairs.join('; ')
}

// Self-contained button + modal for managing the shared Baidu 收录抓取 cookie 池
// (app_settings.baidu_index_cookie). Any logged-in user can view and edit —
// there's no admin-only gate on /api/settings for this key, so this is safe
// to surface anywhere in the app (originally only on the admin-only 抓取日志
// page; moved/duplicated here so all team members can help keep it fresh).
export function BaiduCookiePoolManager() {
  const [cookieUpdatedAt, setCookieUpdatedAt] = useState<string | null>(null)
  const [cookiePool, setCookiePool] = useState<CookieEntry[]>([])
  const [showModal, setShowModal] = useState(false)
  const [newCookieName, setNewCookieName] = useState('')
  const [newCookieInput, setNewCookieInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const fetchPool = useCallback(async () => {
    const res = await fetch('/api/settings?key=baidu_index_cookie')
    if (!res.ok) return
    const d = await res.json()
    setCookieUpdatedAt(d.updated_at ?? null)
    if (!d.value) return
    try {
      const pool = JSON.parse(d.value)
      if (Array.isArray(pool) && pool.length > 0) {
        if (typeof pool[0] === 'string') {
          setCookiePool(pool.map((v: string, i: number) => ({ name: `Cookies ${i + 1}`, value: v })))
        } else {
          setCookiePool(pool)
        }
      }
    } catch { setCookiePool([]) }
  }, [])

  useEffect(() => { fetchPool() }, [fetchPool])

  function nextCookieName(): string {
    const nums = cookiePool
      .map(e => e.name.match(/^Cookies\s+(\d+)$/i))
      .filter(Boolean).map(m => parseInt(m![1]))
    return `Cookies ${nums.length > 0 ? Math.max(...nums) + 1 : cookiePool.length + 1}`
  }

  async function saveCookie() {
    setSaving(true); setSaveMsg('')
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'baidu_index_cookie', value: JSON.stringify(cookiePool) }),
    })
    if (res.ok) {
      setCookieUpdatedAt(new Date().toISOString())
      setSaveMsg(`已保存 ${cookiePool.length} 个 Cookie`)
    } else { setSaveMsg('保存失败') }
    setSaving(false)
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {cookiePool.length > 0
            ? `百度收录 Cookie 池：${cookiePool.length} 个${cookieUpdatedAt ? ' · ' + new Date(cookieUpdatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : ''}`
            : '百度收录 Cookie 池未设置'}
        </span>
        <button
          onClick={() => { setShowModal(true); setSaveMsg('') }}
          className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-2 py-0.5 hover:border-blue-200 whitespace-nowrap"
        >
          管理 Cookie 池
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">百度收录 Cookie 轮换池</h3>
                <p className="text-xs text-gray-400 mt-0.5">每次定时抓取随机取一个账号的 Cookie；全体成员可维护</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {cookiePool.length > 0 && (
                <div className="space-y-2">
                  {cookiePool.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-xs font-medium text-gray-700 w-28 flex-shrink-0 truncate">{entry.name}</span>
                      <span className="text-xs text-gray-400 font-mono flex-1 truncate">{entry.value.slice(0, 60)}…</span>
                      <button
                        onClick={() => setCookiePool(prev => prev.filter((_, i) => i !== idx))}
                        className="text-gray-300 hover:text-red-400 flex-shrink-0 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="border border-dashed border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-xs font-medium text-gray-600">添加新账号 Cookie</p>
                <input
                  type="text"
                  value={newCookieName}
                  onChange={e => setNewCookieName(e.target.value)}
                  placeholder={nextCookieName()}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <textarea
                  value={newCookieInput}
                  onChange={e => { setNewCookieInput(e.target.value); setSaveMsg('') }}
                  placeholder={"从 Chrome DevTools → Application → Cookies 全选复制粘贴到这里\n（每行一个 cookie，Tab 分隔格式自动识别）"}
                  rows={7}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-700 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono resize-none"
                />
                {saveMsg && (
                  <p className={`text-xs ${saveMsg.includes('失败') || saveMsg.includes('重复') || saveMsg.includes('未识别') ? 'text-red-500' : 'text-green-600'}`}>
                    {saveMsg}
                  </p>
                )}
                <button
                  onClick={() => {
                    const value = parseBlockToCookieString(newCookieInput)
                    if (!value) { setSaveMsg('未识别到有效 Cookie，请检查格式'); return }
                    if (cookiePool.some(e => e.value === value)) { setSaveMsg('该 Cookie 已存在，请勿重复添加'); return }
                    const name = newCookieName.trim() || nextCookieName()
                    setCookiePool(prev => [...prev, { name, value }])
                    setNewCookieName(''); setNewCookieInput(''); setSaveMsg('')
                  }}
                  disabled={!newCookieInput.trim()}
                  className="w-full py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 disabled:opacity-40 transition-colors"
                >
                  添加到列表
                </button>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={saveCookie}
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                {saving ? '保存中…' : `保存（${cookiePool.length} 个）`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
