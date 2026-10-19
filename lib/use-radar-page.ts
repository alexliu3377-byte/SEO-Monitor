'use client'

import { useCallback, useEffect, useReducer, useState } from 'react'

interface RadarPage<T> { key: string; data: T[] | null; total: number; loading: boolean; error: string | null }

// One bounded server page. Identity includes tab, date, group and every filter.
// No response/loading/error from a previous identity can block the current tab.
export function useRadarPage<T>(query: string | null, refreshVersion = 0) {
  const [version, reload] = useReducer((value: number) => value + 1, 0)
  const [state, setState] = useState<RadarPage<T>>({ key: '', data: null, total: 0, loading: false, error: null })
  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    setState(previous => ({ key: query, data: previous.key === query ? previous.data : null,
      total: previous.key === query ? previous.total : 0, loading: true, error: null }))
    void fetch(`/api/radar-daily?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || '该日期资料读取失败，请重试')
        if (!Array.isArray(body.data) || !Number.isSafeInteger(body.total) || body.total < 0) throw new Error('资料格式无效，请重试')
        return { data: body.data as T[], total: body.total as number }
      })
      .then(body => {
        if (!controller.signal.aborted) setState({ key: query, ...body, loading: false, error: null })
      })
      .catch(error => {
        if (!controller.signal.aborted) setState({ key: query, data: null, total: 0, loading: false,
          error: error instanceof Error ? error.message : '该日期资料读取失败，请重试' })
      })
    return () => controller.abort()
  }, [query, version, refreshVersion])
  const retry = useCallback(() => reload(), [])
  const active = query && state.key === query ? state : { data: null, total: 0, loading: !!query, error: null }
  return { ...active, reload: retry }
}
