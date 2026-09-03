'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ─── Canvas CAPTCHA ───────────────────────────────────────────────────────────

const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const CAPTCHA_COLORS = ['#ffffff', '#bbf7d0', '#6ee7b7', '#a5f3fc', '#c4b5fd', '#fde68a']

function drawCaptcha(canvas: HTMLCanvasElement): string {
  const code = Array.from({ length: 4 }, () =>
    CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]
  ).join('')
  const ctx = canvas.getContext('2d')!
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`
    ctx.beginPath()
    ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 1.5, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < code.length; i++) {
    ctx.save()
    ctx.translate(13 + i * 26, h / 2 + 7)
    ctx.rotate((Math.random() - 0.5) * 0.3)
    ctx.font = `700 ${19 + Math.floor(Math.random() * 3)}px monospace`
    ctx.fillStyle = CAPTCHA_COLORS[i % CAPTCHA_COLORS.length]
    ctx.shadowColor = CAPTCHA_COLORS[i % CAPTCHA_COLORS.length]
    ctx.shadowBlur = 4
    ctx.fillText(code[i], 0, 0)
    ctx.restore()
  }
  return code
}

// ─── Turnstile ────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id: string) => void
    }
  }
}

// ─── Login Page ───────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername]             = useState('')
  const [password, setPassword]             = useState('')
  const [captchaInput, setCaptchaInput]     = useState('')
  const [showPwd, setShowPwd]               = useState(false)
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  const canvasRef         = useRef<HTMLCanvasElement>(null)
  const captchaCodeRef    = useRef<string>('')
  const turnstileRef      = useRef<HTMLDivElement>(null)
  const turnstileWidgetId = useRef<string | null>(null)

  const refreshCaptcha = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    captchaCodeRef.current = drawCaptcha(canvas)
    setCaptchaInput('')
  }, [])

  useEffect(() => { refreshCaptcha() }, [refreshCaptcha])

  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    if (!siteKey) return
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => {
      if (turnstileRef.current && window.turnstile) {
        turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token: string) => setTurnstileToken(token),
          'expired-callback': () => setTurnstileToken(null),
          'error-callback':   () => setTurnstileToken(null),
        })
      }
    }
    document.head.appendChild(script)
    return () => { document.head.removeChild(script) }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (captchaInput.toLowerCase() !== captchaCodeRef.current.toLowerCase()) {
      setError('验证码错误，请重新输入')
      refreshCaptcha()
      return
    }

    const hasTurnstile = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    if (hasTurnstile && !turnstileToken) { setError('请完成人机验证'); return }
    setLoading(true)

    const resolveRes = await fetch('/api/auth/resolve-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password, turnstileToken }),
    })
    if (!resolveRes.ok) {
      const d = await resolveRes.json()
      setError(d.error ?? '用户名或密码错误')
      setLoading(false); refreshCaptcha()
      setTurnstileToken(null)
      if (turnstileWidgetId.current && window.turnstile) window.turnstile.reset(turnstileWidgetId.current)
      return
    }
    router.replace('/')
    router.refresh()
  }

  // Glass input style
  const glassInput = {
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: '12px',
    color: 'white',
    fontSize: '14px',
    width: '100%',
    padding: '12px 16px',
    outline: 'none',
    transition: 'all 0.15s',
  } as React.CSSProperties

  function onFocusGlass(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.background = 'rgba(255,255,255,0.18)'
    e.currentTarget.style.border = '1px solid rgba(255,255,255,0.5)'
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.08)'
  }
  function onBlurGlass(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
    e.currentTarget.style.border = '1px solid rgba(255,255,255,0.25)'
    e.currentTarget.style.boxShadow = 'none'
  }

  return (
    <div className="min-h-screen relative overflow-hidden">

      {/* ── Background photo — no blur ── */}
      {/* Peyto Lake, Canada — teal/green tones match brand, visually stunning */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1920&q=85')",
        }}
      />
      {/* Very subtle dark tint for legibility only */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.18)' }} />

      {/* ── Logo — top left ── */}
      <div className="absolute top-7 left-8 z-20 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-green-500 rounded-lg shadow-lg flex items-center justify-center"
          style={{ boxShadow: '0 4px 12px rgba(34,197,94,0.4)' }}>
          <svg className="w-[18px] h-[18px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <span className="font-semibold text-white text-base drop-shadow">SEO Monitor</span>
      </div>

      {/* ── Glass card — centered ── */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-[420px]" style={{
          background: 'rgba(255,255,255,0.10)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderRadius: '24px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3)',
        }}>
          <div className="p-8 sm:p-10">

            {/* Heading */}
            <div className="mb-8">
              <h1 className="text-[32px] font-bold text-white leading-tight tracking-tight drop-shadow">
                登录
              </h1>
              <p className="text-white/60 text-sm mt-1.5">欢迎回来，请登录您的管理账户</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">

              {/* Username */}
              <div>
                <label htmlFor="login-username" className="block text-xs font-medium text-white/70 mb-1.5 tracking-wide">用户名</label>
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  placeholder="输入用户名"
                  autoComplete="username"
                  style={{ ...glassInput, color: 'white' }}
                  className="placeholder:text-white/35"
                  onFocus={onFocusGlass}
                  onBlur={onBlurGlass}
                />
              </div>

              {/* Password */}
              <div>
                <label htmlFor="login-password" className="block text-xs font-medium text-white/70 mb-1.5 tracking-wide">密码</label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="输入密码"
                    autoComplete="current-password"
                    style={{ ...glassInput, paddingRight: '44px', color: 'white' }}
                    className="placeholder:text-white/35"
                    onFocus={onFocusGlass}
                    onBlur={onBlurGlass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPwd}
                    className="absolute inset-y-0 right-0 px-3.5 flex items-center text-white/40 hover:text-white/70 transition-colors"
                  >
                    {showPwd
                      ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>
                    }
                  </button>
                </div>
              </div>

              {/* CAPTCHA */}
              <div>
                <label htmlFor="login-captcha" className="block text-xs font-medium text-white/70 mb-1.5 tracking-wide">图形验证码</label>
                <div className="flex gap-2.5">
                  <input
                    id="login-captcha"
                    type="text"
                    value={captchaInput}
                    onChange={e => setCaptchaInput(e.target.value)}
                    required
                    placeholder="输入右侧验证码"
                    maxLength={4}
                    autoComplete="off"
                    style={{ ...glassInput, color: 'white' }}
                    className="placeholder:text-white/35"
                    onFocus={onFocusGlass}
                    onBlur={onBlurGlass}
                  />
                  <button type="button" onClick={refreshCaptcha} aria-label="刷新图形验证码" className="rounded-xl flex-shrink-0">
                    <canvas
                      ref={canvasRef}
                      width={116}
                      height={48}
                      aria-hidden="true"
                      className="rounded-xl pointer-events-none"
                      style={{ borderRadius: '12px' }}
                    />
                  </button>
                </div>
                <p className="text-xs text-white/35 mt-1.5">不区分大小写 · 点击图片刷新</p>
              </div>

              {/* Turnstile */}
              {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
                <div ref={turnstileRef} aria-label="Cloudflare 人机验证" className="pt-0.5" />
              )}

              {/* Error */}
              {error && (
                <div role="alert" aria-live="assertive" className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                  style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <svg className="w-4 h-4 text-red-300 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-red-200">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="w-full py-3 mt-1 font-semibold text-white text-sm rounded-xl transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                  boxShadow: '0 4px 20px rgba(22,163,74,0.45)',
                }}
                onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 28px rgba(22,163,74,0.6)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(22,163,74,0.45)' }}
              >
                {loading
                  ? <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      登录中...
                    </span>
                  : '登录'
                }
              </button>

            </form>
          </div>
        </div>
      </div>

    </div>
  )
}
