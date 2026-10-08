'use client'

import { useEffect, useRef } from 'react'

const KUALA_LUMPUR_TIME_ZONE = 'Asia/Kuala_Lumpur'
const CHECK_INTERVAL_MS = 30_000

function kualaLumpurDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KUALA_LUMPUR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export default function DailyLoginGuard({
  enabled,
  renderedDate,
}: {
  enabled: boolean
  renderedDate: string
}) {
  const redirectingRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    const requireFreshLogin = async () => {
      if (redirectingRef.current || kualaLumpurDate() === renderedDate) return
      redirectingRef.current = true

      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          keepalive: true,
        })
      } finally {
        const next = `${window.location.pathname}${window.location.search}`
        window.location.replace(`/login?reason=daily-login-required&next=${encodeURIComponent(next)}`)
      }
    }

    const onFocus = () => { void requireFreshLogin() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void requireFreshLogin()
    }

    void requireFreshLogin()
    const interval = window.setInterval(() => { void requireFreshLogin() }, CHECK_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, renderedDate])

  return null
}
