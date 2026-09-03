'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { useUser } from '@/lib/user-context'
import type { UserRole } from '@/lib/user-context'

interface UserRecord {
  id: string
  email: string
  username: string | null
  role: UserRole
  created_at: string
}

interface RestrictedSite {
  id: string
  domain: string
  name: string
  focus_level: number
}

function useModalEscape(onClose: () => void) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener('keydown', handleKey)
      previous?.focus()
    }
  }, [])
}

// ─── Role badge ───────────────────────────────────────────────────────────────

const roleConfig: Record<UserRole, { label: string; className: string }> = {
  super:  { label: '超级',   className: 'bg-red-50 text-red-600 border border-red-200' },
  admin:  { label: '管理员', className: 'bg-blue-50 text-blue-600 border border-blue-200' },
  normal: { label: '普通',   className: 'bg-gray-50 text-gray-500 border border-gray-200' },
}

function RoleBadge({ role }: { role: UserRole }) {
  const { label, className } = roleConfig[role]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

// ─── Change password modal ────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  useModalEscape(onClose)
  const [newPwd, setNewPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (newPwd.length < 6) return setMsg({ type: 'error', text: '密码至少 6 位' })
    if (newPwd !== confirm) return setMsg({ type: 'error', text: '两次密码不一致' })
    setLoading(true)
    const supabase = getBrowserClient()
    const { error } = await supabase.auth.updateUser({ password: newPwd })
    setLoading(false)
    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      setMsg({ type: 'success', text: '密码修改成功' })
      setNewPwd(''); setConfirm('')
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="修改密码" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">修改密码</h3>
          <button type="button" onClick={onClose} aria-label="关闭修改密码窗口" className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">新密码</label>
            <input aria-label="输入密码" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required placeholder="至少 6 位"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">确认密码</label>
            <input aria-label="输入密码" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="再次输入"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          {msg && (
            <div className={`rounded-lg px-4 py-3 text-sm ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
              {msg.text}
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
            {loading ? '保存中...' : '保存密码'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Add user modal ───────────────────────────────────────────────────────────

function AddUserModal({ callerRole, onClose, onCreated }: {
  callerRole: UserRole
  onClose: () => void
  onCreated: (user: UserRecord) => void
}) {
  useModalEscape(onClose)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('normal')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const roleOptions: UserRole[] = callerRole === 'super' ? ['super', 'admin', 'normal'] : ['normal']

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!username.trim()) return setError('请填写用户名')
    setLoading(true)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), email, password, role }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) {
      setError(data.error ?? '创建失败')
    } else {
      onCreated(data.user)
      onClose()
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="新增账号" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">新增账号</h3>
          <button type="button" onClick={onClose} aria-label="关闭新增账号窗口" className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4"
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">用户名 <span className="text-red-500">*</span></label>
            <input aria-label="输入内容" type="text" value={username} onChange={e => setUsername(e.target.value)} required placeholder="登录时使用的用户名"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱（仅系统使用）</label>
            <input aria-label="输入电子邮箱" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="user@example.com"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">初始密码</label>
            <input aria-label="输入密码" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="至少 6 位"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">权限</label>
            <select aria-label="选择选项" value={role} onChange={e => setRole(e.target.value as UserRole)}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent">
              {roleOptions.map(r => (
                <option key={r} value={r}>{roleConfig[r].label}</option>
              ))}
            </select>
          </div>
          {error && (
            <div className="rounded-lg px-4 py-3 text-sm bg-red-50 border border-red-200 text-red-600">{error}</div>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
            {loading ? '创建中...' : '创建账号'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Edit role modal ──────────────────────────────────────────────────────────

function EditRoleModal({ user, callerRole, onClose, onUpdated }: {
  user: UserRecord
  callerRole: UserRole
  onClose: () => void
  onUpdated: (id: string, updates: Partial<UserRecord>) => void
}) {
  useModalEscape(onClose)
  const [username, setUsername] = useState(user.username ?? '')
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>(user.role)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const roleOptions: UserRole[] = callerRole === 'super' ? ['super', 'admin', 'normal'] : ['admin', 'normal']

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const body: Record<string, string> = { role }
    if (username !== (user.username ?? '')) body.username = username
    if (email !== user.email) body.email = email
    if (password) body.password = password
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) {
      setError(data.error ?? '修改失败')
    } else {
      const updates: Partial<UserRecord> = { role }
      if (body.username !== undefined) updates.username = username || null
      if (body.email) updates.email = email
      onUpdated(user.id, updates)
      onClose()
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="编辑用户" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">编辑用户</h3>
          <button type="button" onClick={onClose} aria-label="关闭编辑用户窗口" className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4"
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">用户名</label>
            <input aria-label="输入内容" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="登录时显示的名称"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱</label>
            <input aria-label="输入电子邮箱" type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">新密码 <span className="text-gray-400 font-normal">（留空则不修改）</span></label>
            <input aria-label="输入密码" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="留空则保持原密码"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">权限</label>
            <select aria-label="选择选项" value={role} onChange={e => setRole(e.target.value as UserRole)}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent">
              {roleOptions.map(r => (
                <option key={r} value={r}>{roleConfig[r].label}</option>
              ))}
            </select>
          </div>
          {error && (
            <div className="rounded-lg px-4 py-3 text-sm bg-red-50 border border-red-200 text-red-600">{error}</div>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
            {loading ? '保存中...' : '保存'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── IP whitelist modal ───────────────────────────────────────────────────────

const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/

function IpWhitelistModal({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  useModalEscape(onClose)
  const [ips, setIps] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newIp, setNewIp] = useState('')
  const [myIp, setMyIp] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/users/${user.id}/ip-whitelist`).then(r => r.json()),
      fetch('/api/my-ip').then(r => r.json()),
    ]).then(([ipData, myIpData]) => {
      setIps(ipData.allowedIps ?? [])
      setMyIp(myIpData.ip ?? null)
      setLoading(false)
    })
  }, [user.id])

  function addIp() {
    const ip = newIp.trim()
    if (!ip) return
    if (ips.includes(ip)) { setError('该IP已在白名单中'); return }
    if (!ipv4Re.test(ip)) { setError('IP格式不正确，请输入如 192.168.1.1'); return }
    setIps(prev => [...prev, ip])
    setNewIp('')
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/admin/users/${user.id}/ip-whitelist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedIps: ips }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? '保存失败')
    } else {
      onClose()
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="IP 白名单" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-gray-900">IP 白名单</h3>
          <button type="button" onClick={onClose} aria-label="关闭 IP 白名单窗口" className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">{user.email} · 留空则不限制 IP 访问</p>

        {myIp && (
          <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2 mb-4">
            <span className="text-xs text-blue-600">您当前 IP：</span>
            <span className="text-xs font-mono text-blue-700 font-medium">{myIp}</span>
            {!loading && !ips.includes(myIp) && (
              <button
                onClick={() => { setIps(prev => [...prev, myIp!]); setError(null) }}
                className="ml-auto text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                添加
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="h-20 flex items-center justify-center text-gray-400 text-sm">加载中...</div>
        ) : ips.length === 0 ? (
          <div className="h-16 flex items-center justify-center text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg mb-4">
            暂无限制 · 所有 IP 均可访问
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1.5 mb-4">
            {ips.map(ip => (
              <div key={ip} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50">
                <span className="text-sm font-mono text-gray-800">{ip}</span>
                <button onClick={() => setIps(prev => prev.filter(i => i !== ip))}
                  className="text-gray-300 hover:text-red-400 transition-colors ml-2 flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <input aria-label="输入内容"
            type="text"
            value={newIp}
            onChange={e => { setNewIp(e.target.value); setError(null) }}
            onKeyDown={e => e.key === 'Enter' && addIp()}
            placeholder="输入 IP，如 192.168.1.1"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button onClick={addIp}
            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
            添加
          </button>
        </div>

        {error && (
          <div className="rounded-lg px-4 py-3 text-sm bg-red-50 border border-red-200 text-red-600 mb-3">{error}</div>
        )}

        {ips.length > 0 && (
          <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            ⚠ 设置后该账号只能从以上 IP 访问页面，请确认 IP 正确
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
            取消
          </button>
          <button onClick={handleSave} disabled={saving || loading}
            className="flex-1 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Site access modal ────────────────────────────────────────────────────────

function SiteAccessModal({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  useModalEscape(onClose)
  const [sites, setSites] = useState<RestrictedSite[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/users/${user.id}/access`)
      .then(r => r.json())
      .then(({ restrictedSites, grantedSiteIds }) => {
        setSites(restrictedSites ?? [])
        setChecked(new Set(grantedSiteIds ?? []))
        setLoading(false)
      })
  }, [user.id])

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/admin/users/${user.id}/access`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteIds: Array.from(checked) }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? '保存失败')
    } else {
      onClose()
    }
  }

  const focusLabel: Record<number, string> = { 1: '重点', 2: '侧重' }

  return (
    <div role="dialog" aria-modal="true" aria-label="站点权限" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-gray-900">站点权限</h3>
          <button type="button" onClick={onClose} aria-label="关闭站点权限窗口" className="inline-flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">{user.email} · 勾选后该用户可看到对应站点</p>

        {loading ? (
          <div className="h-32 flex items-center justify-center text-gray-400 text-sm">加载中...</div>
        ) : sites.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-gray-400 text-sm">暂无重点/侧重站点</div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-2 mb-4">
            {sites.map(site => (
              <label key={site.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input aria-label="选择此项" type="checkbox" checked={checked.has(site.id)} onChange={() => toggle(site.id)}
                  className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 flex-shrink-0" />
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                  site.focus_level === 1 ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'
                }`}>{focusLabel[site.focus_level]}</span>
                <span className="text-sm text-gray-800 font-medium truncate">{site.name}</span>
                <span className="text-xs text-gray-400 truncate flex-shrink-0">{site.domain}</span>
              </label>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg px-4 py-3 text-sm bg-red-50 border border-red-200 text-red-600 mb-4">{error}</div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
            取消
          </button>
          <button onClick={handleSave} disabled={saving || loading}
            className="flex-1 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { role: myRole } = useUser()
  const isManager = myRole === 'super' || myRole === 'admin'

  // ── Normal user: just change password ──
  if (!isManager) {
    return <NormalSettings />
  }

  return <ManagerSettings callerRole={myRole} />
}

// ─── Normal settings (change password) ───────────────────────────────────────

function NormalSettings() {
  const [newPwd, setNewPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (newPwd.length < 6) return setMsg({ type: 'error', text: '密码至少 6 位' })
    if (newPwd !== confirm) return setMsg({ type: 'error', text: '两次密码不一致' })
    setLoading(true)
    const supabase = getBrowserClient()
    const { error } = await supabase.auth.updateUser({ password: newPwd })
    setLoading(false)
    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      setMsg({ type: 'success', text: '密码修改成功' })
      setNewPwd(''); setConfirm('')
    }
  }

  return (
    <div className="p-6 max-w-lg">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">账户设置</h1>
        <p className="text-gray-400 text-sm mt-0.5">修改登录密码</p>
      </div>
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">修改密码</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">新密码</label>
            <input aria-label="输入密码" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required placeholder="至少 6 位"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">确认密码</label>
            <input aria-label="输入密码" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="再次输入"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
          </div>
          {msg && (
            <div className={`rounded-lg px-4 py-3 text-sm ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
              {msg.text}
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
            {loading ? '保存中...' : '保存密码'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Manager settings (account management) ────────────────────────────────────

function ManagerSettings({ callerRole }: { callerRole: UserRole }) {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showChangePwd, setShowChangePwd] = useState(false)
  const [showAddUser, setShowAddUser] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [accessUser, setAccessUser] = useState<UserRecord | null>(null)
  const [ipWhitelistUser, setIpWhitelistUser] = useState<UserRecord | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UserRecord | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    if (res.ok) {
      const data = await res.json()
      setUsers(data.users ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  function handleDelete(user: UserRecord) {
    setPendingDeleteUser(user)
    setDeleteError(null)
  }

  async function confirmDelete() {
    const user = pendingDeleteUser
    if (!user) return
    setDeletingId(user.id)
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '删除失败')
      setUsers(prev => prev.filter(u => u.id !== user.id))
      setPendingDeleteUser(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">账户设置</h1>
          <p className="text-gray-400 text-sm mt-0.5">管理所有账号与访问权限</p>
        </div>
        <button
          onClick={() => setShowChangePwd(true)}
          className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          修改密码
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">账号管理</h2>
          <button
            onClick={() => setShowAddUser(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增账号
          </button>
        </div>

        {loading ? (
          <div className="h-32 flex items-center justify-center text-gray-400 text-sm">加载中...</div>
        ) : (
          <table aria-label="数据表格" className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">用户名</th>
                <th className="table-th text-center">权限</th>
                <th className="table-th">注册时间</th>
                <th className="table-th text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="table-td text-center text-gray-400 py-10">暂无账号</td>
                </tr>
              ) : users.map(user => (
                <tr key={user.id} className="hover:bg-gray-100 transition-colors">
                  <td className="table-td">
                    <span className="font-medium text-gray-900">{user.username ?? <span className="text-gray-400 italic">未设置</span>}</span>
                    <span className="text-gray-400"> · {user.email}</span>
                  </td>
                  <td className="table-td text-center"><RoleBadge role={user.role} /></td>
                  <td className="table-td text-gray-500">
                    {new Date(user.created_at).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="table-td text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setIpWhitelistUser(user)}
                        className="text-xs text-orange-500 hover:text-orange-700 border border-orange-100 rounded px-1.5 py-0.5 hover:border-orange-200 transition-colors"
                      >
                        IP白名单
                      </button>
                      {user.role === 'normal' && (
                        <button
                          onClick={() => setAccessUser(user)}
                          className="text-xs text-purple-500 hover:text-purple-700 border border-purple-100 rounded px-1.5 py-0.5 hover:border-purple-200 transition-colors"
                        >
                          站点权限
                        </button>
                      )}
                      {!(callerRole === 'admin' && user.role === 'super') && (
                        <button
                          onClick={() => setEditingUser(user)}
                          className="text-xs text-blue-500 hover:text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:border-blue-200 transition-colors"
                        >
                          编辑
                        </button>
                      )}
                      {!(callerRole === 'admin' && user.role === 'super') && (
                        <button
                          onClick={() => handleDelete(user)}
                          disabled={deletingId === user.id}
                          className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded px-1.5 py-0.5 hover:border-red-200 transition-colors disabled:opacity-40"
                        >
                          {deletingId === user.id ? '删除中...' : '删除'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
      {showAddUser && (
        <AddUserModal
          callerRole={callerRole}
          onClose={() => setShowAddUser(false)}
          onCreated={user => setUsers(prev => [user, ...prev])}
        />
      )}
      {editingUser && (
        <EditRoleModal
          user={editingUser}
          callerRole={callerRole}
          onClose={() => setEditingUser(null)}
          onUpdated={(id, updates) => setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u))}
        />
      )}
      {accessUser && (
        <SiteAccessModal user={accessUser} onClose={() => setAccessUser(null)} />
      )}
      {ipWhitelistUser && (
        <IpWhitelistModal user={ipWhitelistUser} onClose={() => setIpWhitelistUser(null)} />
      )}
      {pendingDeleteUser && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title" aria-describedby="delete-user-description" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 id="delete-user-title" className="text-lg font-semibold text-gray-900">确认删除账号</h2>
            <p id="delete-user-description" className="mt-2 text-sm text-gray-600">
              确定要删除账号 {pendingDeleteUser.username ?? pendingDeleteUser.email}？此操作不可撤销。
            </p>
            {deleteError && <p role="alert" className="mt-3 text-sm text-red-600">{deleteError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn-secondary" disabled={deletingId === pendingDeleteUser.id} onClick={() => setPendingDeleteUser(null)}>取消</button>
              <button type="button" className="btn-danger" aria-busy={deletingId === pendingDeleteUser.id} disabled={deletingId === pendingDeleteUser.id} onClick={confirmDelete}>
                {deletingId === pendingDeleteUser.id ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
