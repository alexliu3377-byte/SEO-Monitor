// Cleanup prevents both queued requests and late responses from updating a view.
export function deferredRequest<T>(options: {
  delayMs: number
  request: (signal: AbortSignal) => Promise<T>
  success: (value: T) => void
  failure: (error: unknown) => void
  settled: () => void
}) {
  const controller = new AbortController()
  const timer = setTimeout(async () => {
    try {
      const value = await options.request(controller.signal)
      if (!controller.signal.aborted) options.success(value)
    } catch (error) {
      if (!controller.signal.aborted) options.failure(error)
    } finally {
      if (!controller.signal.aborted) options.settled()
    }
  }, options.delayMs)
  return () => { clearTimeout(timer); controller.abort() }
}
