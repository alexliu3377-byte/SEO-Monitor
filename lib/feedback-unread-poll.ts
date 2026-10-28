export const FEEDBACK_POLL_MS = 5 * 60_000

type Snapshot = { count: number; at: number }

export function parseUnreadSnapshot(value: string | null, now = Date.now()): Snapshot | null {
  try {
    const data = JSON.parse(value ?? 'null')
    return data && Number.isSafeInteger(data.count) && data.count >= 0
      && Number.isFinite(data.at) && data.at <= now && now - data.at < FEEDBACK_POLL_MS
      ? data : null
  } catch { return null }
}

// Store only a badge count, scoped to the signed-in user and role. Web Locks
// serialize active tabs; re-read storage inside the lock before fetching.
export function watchFeedbackUnread(userId: string, role: string, onCount: (count: number) => void) {
  const key = `qixin:feedback-unread:v1:${userId}:${role}`
  let stopped = false
  let running = false
  let invalidated = false
  let memory: Snapshot | null = null
  const read = () => {
    try { return parseUnreadSnapshot(localStorage.getItem(key)) }
    catch { return memory && parseUnreadSnapshot(JSON.stringify(memory)) }
  }
  const refresh = async () => {
    if (stopped || running || document.visibilityState !== 'visible') return
    running = true
    const update = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      const cached = read()
      if (cached) { invalidated = false; onCount(cached.count); return }
      invalidated = false
      try {
        const response = await fetch('/api/feedback?summary=unread', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
        if (!response.ok) return
        const body = await response.json()
        if (!Number.isSafeInteger(body.unreadCount) || body.unreadCount < 0) return
        // A mark-read event during the request makes this response obsolete.
        if (invalidated || stopped) return
        memory = { count: body.unreadCount, at: Date.now() }
        try { localStorage.setItem(key, JSON.stringify(memory)) } catch { /* private storage unavailable */ }
        onCount(memory.count)
      } catch { /* Retain the last badge on network failure. */ }
    }
    try {
      if (navigator.locks) await navigator.locks.request(key, update)
      else await update()
    } finally {
      running = false
      if (invalidated && !stopped) void refresh()
    }
  }
  const changed = () => {
    invalidated = true
    memory = null
    try { localStorage.removeItem(key) } catch { /* optional cache */ }
    void refresh()
  }
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== key) return
    if (event.newValue === null) { invalidated = true; memory = null }
    else if (parseUnreadSnapshot(event.newValue)) { invalidated = false }
    void refresh()
  }
  const wake = () => { void refresh() }
  const timer = window.setInterval(wake, FEEDBACK_POLL_MS)
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('feedback-unread-changed', changed)
  window.addEventListener('storage', storageChanged)
  wake()
  return () => {
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', wake)
    window.removeEventListener('focus', wake)
    window.removeEventListener('feedback-unread-changed', changed)
    window.removeEventListener('storage', storageChanged)
  }
}
