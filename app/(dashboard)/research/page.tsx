'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import SiteAZPicker, { type AZPickerSite } from '@/components/site-az-picker'

// ─── Shared ──────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

type TabKey = 'competitors' | 'week' | 'month' | 'year'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'competitors', label: '竞品成效' },
  { key: 'week', label: '研究周报' },
  { key: 'month', label: '研究月报' },
  { key: 'year', label: '研究年报' },
]

export default function ResearchPage() {
  const { role } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (role === 'normal') router.replace('/task-groups')
  }, [role, router])

  const [activeTab, setActiveTab] = useState<TabKey>('competitors')

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">研究中心</h1>
        <p className="text-sm text-gray-400 mt-0.5">竞品成效追踪 + 每周/月/年自动生成的AI研究报告</p>
      </div>

      <div className="flex border-b border-gray-100 mb-6">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === t.key ? 'text-green-600 border-green-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'competitors' && <CompetitorsTab />}
      {activeTab === 'week' && <ReportTab key="week" periodType="week" />}
      {activeTab === 'month' && <ReportTab key="month" periodType="month" />}
      {activeTab === 'year' && <ReportTab key="year" periodType="year" />}
    </div>
  )
}

// ══════════════════════════════ 竞品成效 ══════════════════════════════

type CompetitorSite = AZPickerSite

interface TrackingRow {
  operation_type: string | null
  keyword: string
  search_volume: number
  content_type: string | null
  rank_position: number | null
  rank_volume: number
  effectiveness: string
  score: number | null
  content_date: string | null
  discovery_date: string
}

const EFFECTIVENESS_STYLE: Record<string, { bg: string; text: string }> = {
  '有效': { bg: 'bg-green-50', text: 'text-green-600' },
  '追踪中': { bg: 'bg-amber-50', text: 'text-amber-600' },
  '无效': { bg: 'bg-gray-100', text: 'text-gray-500' },
}

