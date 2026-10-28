// Best-effort per-instance reuse, never a shared authorization cache.
export function createDiagnosticCache<T>(now = Date.now) {
  const entries = new Map<string, { expires: number; value: T }>()
  const pending = new Map<string, Promise<T>>()
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const cached = entries.get(key)
    if (cached && cached.expires > now()) return cached.value
    entries.delete(key)
    const active = pending.get(key)
    if (active) return active
    const promise = Promise.resolve().then(load).then(value => {
      // Bound retained summaries to 8 x 512 KiB; large results remain uncached.
      if (Buffer.byteLength(JSON.stringify(value) ?? '') <= 512 * 1024) {
        for (const [id, entry] of entries) if (entry.expires <= now()) entries.delete(id)
        while (entries.size >= 8) entries.delete(entries.keys().next().value!)
        entries.set(key, { expires: now() + 60_000, value })
      }
      return value
    }).finally(() => { if (pending.get(key) === promise) pending.delete(key) })
    // Do not retain an unbounded number of concurrent user keys.
    if (pending.size < 8) pending.set(key, promise)
    return promise
  }
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; out[index] = await work(items[index]) }
  }))
  return out
}
