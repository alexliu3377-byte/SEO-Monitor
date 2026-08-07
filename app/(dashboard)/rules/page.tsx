'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'

interface ReportListItem {
  id: string
  period_start: string
  period_end: string
  status: 'running' | 'completed' | 'failed'
  sites_considered: number
  sites_analyzed: number
  sites_skipped: number
  gemini_call_count: number
  gemini_fail_count: number
  error: string | null
  created_at: string
  completed_at: string | null
}

interface SiteAnalysisEntry {
  site_id: string
  domain: string
  name: string
  skipped: boolean
  skip_reason: string | null
  analysis: string | null
  error: string | null
}

interface GroupEffectivenessClaim {
  keyword: string
  url: string | null
  rank_position: number | null
  volume: number
  score: number
}

interface OwnTeamAnalysisEntry {
  group_id: string
  group_name: string
  summary: { ranked: number; indexed: number; tracking: number; invalid: number }
  top_claims: GroupEffectivenessClaim[]
}

interface ReportDetail extends ReportListItem {
  site_analyses: SiteAnalysisEntry[]
  own_team_analyses: OwnTeamAnalysisEntry[]
  report_sections: { environment: string; effectiveness: string; conclusion: string } | null
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  running:   { label: '生成中', bg: 'bg-amber-50', text: 'text-amber-600' },
  completed: { label: '已完成', bg: 'bg-green-50', text: 'text-green-600' },
  failed:    { label: '失败',   bg: 'bg-red-50',   text: 'text-red-600' },
}

export default function RulesPage() {
  const { role } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (role === 'normal') router.replace('/task-groups')
  }, [role, router])

  const [reports, setReports] = useState<ReportListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/rules/reports').then(r => r.json()).then(d => {
      const list = (d.reports ?? []) as ReportListItem[]
      setReports(list)
      if (list.length > 0) setSelectedId(list[0].id)
    }).finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">规则中心</h1>
        <p className="text-sm text-gray-400 mt-0.5">每周自动生成的研究报告 — AI 通读全部抓取数据，写出大环境/成效/综合结论</p>
      </div>

      <div className="grid grid-cols-[260px_1fr] gap-5">
        <div>
          {loading ? <Spinner /> : reports.length === 0 ? (
            <p className="text-xs text-gray-300 text-center py-8">还没有报告，等下周一自动生成</p>
          ) : (
            <div className="space-y-1.5">
              {reports.map(r => {
                const st = STATUS_LABELS[r.status]
                return (
                  <button key={r.id} onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${selectedId === r.id ? 'border-green-400 bg-green-50/60' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">{r.period_start} ~ {r.period_end}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ml-1 ${st.bg} ${st.text}`}>{st.label}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {r.sites_analyzed}个站点已分析{r.sites_skipped > 0 ? `，${r.sites_skipped}个跳过` : ''}
                      {r.gemini_fail_count > 0 ? `，${r.gemini_fail_count}次AI调用失败` : ''}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div>
          {selectedId ? (
            <ReportDetailView reportId={selectedId} />
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-gray-300">
              <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-sm">左边选一份报告</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportDetailView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    fetch(`/api/rules/reports/${reportId}`).then(r => r.json()).then(d => setReport(d.report)).finally(() => setLoading(false))
  }, [reportId])

  function toggleSite(siteId: string) {
    setExpandedSites(prev => {
      const next = new Set(prev)
      if (next.has(siteId)) next.delete(siteId); else next.add(siteId)
      return next
    })
  }

  if (loading || !report) return <Spinner />

  const st = STATUS_LABELS[report.status]
  const analyzedSites = report.site_analyses.filter(s => !s.skipped && s.analysis)
  const skippedSites = report.site_analyses.filter(s => s.skipped)
  const failedSites = report.site_analyses.filter(s => !s.skipped && !s.analysis)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{report.period_start} ~ {report.period_end}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {report.sites_considered}个启用站点 · {analyzedSites.length}个分析成功 · {skippedSites.length}个无数据跳过
            {failedSites.length > 0 ? ` · ${failedSites.length}个AI调用失败` : ''}
          </p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
      </div>

      {report.status === 'failed' && report.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{report.error}</p>
      )}

      {report.report_sections && (
        <div className="grid grid-cols-1 gap-4">
          <ReportSectionCard title="大环境" color="sky" text={report.report_sections.environment} />
          <ReportSectionCard title="成效" color="green" text={report.report_sections.effectiveness} />
          <ReportSectionCard title="综合结论" color="violet" text={report.report_sections.conclusion} />
        </div>
      )}

      {report.own_team_analyses.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
            <span className="text-sm font-semibold text-gray-700">自己团队成效</span>
          </div>
          <div className="divide-y divide-gray-50">
            {report.own_team_analyses.map(g => (
              <div key={g.group_id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-gray-800">{g.group_name}</span>
                  <span className="text-xs text-gray-400">
                    获取排名{g.summary.ranked} · 获取收录{g.summary.indexed} · 追踪中{g.summary.tracking} · 无效{g.summary.invalid}
                  </span>
                </div>
                {g.top_claims.length > 0 && (
                  <p className="text-xs text-gray-500 leading-relaxed">
                    {g.top_claims.slice(0, 8).map(c => `${c.keyword}(第${c.rank_position ?? '未排名'}名/分${c.score})`).join('、')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">各站点分析</span>
          <span className="text-xs text-gray-400">{analyzedSites.length} 个</span>
        </div>
        {analyzedSites.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-8">这周没有站点产出有效分析</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {analyzedSites.map(s => (
              <div key={s.site_id}>
                <button onClick={() => toggleSite(s.site_id)} className="w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-gray-50/60 transition-colors">
                  <span className="text-sm font-medium text-gray-800">{s.domain}</span>
                  <span className="text-xs text-gray-400">{s.name}</span>
                </button>
                {expandedSites.has(s.site_id) && (
                  <div className="px-4 pb-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{s.analysis}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(skippedSites.length > 0 || failedSites.length > 0) && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer hover:text-gray-600">跳过/失败的站点（{skippedSites.length + failedSites.length}个）</summary>
          <div className="mt-2 space-y-1 pl-2">
            {skippedSites.map(s => <p key={s.site_id}>{s.domain}：{s.skip_reason}</p>)}
            {failedSites.map(s => <p key={s.site_id} className="text-red-400">{s.domain}：{s.error}</p>)}
          </div>
        </details>
      )}
    </div>
  )
}

function ReportSectionCard({ title, color, text }: { title: string; color: 'sky' | 'green' | 'violet'; text: string }) {
  const borderMap = { sky: 'border-sky-200', green: 'border-green-200', violet: 'border-violet-200' }
  const textMap = { sky: 'text-sky-700', green: 'text-green-700', violet: 'text-violet-700' }
  return (
    <div className={`bg-white rounded-xl border ${borderMap[color]} p-5`}>
      <p className={`text-sm font-semibold mb-2 ${textMap[color]}`}>{title}</p>
      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{text || '（无内容）'}</p>
    </div>
  )
}
