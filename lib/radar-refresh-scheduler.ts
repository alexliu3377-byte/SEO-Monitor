// Coalesce notifications without postponing refresh indefinitely during a burst.
export function createRadarRefreshScheduler(options: {
  refresh: () => void
  visible: () => boolean
  now: () => number
  schedule: (callback: () => void, delay: number) => () => void
}) {
  let lastRefresh = options.now()
  let dirty = false
  let disposed = false
  let cancel: (() => void) | undefined
  function wake() {
    if (disposed || !options.visible() || cancel) return
    if (!dirty && options.now() - lastRefresh < 60_000) return
    cancel = options.schedule(() => {
      cancel = undefined
      if (disposed || !options.visible()) return
      dirty = false
      lastRefresh = options.now()
      options.refresh()
    }, 500)
  }
  return {
    wake,
    invalidate() { dirty = true; wake() },
    dispose() { disposed = true; cancel?.(); cancel = undefined },
  }
}