function CompetitorsTab() {
  const [sites, setSites] = useState<CompetitorSite[]>([])
  const [loadingSites, setLoadingSites] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showManageModal, setShowManageModal] = useState(false)

  const [rows, setRows] = useState<TrackingRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [kwFilter, setKwFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'app' | 'game'>('')
  const [effFilter, setEffFilter] = useState('')

  function loadSites() {
    setLoadingSites(true)
    fetch('/api/research/competitor-sites').then(r => r.json()).then(d => setSites(d.sites ?? [])).finally(() => setLoadingSites(false))
  }
  useEffect(loadSites, [])

  useEffect(() => {
    if (!selectedId) { setRows([]); return }
    setLoadingRows(true)
    fetch(`/api/research/competitor-sites/${selectedId}/tracking`).then(r => r.json()).then(d => setRows(d.rows ?? [])).finally(() => setLoadingRows(false))
  }, [selectedId])

  const filteredRows = rows.filter(r => {
    if (kwFilter && !r.keyword.toLowerCase().includes(kwFilter.toLowerCase())) return false
    if (typeFilter && r.content_type !== typeFilter) return false
    if (effFilter && r.effectiveness !== effFilter) return false
    return true
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">选一个竞品站点查看成效明细（只有开启"排名"追踪的站点才会出现在这里，不含你自己的站点）</p>
        <button onClick={() => setShowManageModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          管理竞品站点
        </button>
      </div>

      {loadingSites ? <Spinner /> : sites.length === 0 ? (
        <p className="text-sm text-gray-300 text-center py-8">还没有竞品站点，点右上角"管理竞品站点"开启追踪</p>
      ) : (
        <SiteAZPicker sites={sites} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {selectedId && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center gap-2">
            <input type="text" value={kwFilter} onChange={e => setKwFilter(e.target.value)} placeholder="搜索关键词…"
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as '' | 'app' | 'game')}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700">
              <option value="">全部类型</option>
              <option value="app">应用</option>
              <option value="game">游戏</option>
            </select>
            <select value={effFilter} onChange={e => setEffFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700">
              <option value="">全部成效</option>
              <option value="有效">有效</option>
              <option value="追踪中">追踪中</option>
              <option value="无效">无效</option>
            </select>
            <span className="text-xs text-gray-400 ml-auto">{filteredRows.length} 条</span>
          </div>
          {loadingRows ? <Spinner /> : filteredRows.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">没有匹配的记录</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-4 py-2 font-medium">操作</th>
                    <th className="text-left px-4 py-2 font-medium">关键词</th>
                    <th className="text-right px-4 py-2 font-medium">搜索量</th>
                    <th className="text-left px-4 py-2 font-medium">类型</th>
                    <th className="text-right px-4 py-2 font-medium">排名</th>
                    <th className="text-left px-4 py-2 font-medium">排名词</th>
                    <th className="text-right px-4 py-2 font-medium">排名量</th>
                    <th className="text-left px-4 py-2 font-medium">成效</th>
                    <th className="text-right px-4 py-2 font-medium">得分</th>
                    <th className="text-left px-4 py-2 font-medium">提交日期</th>
                    <th className="text-left px-4 py-2 font-medium">记录日期</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredRows.map((r, i) => {
                    const st = EFFECTIVENESS_STYLE[r.effectiveness] ?? { bg: 'bg-gray-50', text: 'text-gray-500' }
                    return (
                      <tr key={i} className="text-gray-700">
                        <td className="px-4 py-2 text-xs text-gray-500">{r.operation_type ?? '—'}</td>
                        <td className="px-4 py-2">{r.keyword}</td>
                        <td className="px-4 py-2 text-right text-xs">{r.search_volume?.toLocaleString() ?? '—'}</td>
                        <td className="px-4 py-2 text-xs">{r.content_type === 'game' ? '游戏' : r.content_type === 'app' ? '应用' : '—'}</td>
                        <td className="px-4 py-2 text-right text-xs">{r.rank_position ?? '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{r.keyword}</td>
                        <td className="px-4 py-2 text-right text-xs">{r.rank_volume?.toLocaleString() ?? '—'}</td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>{r.effectiveness}</span>
                        </td>
                        <td className={`px-4 py-2 text-right text-xs font-semibold ${r.score == null ? 'text-gray-300' : r.score > 0 ? 'text-green-600' : 'text-red-400'}`}>
                          {r.score == null ? '—' : r.score.toFixed(1)}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-400">{r.content_date ?? '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-400">{r.discovery_date}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showManageModal && (
        <ManageCompetitorSitesModal
          onClose={() => setShowManageModal(false)}
          onSaved={() => { setShowManageModal(false); loadSites() }}
        />
      )}
    </div>
  )
}

interface ManageSite { id: string; domain: string; name: string; has_rank_title: boolean }

// 列出全部站点（不含自己的站点，自己的站点由 task_groups.site_domains 自动
// 识别，见 fetchOwnSiteDomains）让用户勾选哪些要当竞品追踪排名——用户明确说
// 不需要重新填站点资料（域名/CSS选择器那些在"网站管理"里已经配过了），这里
// 只是批量开关 has_rank_title，不是新建站点。
function ManageCompetitorSitesModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [sites, setSites] = useState<ManageSite[]>([])
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/research/competitor-sites?all=true').then(r => r.json()).then(d => {
      const list = (d.sites ?? []) as ManageSite[]
      setSites(list)
      setChecked(new Set(list.filter(s => s.has_rank_title).map(s => s.id)))
    }).finally(() => setLoading(false))
  }, [])

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const changed = sites.filter(s => s.has_rank_title !== checked.has(s.id))
      await Promise.all(changed.map(s =>
        fetch('/api/sites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, has_rank_title: checked.has(s.id) }) })
      ))
      onSaved()
    } finally { setSaving(false) }
  }

  const filtered = query.trim()
    ? sites.filter(s => s.domain.toLowerCase().includes(query.toLowerCase()) || s.name.toLowerCase().includes(query.toLowerCase()))
    : sites

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">管理竞品站点</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-3 border-b border-gray-100">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索域名或站点名…" autoFocus
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
          <p className="text-xs text-gray-400 mt-1.5">勾选的站点会开启"排名"追踪，每天自动统计新增内容的成效</p>
        </div>
        <div className="px-6 py-3 overflow-y-auto flex-1">
          {loading ? <Spinner /> : filtered.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">没有匹配的站点</p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map(s => (
                <label key={s.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="truncate">{s.domain}</span>
                  <span className="text-xs text-gray-400 truncate">{s.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════ 研究周/月/年报 ══════════════════════════════

interface ReportListItem {
  id: string
  period_type: 'week' | 'month' | 'year'
  period_start: string
  period_end: string
  status: 'running' | 'completed' | 'failed'
  sites_considered: number
  sites_analyzed: number
  sites_skipped: number
  gemini_call_count: number
  gemini_fail_count: number
  error: string | null
}

interface SiteAnalysisEntry {
  site_id: string
  domain: string
  name: string
  skipped: boolean
  skip_reason: string | null
  analysis: string | null
  error: string | null
  pc_weight?: number | null
  mobile_weight?: number | null
  avg_index_count?: number | null
  avg_mobile_ip?: number | null
}

interface CompetitorEffectivenessClaim {
  site_id: string
  domain: string
  keyword: string
  content_type: string
  rank_position: number | null
  volume: number
  score: number
}

interface CompetitorEffectivenessSummary {
  effective: number
  tracking: number
  invalid: number
  topClaims: CompetitorEffectivenessClaim[]
  contentBreakdown?: { 游戏: number; 应用: number }
}

interface OwnEffectivenessClaim {
  keyword: string
  url: string | null
  rank_position: number | null
  volume: number
  score: number
}

interface OwnEffectivenessGroup {
  group_id: string
  group_name: string
  ranked: number
  indexed: number
  tracking: number
  invalid: number
  topClaims: OwnEffectivenessClaim[]
  contentBreakdown?: { 游戏: number; 应用: number; 专题: number; 资讯: number }
}

interface EnvironmentTierStats {
  siteCount: number
  pcWeight: number | null
  mobileWeight: number | null
  indexCount: number | null
}

interface EnvironmentStats {
  asOfDate: string
  overall: EnvironmentTierStats
  tiers: { 大站: EnvironmentTierStats; 中站: EnvironmentTierStats; 小站: EnvironmentTierStats }
}

// report_sections 2026-08-10 起改成短字段+按组说明（environmentNote/ownGroupNotes/
// competitorNote），旧报告还是老的四个长字段（environment/ownEffectiveness/
// competitorEffectiveness）——两套字段都保留在类型里，渲染时优先取新字段、
// 没有再退回旧字段，老报告不会显示空白。conclusion 两版字段名一直相同不用兼容。
interface ReportDetail extends ReportListItem {
  site_analyses: SiteAnalysisEntry[]
  competitor_effectiveness: CompetitorEffectivenessSummary | null
  own_effectiveness: OwnEffectivenessGroup[] | null
  environment_stats: EnvironmentStats | null
  report_sections: {
    environmentNote?: string; ownGroupNotes?: Record<string, string>; competitorNote?: string
    environment?: string; ownEffectiveness?: string; competitorEffectiveness?: string
    conclusion: string
  } | null
}

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  running:   { label: '生成中', bg: 'bg-amber-50', text: 'text-amber-600' },
  completed: { label: '已完成', bg: 'bg-green-50', text: 'text-green-600' },
  failed:    { label: '失败',   bg: 'bg-red-50',   text: 'text-red-600' },
}

function ReportTab({ periodType }: { periodType: 'week' | 'month' | 'year' }) {
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/research/reports?type=${periodType}`).then(r => r.json()).then(d => {
      const list = (d.reports ?? []) as ReportListItem[]
      setReports(list)
      setSelectedId(list.length > 0 ? list[0].id : null)
    }).finally(() => setLoading(false))
  }, [periodType])

  if (loading) return <Spinner />
  if (reports.length === 0) return <p className="text-sm text-gray-300 text-center py-12">还没有报告</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {reports.map(r => {
          const st = STATUS_LABELS[r.status]
          return (
            <button key={r.id} onClick={() => setSelectedId(r.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-colors ${selectedId === r.id ? 'border-green-400 bg-green-50 text-green-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              {r.period_start} ~ {r.period_end}
              <span className={`px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
            </button>
          )
        })}
      </div>

      {selectedId && <ReportDetailView reportId={selectedId} />}
    </div>
  )
}

