'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { transcriptStatusLabel, transcriptSourceLabel } from '@/lib/content-transcript'

type Transcript = { status: string; text: string; textSource?: string; message?: string; updatedAt?: string; model?: string }

export default function ContentTranscriptDialog({ item, onClose }: {
  item: { id: string; title: string; url: string }; onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const [data, setData] = useState<Transcript | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog?.showModal()
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setLoading(true)
    setError('')
    async function load() {
      try {
        const response = await fetch(`/api/content-feed/${item.id}/transcript`, { signal: controller.signal, cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || '文字读取失败，请稍后重试')
        if (typeof result.status !== 'string' || typeof result.text !== 'string') throw new Error('文字资料返回格式异常')
        if (controller.signal.aborted) return
        setData(result)
        if (['queued', 'processing'].includes(result.status)) timer = setTimeout(load, 15_000)
      } catch (loadError) {
        if (!controller.signal.aborted) setError((loadError as Error).message)
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [item.id, reload])

  async function copy() {
    try {
      await navigator.clipboard.writeText(data?.text ?? '')
      setCopyStatus('已复制文字')
    } catch { setCopyStatus('浏览器不允许自动复制，请选中文字后复制。') }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby={headingId} aria-modal="true"
      onCancel={event => { event.preventDefault(); onClose() }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'))
        const first = controls[0], last = controls[controls.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[calc(100dvh_-_2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40">
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold">视频文字</h2>
            <p className="mt-1 break-words text-sm text-slate-600">{item.title}</p>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label="关闭文字窗口" className="btn-secondary shrink-0">关闭</button>
        </header>
        <div className="min-h-32 overflow-y-auto px-5 py-4" aria-busy={loading}>
          {loading ? <p role="status" className="text-sm text-slate-600">正在读取已保存的文字…</p>
            : error ? <p role="alert" className="text-sm text-red-600">{error}</p>
              : data?.status === 'completed' ? <>
                <p className="mb-4 text-xs text-slate-600">来源：{transcriptSourceLabel(data.textSource)} · 已统一简体，游戏名、软件名等请对照原视频核实。</p>
                <div className="whitespace-pre-wrap break-words text-sm leading-7">{data.text}</div>
              </> : <div role="status">
                <p className="text-sm font-medium">{transcriptStatusLabel(data?.status)}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{data?.message || (data?.status === 'processing'
                  ? '采集电脑正在处理，文字完成后会自动保存。可以关闭窗口，稍后回来查看。'
                  : data?.status === 'queued' ? '已加入自动任务，等待采集电脑处理。无需逐条点击转写。'
                    : '请查看原文，或检查采集电脑上的自动转写任务及登录状态。')}</p>
              </div>}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <p role="status" className="min-w-0 text-xs text-slate-600">{copyStatus}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setReload(value => value + 1)} disabled={loading} className="btn-secondary">刷新状态</button>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn-secondary whitespace-nowrap">查看原文</a>
            {data?.status === 'completed' && !error && <button type="button" onClick={copy} className="btn-secondary whitespace-nowrap">复制文字</button>}
          </div>
        </footer>
      </div>
    </dialog>
  )
}
