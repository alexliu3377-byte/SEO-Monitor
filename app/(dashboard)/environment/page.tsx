'use client'

import { useEffect, useState } from 'react'

interface SegmentRow {
  date: string
  dimension: 'weight_tier' | 'content_focus'
  segment: string
  site_count: number
  avg_index_change_pct: number | null
  fleet_avg_index_change_pct: number | null
  deviation_pct: number | null
  total_rankup: number
  total_rankdown: number
  is_anomaly: boolean
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

const DIMENSION_LABEL: Record<string, string> = { weight_tier: '体量档位', content_focus: '内容侧重' }

function SegmentChip({ s }: { s: SegmentRow }) {
  return (
    <div className={`px-3 py-2 rounded-lg border text-sm ${s.is_anomaly ? 'border-red-300 bg-red-50' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-gray-800">{s.segment}</span>
        <span className="text-[11px] text-gray-400">{s.site_count}站</span>
      </div>
      <div className="text-xs text-gray-500">
        中位数 <span className={s.is_anomaly ? 'text-red-600 font-semibold' : 'text-gray-700'}>{s.avg_index_change_pct ?? '-'}%</span>
        <span className="text-gray-300 mx-1">·</span>
        大盘 {s.fleet_avg_index_change_pct ?? '-'}%
        {s.deviation_pct != null && <span className="text-gray-300 mx-1">·</span>}
        {s.deviation_pct != null && <span>偏离 {s.deviation_pct > 0 ? '+' : ''}{s.deviation_pct}pp</span>}
      </div>
      <div className="text-[11px] text-gray-400 mt-0.5">涨{s.total_rankup} · 跌{s.total_rankdown}</div>
    </div>
  )
}

export default function EnvironmentPage() {
  const [rows, setRows] = useState<SegmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/environment/segments?days=30')
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setRows(d.rows ?? []) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 max-w-5xl mx-auto"><Spinner /></div>
  if (error) return <div className="p-6 max-w-5xl mx-auto text-sm text-red-600">加载失败：{error}</div>

  const dates = Array.from(new Set(rows.map(r => r.date))).sort((a, b) => b.localeCompare(a))
  const anomalyDateCount = dates.filter(date => rows.some(r => r.date === date && r.is_anomaly)).length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">大环境分段监控</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          按体量档位（高/中/低，从当天权重数据现算）和内容侧重（游戏为主/应用为主/混合，从近30天新增内容现算）两个维度，
          对比该分段收录变化中位数和全站大盘中位数——区分"整个大盘一起动"还是"只有某一类站点在动"。
        </p>
      </div>

      {dates.length === 0 ? (
        <p className="text-sm text-gray-300 text-center py-16">暂无数据——等 daily-snapshot 至少跑过一次</p>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-4">最近{dates.length}天里，{anomalyDateCount}天有分段异常标记（红色）</p>
          <div className="space-y-4">
            {dates.map(date => {
              const dayRows = rows.filter(r => r.date === date)
              const weightRows = dayRows.filter(r => r.dimension === 'weight_tier')
              const focusRows = dayRows.filter(r => r.dimension === 'content_focus')
              const hasAnomaly = dayRows.some(r => r.is_anomaly)
              return (
                <div key={date} className={`bg-white rounded-xl border overflow-hidden ${hasAnomaly ? 'border-red-200' : 'border-gray-200'}`}>
                  <div className={`px-4 py-2.5 border-b border-gray-100 flex items-center justify-between ${hasAnomaly ? 'bg-red-50/60' : 'bg-gray-50/60'}`}>
                    <span className="text-sm font-semibold text-gray-700">{date}</span>
                    {hasAnomaly && <span className="text-xs text-red-600 font-medium">有分段异常</span>}
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">{DIMENSION_LABEL.weight_tier}</p>
                      <div className="space-y-2">
                        {weightRows.map(s => <SegmentChip key={s.segment} s={s} />)}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">{DIMENSION_LABEL.content_focus}</p>
                      <div className="space-y-2">
                        {focusRows.map(s => <SegmentChip key={s.segment} s={s} />)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