function ReportDetailView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [siteWeights, setSiteWeights] = useState<Record<string, { pc: number; mobile: number }>>({})
  const [loading, setLoading] = useState(true)
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setExpandedSiteId(null)
    fetch(`/api/research/reports/${reportId}`).then(r => r.json()).then(d => {
      setReport(d.report)
      setSiteWeights(d.siteWeights ?? {})
    }).finally(() => setLoading(false))
  }, [reportId])

  if (loading || !report) return <Spinner />

  const analyzedSites = report.site_analyses.filter(s => !s.skipped && s.analysis)
  const skippedSites = report.site_analyses.filter(s => s.skipped)
  const failedSites = report.site_analyses.filter(s => !s.skipped && !s.analysis)
  const azSites: AZPickerSite[] = analyzedSites.map(s => ({
    id: s.site_id, domain: s.domain, name: s.name,
    pcWeight: s.pc_weight ?? siteWeights[s.site_id]?.pc ?? null,
    mobileWeight: s.mobile_weight ?? siteWeights[s.site_id]?.mobile ?? null,
  }))
  const expandedSite = analyzedSites.find(s => s.site_id === expandedSiteId) ?? null

  const sections = report.report_sections
  const envNote = sections?.environmentNote ?? sections?.environment ?? null
  const competitorNote = sections?.competitorNote ?? sections?.competitorEffectiveness ?? null
  // 老报告只有一段不分组的 ownEffectiveness 文字——只有一个组时可以直接当那个组的说明用；
  // 多个组时没法知道旧文字对应哪个组，宁可不显示也不要显示错组。
  const ownNoteFor = (groupName: string) =>
    sections?.ownGroupNotes?.[groupName] ??
    (report.own_effectiveness?.length === 1 ? sections?.ownEffectiveness : undefined) ?? null

  return (
    <div className="space-y-5">
      {report.status === 'failed' && report.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{report.error}</p>
      )}

      {(report.environment_stats || envNote) && (
        <div className="bg-white rounded-xl border border-sky-200 p-5">
          <p className="text-sm font-semibold mb-3 text-sky-700">大环境</p>
          {report.environment_stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <EnvStatCard label="整体" stats={report.environment_stats.overall} />
              <EnvStatCard label="大站" stats={report.environment_stats.tiers.大站} />
              <EnvStatCard label="中站" stats={report.environment_stats.tiers.中站} />
              <EnvStatCard label="小站" stats={report.environment_stats.tiers.小站} />
            </div>
          )}
          {envNote && <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{envNote}</p>}
        </div>
      )}

      {report.own_effectiveness && report.own_effectiveness.length > 0 && (
        <div className="bg-white rounded-xl border border-blue-200 p-5">
          <p className="text-sm font-semibold mb-3 text-blue-700">自己站点成效</p>
          <div className="space-y-4">
            {report.own_effectiveness.map((g, i) => {
              const note = ownNoteFor(g.group_name)
              return (
                <div key={g.group_id} className={i > 0 ? 'pt-4 border-t border-gray-100' : ''}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-800">{g.group_name}</span>
                    <span className="text-xs text-gray-400">获取排名{g.ranked} · 获取收录{g.indexed} · 追踪中{g.tracking} · 无效{g.invalid}</span>
                  </div>
                  {g.contentBreakdown && (
                    <p className="text-xs text-gray-400 mb-1.5">
                      游戏{g.contentBreakdown.游戏} · 应用{g.contentBreakdown.应用} · 专题{g.contentBreakdown.专题} · 资讯{g.contentBreakdown.资讯}
                    </p>
                  )}
                  {note && <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed mb-1.5">{note}</p>}
                  {g.topClaims.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">本周发力最多的词（按评分，非搜索量）</p>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        {g.topClaims.slice(0, 5).map(c => `${c.keyword}(第${c.rank_position ?? '未排名'}名/量${c.volume}/分${c.score})`).join('、')}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {report.competitor_effectiveness && (
        <div className="bg-white rounded-xl border border-green-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-green-700">竞品成效</span>
            <span className="text-xs text-gray-400">
              有效{report.competitor_effectiveness.effective} · 追踪中{report.competitor_effectiveness.tracking} · 无效{report.competitor_effectiveness.invalid}
            </span>
          </div>
          {report.competitor_effectiveness.contentBreakdown && (
            <p className="text-xs text-gray-400 mb-2">
              游戏{report.competitor_effectiveness.contentBreakdown.游戏} · 应用{report.competitor_effectiveness.contentBreakdown.应用}
            </p>
          )}
          {competitorNote && <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed mb-2">{competitorNote}</p>}
          {report.competitor_effectiveness.topClaims.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">本周发力最多的词（按评分，非搜索量）</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                {report.competitor_effectiveness.topClaims.slice(0, 5).map(c => `${c.domain}·${c.keyword}(第${c.rank_position}名/量${c.volume}/分${c.score})`).join('、')}
              </p>
            </div>
          )}
        </div>
      )}

      {sections?.conclusion && <ReportSectionCard title="综合结论" color="violet" text={sections.conclusion} />}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-700">各站点分析</span>
          <span className="text-xs text-gray-400">{analyzedSites.length} 个</span>
        </div>
        {analyzedSites.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-8">这段时间没有站点产出有效分析</p>
        ) : (
          <>
            <SiteAZPicker sites={azSites} selectedId={expandedSiteId} onSelect={id => setExpandedSiteId(prev => prev === id ? null : id)} />
            {expandedSite && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-sm font-medium text-gray-800 mb-1.5">{expandedSite.domain}（{expandedSite.name}）</p>
                {(expandedSite.pc_weight != null || expandedSite.mobile_weight != null || expandedSite.avg_index_count != null || expandedSite.avg_mobile_ip != null) && (
                  <p className="text-xs text-gray-400 mb-2">
                    权重 PC{expandedSite.pc_weight ?? '—'} · M{expandedSite.mobile_weight ?? '—'}
                    　收录均值{expandedSite.avg_index_count != null ? Math.round(expandedSite.avg_index_count).toLocaleString() : '—'}
                    　移动IP均值{expandedSite.avg_mobile_ip != null ? Math.round(expandedSite.avg_mobile_ip).toLocaleString() : '—'}
                  </p>
                )}
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{expandedSite.analysis}</p>
              </div>
            )}
          </>
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

function EnvStatCard({ label, stats }: { label: string; stats: EnvironmentTierStats }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-400 mb-1">{label}{label !== '整体' ? `（${stats.siteCount}）` : ''}</p>
      <p className="text-sm text-gray-700">PC{stats.pcWeight ?? '—'} · M{stats.mobileWeight ?? '—'}</p>
      <p className="text-xs text-gray-500">收录{stats.indexCount != null ? stats.indexCount.toLocaleString() : '—'}</p>
    </div>
  )
}

function ReportSectionCard({ title, color, text }: { title: string; color: 'sky' | 'blue' | 'green' | 'violet'; text: string }) {
  const borderMap = { sky: 'border-sky-200', blue: 'border-blue-200', green: 'border-green-200', violet: 'border-violet-200' }
  const textMap = { sky: 'text-sky-700', blue: 'text-blue-700', green: 'text-green-700', violet: 'text-violet-700' }
  return (
    <div className={`bg-white rounded-xl border ${borderMap[color]} p-5`}>
      <p className={`text-sm font-semibold mb-2 ${textMap[color]}`}>{title}</p>
      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{text || '（无内容）'}</p>
    </div>
  )
}
