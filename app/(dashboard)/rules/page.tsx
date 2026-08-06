'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'

// ── Types ──────────────────────────────────────────────────────────────────

interface SiteInfo { id: string; domain: string; name: string }

interface SiteFull extends SiteInfo {
  research_notes: string | null
  game_categories: string[] | null
  app_categories: string[] | null
  publish_mode: 'auto' | 'manual' | null
  publish_interval_notes: string | null
  content_focus: 'new' | 'update' | 'mixed' | null
  has_rank_title: boolean
}

interface ResearchTask {
  id: string
  site_id: string
  date_start: string
  date_end: string
  status: 'in_progress' | 'completed'
  promoted_rule_id: string | null
  created_at: string
  completed_at: string | null
  site: { domain: string; name: string } | null
}

interface EffectivenessRow {
  keyword: string
  stat_date: string
  url: string | null
  rank_position: number | null
  prev_rank: number | null
  volume: number
  score: number | null
  searchVolumeRising: { volume: number; prev_volume: number; volume_change: number } | null
}

interface ResearchTaskDetail {
  task: ResearchTask & { ai_analysis: string | null; ai_candidate_rule: { name: string; type: string; description: string; confidence: number } | null }
  site: SiteFull
  weightTrend: { record_date: string; pc_weight: number; mobile_weight: number }[]
  indexTrend: { snapshot_date: string; index_count: number }[]
  rankChangeTrend: { date: string; rankup: number; rankdown: number }[]
  newKeywordsTrend: { date: string; app: number; game: number }[]
  effectivenessRows: EffectivenessRow[]
}

interface SiteSuggestion { siteId: string; domain: string; month: string; count: number; keywords: string[] }
interface DecliningRule { name: string; histRate: number; recentRate: number; histCount: number; recentCount: number }

interface Rule {
  id: string
  rule_number: number
  name: string
  type: 'add' | 'update' | 'mixed'
  status: 'active' | 'inactive' | 'testing'
  source: 'experiment' | 'manual' | 'ai' | 'data'
  stage_applicability: string[]
  description: string | null
  confidence: number
  success_count: number
  fail_count: number
  priority: number
  site_ids: string[]
  competitor_domains: string[]
  created_at: string
  tracked_success: number
  tracked_fail: number
  tracked_tracking: number
  avg_score: number | null
  avg_score_count: number
}

interface RuleForm {
  name: string
  type: 'add' | 'update' | 'mixed'
  status: 'active' | 'inactive' | 'testing'
  source: 'experiment' | 'manual' | 'ai' | 'data'
  stage_applicability: string[]
  description: string
  confidence: number
  success_count: number
  fail_count: number
  priority: number
  site_ids: string[]
  competitor_domains: string[]
}

const EMPTY_FORM: RuleForm = {
  name: '', type: 'add', status: 'active', source: 'manual',
  stage_applicability: [],
  description: '', confidence: 0, success_count: 0, fail_count: 0, priority: 0,
  site_ids: [], competitor_domains: [],
}

const STAGE_TYPES = ['起站期', '成长期', '成熟期', '通用']

const TYPE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  add:    { label: '新增', bg: 'bg-green-50',  text: 'text-green-700' },
  update: { label: '更新', bg: 'bg-blue-50',   text: 'text-blue-700' },
  mixed:  { label: '混合', bg: 'bg-purple-50', text: 'text-purple-700' },
}
const SOURCE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  manual:     { label: '手动', bg: 'bg-gray-100',   text: 'text-gray-600' },
  experiment: { label: '实验', bg: 'bg-orange-50',  text: 'text-orange-600' },
  data:       { label: '数据', bg: 'bg-cyan-50',    text: 'text-cyan-700' },
  ai:         { label: 'AI',   bg: 'bg-violet-50',  text: 'text-violet-700' },
}
const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  active:   { label: '启用',  bg: 'bg-green-50',  text: 'text-green-700' },
  inactive: { label: '停用',  bg: 'bg-gray-100',  text: 'text-gray-500' },
  testing:  { label: '测试中', bg: 'bg-yellow-50', text: 'text-yellow-700' },
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function fmtVol(v: number) { return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toLocaleString() }

function todayMY() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }
function daysAgoMY(n: number) { return new Date(Date.now() + 8 * 3600000 - n * 86400000).toISOString().slice(0, 10) }

export default function RulesPage() {
  const { role } = useUser()
  const router = useRouter()
  const canEdit = role === 'super' || role === 'admin'

  useEffect(() => {
    if (role === 'normal') router.replace('/task-groups')
  }, [role, router])

  const [activeTab, setActiveTab] = useState<'research' | 'suggestions' | 'ruleList' | 'monthlyTrend'>('research')
  const [allSites, setAllSites] = useState<SiteInfo[]>([])

  useEffect(() => {
    fetch('/api/sites')
      .then(r => r.json())
      .then(d => setAllSites((d.sites ?? []).map((s: SiteInfo) => ({ id: s.id, domain: s.domain, name: s.name }))))
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">规则中心</h1>
        <p className="text-sm text-gray-400 mt-0.5">站点研究工作台 — 人工发起研究，AI 辅助分析，沉淀成规则</p>
      </div>

      <div className="flex border-b border-gray-100 mb-6">
        <button onClick={() => setActiveTab('research')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'research' ? 'text-green-600 border-green-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
          站点研究
        </button>
        <button onClick={() => setActiveTab('suggestions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'suggestions' ? 'text-amber-600 border-amber-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
          推荐研究
        </button>
        <button onClick={() => setActiveTab('ruleList')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'ruleList' ? 'text-indigo-600 border-indigo-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
          规则列表
        </button>
        <button onClick={() => setActiveTab('monthlyTrend')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'monthlyTrend' ? 'text-rose-600 border-rose-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
          月度趋势
        </button>
      </div>

      {activeTab === 'research' && <ResearchTab allSites={allSites} />}
      {activeTab === 'suggestions' && <SuggestionsTab allSites={allSites} onStartResearch={() => setActiveTab('research')} />}
      {activeTab === 'ruleList' && <RuleListTab canEdit={canEdit} isSuper={role === 'super'} allSites={allSites} />}
      {activeTab === 'monthlyTrend' && <MonthlyTrendTab />}
    </div>
  )
}

// ══════════════════════════════ 站点研究 ══════════════════════════════

// 建新研究任务时可以从"推荐研究"tab带一个预填过来（site_id + 建议的时间范围），
// 用 module 级变量简单传值，避免为这一个跨tab的小需求专门上 context/状态管理库。
let pendingNewTask: { siteId: string; dateStart: string; dateEnd: string } | null = null

function ResearchTab({ allSites }: { allSites: SiteInfo[] }) {
  const [tasks, setTasks] = useState<ResearchTask[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  function loadTasks() {
    setLoading(true)
    fetch('/api/rules/research-tasks').then(r => r.json()).then(d => setTasks(d.tasks ?? [])).finally(() => setLoading(false))
  }
  useEffect(loadTasks, [])

  useEffect(() => {
    if (pendingNewTask) { setShowNewModal(true) }
  }, [])

  return (
    <div className="grid grid-cols-[280px_1fr] gap-5">
      <div>
        <button onClick={() => setShowNewModal(true)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors mb-3">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
          新建研究任务
        </button>
        {loading ? <Spinner /> : tasks.length === 0 ? (
          <p className="text-xs text-gray-300 text-center py-8">还没有研究任务</p>
        ) : (
          <div className="space-y-1.5">
            {tasks.map(t => (
              <button key={t.id} onClick={() => setSelectedId(t.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${selectedId === t.id ? 'border-green-400 bg-green-50/60' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800 truncate">{t.site?.domain ?? t.site_id.slice(0, 8)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ml-1 ${t.status === 'completed' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                    {t.status === 'completed' ? '已完成' : '进行中'}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">{t.date_start} ~ {t.date_end}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        {selectedId ? (
          <ResearchTaskDetailView taskId={selectedId} onChanged={loadTasks} />
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-gray-300">
            <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-sm">左边选一个研究任务，或者新建一个</span>
          </div>
        )}
      </div>

      {showNewModal && (
        <NewResearchTaskModal
          allSites={allSites}
          onClose={() => { setShowNewModal(false); pendingNewTask = null }}
          onCreated={(id) => { setShowNewModal(false); pendingNewTask = null; loadTasks(); setSelectedId(id) }}
        />
      )}
    </div>
  )
}

function NewResearchTaskModal({ allSites, onClose, onCreated }: { allSites: SiteInfo[]; onClose: () => void; onCreated: (id: string) => void }) {
  const prefill = pendingNewTask
  const [siteQ, setSiteQ] = useState('')
  const [siteId, setSiteId] = useState(prefill?.siteId ?? '')
  const [dateStart, setDateStart] = useState(prefill?.dateStart ?? daysAgoMY(30))
  const [dateEnd, setDateEnd] = useState(prefill?.dateEnd ?? todayMY())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const filteredSites = siteQ.trim() ? allSites.filter(s => s.domain.includes(siteQ) || s.name.toLowerCase().includes(siteQ.toLowerCase())) : allSites

  async function create() {
    if (!siteId) { setErr('请选一个站点'); return }
    setSaving(true); setErr('')
    try {
      const res = await fetch('/api/rules/research-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, date_start: dateStart, date_end: dateEnd }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || '创建失败'); return }
      onCreated(d.task.id)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">新建研究任务</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">站点</label>
            {siteId ? (
              <div className="flex items-center justify-between text-sm border border-gray-200 rounded-lg px-3 py-2">
                <span className="text-gray-800">{allSites.find(s => s.id === siteId)?.domain}</span>
                <button onClick={() => setSiteId('')} className="text-xs text-gray-400 hover:text-red-500">换一个</button>
              </div>
            ) : (
              <>
                <input type="text" value={siteQ} onChange={e => setSiteQ(e.target.value)} placeholder="搜索域名…" autoFocus
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 mb-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
                <div className="max-h-40 overflow-y-auto border border-gray-100 rounded-lg bg-gray-50 p-1.5 space-y-0.5">
                  {filteredSites.slice(0, 50).map(s => (
                    <button key={s.id} onClick={() => setSiteId(s.id)}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-white text-sm text-gray-700 transition-colors">
                      {s.domain} <span className="text-xs text-gray-400">{s.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">时间范围</label>
            <div className="flex items-center gap-1.5 mb-2">
              {[30, 60, 90].map(n => (
                <button key={n} onClick={() => { setDateStart(daysAgoMY(n)); setDateEnd(todayMY()) }}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">近{n}天</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
              <span className="text-gray-300">~</span>
              <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} max={todayMY()}
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
            </div>
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button onClick={create} disabled={saving || !siteId}
            className="px-4 py-2 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
            {saving ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CATEGORY_FIELDS: { key: 'game_categories' | 'app_categories'; label: string }[] = [
  { key: 'game_categories', label: '游戏分类' },
  { key: 'app_categories', label: '应用分类' },
]

function ResearchTaskDetailView({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<ResearchTaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [siteForm, setSiteForm] = useState<Partial<SiteFull> | null>(null)
  const [catInput, setCatInput] = useState<Record<string, string>>({ game_categories: '', app_categories: '' })
  const [savingSite, setSavingSite] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [showPromoteModal, setShowPromoteModal] = useState(false)

  function load() {
    setLoading(true)
    fetch(`/api/rules/research-tasks/${taskId}`).then(r => r.json()).then(d => {
      setDetail(d)
      setSiteForm({
        research_notes: d.site.research_notes ?? '',
        game_categories: d.site.game_categories ?? [],
        app_categories: d.site.app_categories ?? [],
        publish_mode: d.site.publish_mode ?? null,
        publish_interval_notes: d.site.publish_interval_notes ?? '',
        content_focus: d.site.content_focus ?? null,
      })
    }).finally(() => setLoading(false))
  }
  useEffect(load, [taskId])

  async function saveSiteProfile() {
    if (!detail || !siteForm) return
    setSavingSite(true)
    try {
      await fetch('/api/sites', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: detail.site.id, ...siteForm }),
      })
    } finally { setSavingSite(false) }
  }

  function addCategory(key: 'game_categories' | 'app_categories') {
    const val = catInput[key].trim()
    if (!val || !siteForm) return
    const cur = siteForm[key] ?? []
    if (cur.includes(val)) return
    setSiteForm(prev => ({ ...prev, [key]: [...(prev?.[key] ?? []), val] }))
    setCatInput(prev => ({ ...prev, [key]: '' }))
  }
  function removeCategory(key: 'game_categories' | 'app_categories', val: string) {
    setSiteForm(prev => ({ ...prev, [key]: (prev?.[key] ?? []).filter(v => v !== val) }))
  }

  async function runAnalysis() {
    setAnalyzing(true)
    try {
      const res = await fetch(`/api/rules/research-tasks/${taskId}/analyze`, { method: 'POST' })
      const d = await res.json()
      if (res.ok) setDetail(prev => prev ? { ...prev, task: { ...prev.task, ai_analysis: d.ai_analysis, ai_candidate_rule: d.ai_candidate_rule } } : prev)
      else alert(d.error || 'AI 分析失败')
    } finally { setAnalyzing(false) }
  }

  async function markComplete() {
    await fetch(`/api/rules/research-tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete' }),
    })
    load(); onChanged()
  }

  if (loading || !detail) return <Spinner />
  const { task, site, weightTrend, indexTrend, rankChangeTrend, newKeywordsTrend, effectivenessRows } = detail

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{site.domain}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{site.name} · {task.date_start} ~ {task.date_end}</p>
        </div>
        <div className="flex items-center gap-2">
          {task.status === 'in_progress' && (
            <button onClick={markComplete} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">标记完成</button>
          )}
          <span className={`text-xs px-2.5 py-1 rounded-full ${task.status === 'completed' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
            {task.status === 'completed' ? '已完成' : '进行中'}
          </span>
        </div>
      </div>

      {/* 人工补充信息 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-700">站点研究档案 <span className="text-xs text-gray-400 font-normal">（存在站点本身，下次研究这个站点直接带出来）</span></p>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">为什么监控它</label>
          <textarea value={siteForm?.research_notes ?? ''} onChange={e => setSiteForm(p => ({ ...p, research_notes: e.target.value }))}
            rows={2} placeholder="比如：同类目里数据表现突出，怀疑有可复制的打法"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {CATEGORY_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {(siteForm?.[key] ?? []).map(v => (
                  <span key={v} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 rounded px-2 py-0.5">
                    {v}<button onClick={() => removeCategory(key, v)} className="text-blue-300 hover:text-red-500">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input type="text" value={catInput[key]} onChange={e => setCatInput(p => ({ ...p, [key]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addCategory(key)} placeholder="输入后回车添加"
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">发布方式</label>
            <div className="flex items-center gap-3 mb-1.5">
              {(['auto', 'manual'] as const).map(m => (
                <label key={m} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                  <input type="radio" checked={siteForm?.publish_mode === m} onChange={() => setSiteForm(p => ({ ...p, publish_mode: m }))} />
                  {m === 'auto' ? '自动发布' : '手动发布'}
                </label>
              ))}
            </div>
            <input type="text" value={siteForm?.publish_interval_notes ?? ''} onChange={e => setSiteForm(p => ({ ...p, publish_interval_notes: e.target.value }))}
              placeholder="间隔说明，比如：工作日每天1-2篇"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">内容侧重</label>
            <div className="flex items-center gap-3">
              {([['new', '新增为主'], ['update', '更新为主'], ['mixed', '都有']] as const).map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                  <input type="radio" checked={siteForm?.content_focus === v} onChange={() => setSiteForm(p => ({ ...p, content_focus: v }))} />
                  {l}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={saveSiteProfile} disabled={savingSite}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50 transition-colors">
            {savingSite ? '保存中…' : '保存档案'}
          </button>
        </div>
      </div>

      {/* 历史监控数据 */}
      <div className="grid grid-cols-2 gap-4">
        <TrendCard title="权重变化" rows={weightTrend} render={(r: { record_date: string; pc_weight: number; mobile_weight: number }) => `${r.record_date.slice(5)}：PC${r.pc_weight} / 移动${r.mobile_weight}`} />
        <TrendCard title="收录量变化" rows={indexTrend} render={(r: { snapshot_date: string; index_count: number }) => `${r.snapshot_date.slice(5)}：${r.index_count.toLocaleString()}`} />
        <TrendCard title="涨跌词（每日）" rows={rankChangeTrend} render={(r: { date: string; rankup: number; rankdown: number }) => `${r.date.slice(5)}：涨${r.rankup} / 跌${r.rankdown}`} />
        <TrendCard title="新增关键词（每日）" rows={newKeywordsTrend} render={(r: { date: string; app: number; game: number }) => `${r.date.slice(5)}：应用${r.app} / 游戏${r.game}`} />
      </div>

      {/* 排名成效 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-gray-700">排名成效（按得分排序）</span>
            <span className="text-xs text-gray-400 ml-2">带🔥的词，搜索量同期也在涨</span>
          </div>
          <span className="text-xs text-gray-400">{effectivenessRows.length} 条</span>
        </div>
        {effectivenessRows.length === 0 ? (
          <p className="text-sm text-gray-300 text-center py-8">这段时间没有追踪到排名数据（要先在网站管理给这个站点开"排名"开关，"涨跌"开关不带具体排名）</p>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
            {effectivenessRows.slice(0, 100).map((r, i) => (
              <div key={i} className="px-4 py-2 flex items-center justify-between text-sm">
                <div className="min-w-0 flex-1">
                  <span className="text-gray-800 truncate">
                    {r.searchVolumeRising && <span className="mr-1" title={`搜索量 ${r.searchVolumeRising.prev_volume} → ${r.searchVolumeRising.volume}`}>🔥</span>}
                    {r.keyword}
                  </span>
                  {r.rank_position != null && (
                    <span className="text-xs text-gray-400 ml-2">
                      第{r.rank_position}名{r.prev_rank != null && r.prev_rank !== r.rank_position ? `（原第${r.prev_rank}名）` : ''} · 搜索量{fmtVol(r.volume)}
                    </span>
                  )}
                </div>
                <span className={`text-sm font-semibold ${r.score == null ? 'text-gray-300' : r.score > 0 ? 'text-green-600' : 'text-red-400'}`}>
                  {r.score == null ? '—' : r.score.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI 分析 */}
      <div className="bg-white rounded-xl border border-violet-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">AI 分析</span>
          <button onClick={runAnalysis} disabled={analyzing}
            className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
            {analyzing ? '分析中…' : task.ai_analysis ? '重新分析' : '开始 AI 分析'}
          </button>
        </div>
        {task.ai_analysis && <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{task.ai_analysis}</p>}
        {task.ai_candidate_rule && (
          <div className="border border-dashed border-violet-200 rounded-lg p-3 bg-violet-50/40">
            <p className="text-sm font-medium text-gray-800">候选规则：{task.ai_candidate_rule.name}</p>
            <p className="text-xs text-gray-500 mt-1">{task.ai_candidate_rule.description}</p>
            {!task.promoted_rule_id ? (
              <button onClick={() => setShowPromoteModal(true)}
                className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors">转成规则</button>
            ) : (
              <p className="mt-2 text-xs text-green-600">✓ 已转成规则</p>
            )}
          </div>
        )}
      </div>

      {showPromoteModal && task.ai_candidate_rule && (
        <PromoteRuleModal
          taskId={taskId}
          candidate={task.ai_candidate_rule}
          onClose={() => setShowPromoteModal(false)}
          onDone={() => { setShowPromoteModal(false); load(); onChanged() }}
          promoting={promoting}
          setPromoting={setPromoting}
        />
      )}
    </div>
  )
}

function TrendCard<T>({ title, rows, render }: { title: string; rows: T[]; render: (r: T) => string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
        <span className="text-xs font-semibold text-gray-600">{title}</span>
      </div>
      <div className="max-h-40 overflow-y-auto px-4 py-2">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-300 py-3 text-center">无数据</p>
        ) : (
          <div className="space-y-1">
            {rows.map((r, i) => <p key={i} className="text-xs text-gray-600">{render(r)}</p>)}
          </div>
        )}
      </div>
    </div>
  )
}

function PromoteRuleModal({ taskId, candidate, onClose, onDone, promoting, setPromoting }: {
  taskId: string
  candidate: { name: string; type: string; description: string; confidence: number }
  onClose: () => void
  onDone: () => void
  promoting: boolean
  setPromoting: (v: boolean) => void
}) {
  const [name, setName] = useState(candidate.name)
  const [type, setType] = useState(candidate.type)
  const [description, setDescription] = useState(candidate.description)
  const [confidence, setConfidence] = useState(candidate.confidence)

  async function submit() {
    setPromoting(true)
    try {
      const res = await fetch(`/api/rules/research-tasks/${taskId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote', rule: { name, type, description, confidence } }),
      })
      if (res.ok) onDone()
      else { const d = await res.json(); alert(d.error || '转成规则失败') }
    } finally { setPromoting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-100"><h3 className="text-base font-semibold text-gray-800">转成规则</h3></div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">规则名称</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">类型</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700">
              <option value="add">新增</option><option value="update">更新</option><option value="mixed">混合</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">说明</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">信心度 %</label>
            <input type="number" min={0} max={100} value={confidence} onChange={e => setConfidence(Number(e.target.value))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button onClick={submit} disabled={promoting || !name.trim()}
            className="px-4 py-2 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
            {promoting ? '创建中…' : '创建规则'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════ 推荐研究 ══════════════════════════════

function SuggestionsTab({ allSites, onStartResearch }: { allSites: SiteInfo[]; onStartResearch: () => void }) {
  const [siteSuggestions, setSiteSuggestions] = useState<SiteSuggestion[]>([])
  const [decliningRules, setDecliningRules] = useState<DecliningRule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/rules/research-suggestions').then(r => r.json()).then(d => {
      setSiteSuggestions(d.siteSuggestions ?? [])
      setDecliningRules(d.decliningRules ?? [])
    }).finally(() => setLoading(false))
  }, [])

  function startResearch(s: SiteSuggestion) {
    pendingNewTask = { siteId: s.siteId, dateStart: daysAgoMY(30), dateEnd: todayMY() }
    onStartResearch()
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-1">值得研究的站点</p>
        <p className="text-xs text-gray-400 mb-3">近90天有效追踪、还没关联规则的案例，按"站点+月份"聚类——数量多说明可能有可复制的规律</p>
        {siteSuggestions.length === 0 ? (
          <p className="text-sm text-gray-300 py-6 text-center">暂无建议，数据不够或都已经关联了规则</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {siteSuggestions.map(s => (
              <div key={`${s.siteId}|${s.month}`} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-gray-800">{s.domain}</span>
                  <span className="text-xs text-gray-400">{s.month}</span>
                </div>
                <p className="text-xs text-gray-500 mb-2">{s.count} 条有效案例：{s.keywords.join('、')}</p>
                <button onClick={() => startResearch(s)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors">发起研究</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-700 mb-1">效果下滑的规则</p>
        <p className="text-xs text-gray-400 mb-3">近30天成功率比历史下降超过20个百分点，可能是打法过时了</p>
        {decliningRules.length === 0 ? (
          <p className="text-sm text-gray-300 py-6 text-center">暂无规则效果明显下滑</p>
        ) : (
          <div className="space-y-2">
            {decliningRules.map(r => (
              <div key={r.name} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-gray-800">{r.name}</span>
                <span className="text-xs text-gray-500">历史{r.histRate}%（{r.histCount}条）→ 近30天{r.recentRate}%（{r.recentCount}条）</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {allSites.length === 0 && null /* keep prop used */}
    </div>
  )
}

// ══════════════════════════════ 规则列表 ══════════════════════════════

function RuleListTab({ canEdit, isSuper, allSites }: { canEdit: boolean; isSuper: boolean; allSites: SiteInfo[] }) {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [allCompetitorDomains, setAllCompetitorDomains] = useState<string[]>([])

  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [filterQ, setFilterQ] = useState('')
  const [rulePage, setRulePage] = useState(0)

  const [showModal, setShowModal] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [siteQ, setSiteQ] = useState('')
  const [compQ, setCompQ] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch('/api/rules')
      .then(r => r.json())
      .then(d => setRules((d.rules ?? []).map((r: Rule) => ({ ...r, site_ids: r.site_ids ?? [], competitor_domains: r.competitor_domains ?? [] }))))
      .finally(() => setLoading(false))

    fetch('/api/task-groups')
      .then(r => r.json())
      .then(d => {
        const domains: string[] = []
        for (const g of (d.groups ?? [])) {
          for (const domain of (g.competitor_domains ?? [])) {
            if (!domains.includes(domain)) domains.push(domain)
          }
        }
        setAllCompetitorDomains(domains.sort())
      })
  }, [])

  const filtered = useMemo(() => rules.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false
    if (filterType   && r.type   !== filterType)   return false
    if (filterSource && r.source !== filterSource)  return false
    if (filterStage  && !r.stage_applicability.includes(filterStage)) return false
    if (filterQ      && !r.name.toLowerCase().includes(filterQ.toLowerCase()) &&
                        !(r.description ?? '').toLowerCase().includes(filterQ.toLowerCase())) return false
    return true
  }), [rules, filterStatus, filterType, filterSource, filterStage, filterQ])

  const RULE_PAGE_SIZE = 20
  const ruleTotalPages = Math.max(1, Math.ceil(filtered.length / RULE_PAGE_SIZE))
  const pagedFiltered = filtered.slice(rulePage * RULE_PAGE_SIZE, (rulePage + 1) * RULE_PAGE_SIZE)
  useEffect(() => { setRulePage(0) }, [filterStatus, filterType, filterSource, filterStage, filterQ])

  function openEdit(rule: Rule) {
    setEditingRule(rule)
    setForm({
      name: rule.name, type: rule.type, status: rule.status, source: rule.source,
      stage_applicability: rule.stage_applicability,
      description: rule.description ?? '',
      confidence: rule.confidence, success_count: rule.success_count,
      fail_count: rule.fail_count, priority: rule.priority,
      site_ids: rule.site_ids ?? [],
      competitor_domains: rule.competitor_domains ?? [],
    })
    setSiteQ(''); setCompQ(''); setShowModal(true)
  }
  function closeModal() { setShowModal(false); setEditingRule(null); setForm(EMPTY_FORM) }

  async function saveRule() {
    if (!editingRule || !form.name.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/rules/${editingRule.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      if (res.ok) {
        const { rule } = await res.json()
        setRules(prev => prev.map(r => r.id === rule.id ? { ...rule, site_ids: rule.site_ids ?? [], competitor_domains: rule.competitor_domains ?? [] } : r))
      }
      closeModal()
    } finally { setSaving(false) }
  }

  async function toggleStatus(rule: Rule) {
    const next = rule.status === 'active' ? 'inactive' : 'active'
    const res = await fetch(`/api/rules/${rule.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
    if (res.ok) {
      const { rule: updated } = await res.json()
      setRules(prev => prev.map(r => r.id === updated.id ? { ...updated, site_ids: updated.site_ids ?? [], competitor_domains: updated.competitor_domains ?? [] } : r))
    }
  }

  async function deleteRule(rule: Rule) {
    if (!confirm(`确认删除 Rule #${rule.rule_number} "${rule.name}"？`)) return
    const res = await fetch(`/api/rules/${rule.id}`, { method: 'DELETE' })
    if (res.ok) setRules(prev => prev.filter(r => r.id !== rule.id))
  }

  function toggleStage(val: string) {
    setForm(prev => { const arr = prev.stage_applicability; return { ...prev, stage_applicability: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] } })
  }
  function toggleSiteId(siteId: string) {
    setForm(prev => ({ ...prev, site_ids: prev.site_ids.includes(siteId) ? prev.site_ids.filter(id => id !== siteId) : [...prev.site_ids, siteId] }))
  }
  function toggleCompDomain(domain: string) {
    setForm(prev => ({ ...prev, competitor_domains: prev.competitor_domains.includes(domain) ? prev.competitor_domains.filter(d => d !== domain) : [...prev.competitor_domains, domain] }))
  }

  const filteredModalSites = siteQ.trim() ? allSites.filter(s => s.domain.includes(siteQ) || s.name.toLowerCase().includes(siteQ.toLowerCase())) : allSites
  const filteredModalComps = compQ.trim() ? allCompetitorDomains.filter(d => d.includes(compQ)) : allCompetitorDomains
  const siteIdToDomain = useMemo(() => { const m = new Map<string, string>(); for (const s of allSites) m.set(s.id, s.domain); return m }, [allSites])

  return (
    <>
      <p className="text-xs text-gray-400 mb-4">这里的规则都是从"站点研究"任务转出来的，或者是 #900/#901 这类自动打标规则——新规则只能从研究任务产出，这里不支持手动新建。</p>

      <div className="flex items-center gap-2 flex-wrap mb-5">
        <input type="text" value={filterQ} onChange={e => setFilterQ(e.target.value)} placeholder="搜索规则名称或说明…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 w-44 text-gray-700" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white">
          <option value="">全部状态</option><option value="active">启用</option><option value="inactive">停用</option><option value="testing">测试中</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white">
          <option value="">全部类型</option><option value="add">新增</option><option value="update">更新</option><option value="mixed">混合</option>
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white">
          <option value="">全部来源</option><option value="manual">手动</option><option value="experiment">实验</option><option value="data">数据</option><option value="ai">AI</option>
        </select>
        <select value={filterStage} onChange={e => setFilterStage(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 bg-white">
          <option value="">全部阶段</option>{STAGE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-1">{filtered.length} / {rules.length} 条</span>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: '全部规则', value: rules.length, color: 'text-gray-800' },
          { label: '启用中', value: rules.filter(r => r.status === 'active').length, color: 'text-green-600' },
          { label: '测试中', value: rules.filter(r => r.status === 'testing').length, color: 'text-yellow-600' },
          { label: '停用', value: rules.filter(r => r.status === 'inactive').length, color: 'text-gray-400' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-sm">{rules.length === 0 ? '暂无规则，去"站点研究"发起一个任务' : '没有符合筛选条件的规则'}</span>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {pagedFiltered.map(rule => {
              const tl = TYPE_LABELS[rule.type]; const sl = SOURCE_LABELS[rule.source]; const stl = STATUS_LABELS[rule.status]
              const appliedSiteDomains = rule.site_ids.map(id => siteIdToDomain.get(id)).filter(Boolean) as string[]
              return (
                <div key={rule.id} className={`bg-white rounded-xl border transition-colors ${rule.status === 'inactive' ? 'border-gray-100 opacity-60' : 'border-gray-200'}`}>
                  <div className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-500">#{rule.rule_number}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-800">{rule.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tl.bg} ${tl.text}`}>{tl.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${stl.bg} ${stl.text}`}>{stl.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sl.bg} ${sl.text}`}>{sl.label}</span>
                      </div>
                      {rule.description && <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{rule.description}</p>}
                      {rule.stage_applicability.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {rule.stage_applicability.map(s => <span key={s} className="text-[10px] bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded">{s}</span>)}
                        </div>
                      )}
                      {(appliedSiteDomains.length > 0 || rule.competitor_domains.length > 0) && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {appliedSiteDomains.slice(0, 4).map(d => <span key={d} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">{d}</span>)}
                          {appliedSiteDomains.length > 4 && <span className="text-[10px] text-gray-400">+{appliedSiteDomains.length - 4} 站点</span>}
                          {rule.competitor_domains.slice(0, 3).map(d => <span key={d} className="text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded border border-orange-100">{d}</span>)}
                          {rule.competitor_domains.length > 3 && <span className="text-[10px] text-gray-400">+{rule.competitor_domains.length - 3} 竞品</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right space-y-1.5">
                      {(rule.tracked_success + rule.tracked_fail + rule.tracked_tracking) > 0 ? (() => {
                        const trackedTotal = rule.tracked_success + rule.tracked_fail + rule.tracked_tracking
                        const resolvedTotal = rule.tracked_success + rule.tracked_fail
                        const trackedRate = resolvedTotal > 0 ? Math.round(rule.tracked_success / resolvedTotal * 100) : null
                        return (
                          <div className="text-right">
                            {trackedRate !== null && <div className="mb-0.5"><span className={`text-base font-bold ${trackedRate >= 70 ? 'text-green-600' : trackedRate >= 40 ? 'text-amber-500' : 'text-red-500'}`}>{trackedRate}%</span></div>}
                            <div className="flex items-center gap-1.5 justify-end">
                              <span className="text-[10px] text-green-600 font-medium">✓{rule.tracked_success}</span>
                              <span className="text-[10px] text-red-400 font-medium">✗{rule.tracked_fail}</span>
                              {rule.tracked_tracking > 0 && <span className="text-[10px] text-amber-500 font-medium">…{rule.tracked_tracking}</span>}
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">{trackedTotal} 条追踪</p>
                            {rule.avg_score !== null && rule.avg_score_count > 0 && (
                              <div className="mt-1 pt-1 border-t border-gray-100 text-right">
                                <span className={`text-xs font-bold ${rule.avg_score > 0 ? 'text-green-600' : rule.avg_score < 0 ? 'text-red-400' : 'text-gray-800'}`}>{rule.avg_score.toFixed(1)}</span>
                                <span className="text-[10px] text-gray-400 ml-1">均分</span>
                                <p className="text-[10px] text-gray-400">{rule.avg_score_count} 条认领</p>
                              </div>
                            )}
                          </div>
                        )
                      })() : rule.confidence > 0 ? (
                        <div><span className="text-base font-bold text-gray-400">{rule.confidence}%</span><p className="text-[10px] text-gray-400">信心度</p></div>
                      ) : null}
                    </div>
                    {canEdit && (
                      <div className="flex-shrink-0 flex items-center gap-1 ml-1">
                        <button onClick={() => openEdit(rule)} title="编辑" className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button onClick={() => toggleStatus(rule)} title={rule.status === 'active' ? '停用' : '启用'}
                          className={`p-1.5 rounded-lg transition-colors ${rule.status === 'active' ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M12 8v4m0 4h.01"/></svg>
                        </button>
                        {isSuper && (
                          <button onClick={() => deleteRule(rule)} title="删除" className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {ruleTotalPages > 1 && (
            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-400">第 {rulePage * RULE_PAGE_SIZE + 1}–{Math.min((rulePage + 1) * RULE_PAGE_SIZE, filtered.length)} 条，共 {filtered.length} 条</span>
              <div className="flex items-center gap-2">
                <button disabled={rulePage === 0} onClick={() => setRulePage(p => p - 1)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors">上一页</button>
                <span className="text-xs text-gray-400 px-1">{rulePage + 1} / {ruleTotalPages}</span>
                <button disabled={rulePage >= ruleTotalPages - 1} onClick={() => setRulePage(p => p + 1)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors">下一页</button>
              </div>
            </div>
          )}
        </>
      )}

      {showModal && editingRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[92vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h3 className="text-base font-semibold text-gray-800">编辑规则 #{editingRule.rule_number}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">规则名称 *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">类型</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as RuleForm['type'] }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700">
                    <option value="add">新增</option><option value="update">更新</option><option value="mixed">混合</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">状态</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as RuleForm['status'] }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700">
                    <option value="active">启用</option><option value="testing">测试中</option><option value="inactive">停用</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">来源</label>
                  <select value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value as RuleForm['source'] }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700">
                    <option value="manual">手动</option><option value="experiment">实验</option><option value="data">数据</option><option value="ai">AI</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">适用阶段</label>
                <div className="flex gap-2 flex-wrap">
                  {STAGE_TYPES.map(s => (
                    <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={form.stage_applicability.includes(s)} onChange={() => toggleStage(s)}
                        className="rounded border-gray-300 text-green-500 focus:ring-green-400" />
                      <span className="text-sm text-gray-700">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">规则说明</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700 resize-none" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">信心度 %</label>
                  <input type="number" min={0} max={100} value={form.confidence} onChange={e => setForm(p => ({ ...p, confidence: Number(e.target.value) }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">历史成功</label>
                  <input type="number" min={0} value={form.success_count} onChange={e => setForm(p => ({ ...p, success_count: Number(e.target.value) }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">历史失败</label>
                  <input type="number" min={0} value={form.fail_count} onChange={e => setForm(p => ({ ...p, fail_count: Number(e.target.value) }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-700" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  应用到自有站点 {form.site_ids.length > 0 && <span className="ml-2 text-indigo-500 font-normal">已选 {form.site_ids.length} 个</span>}
                </label>
                <input type="text" value={siteQ} onChange={e => setSiteQ(e.target.value)} placeholder="搜索站点…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-gray-700" />
                <div className="max-h-36 overflow-y-auto border border-gray-100 rounded-lg bg-gray-50 p-2 space-y-1">
                  {filteredModalSites.length === 0 ? <p className="text-xs text-gray-400 text-center py-2">无匹配站点</p> : filteredModalSites.map(s => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-white px-2 py-1 rounded transition-colors">
                      <input type="checkbox" checked={form.site_ids.includes(s.id)} onChange={() => toggleSiteId(s.id)}
                        className="rounded border-gray-300 text-indigo-500 focus:ring-indigo-300 flex-shrink-0" />
                      <span className="text-sm text-gray-700 truncate">{s.domain}</span>
                      {s.name && <span className="text-xs text-gray-400 truncate">{s.name}</span>}
                    </label>
                  ))}
                </div>
              </div>
              {allCompetitorDomains.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    应用到竞品 {form.competitor_domains.length > 0 && <span className="ml-2 text-orange-500 font-normal">已选 {form.competitor_domains.length} 个</span>}
                  </label>
                  {allCompetitorDomains.length > 6 && (
                    <input type="text" value={compQ} onChange={e => setCompQ(e.target.value)} placeholder="搜索竞品…"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 mb-2 focus:outline-none focus:ring-2 focus:ring-orange-200 text-gray-700" />
                  )}
                  <div className="max-h-28 overflow-y-auto border border-gray-100 rounded-lg bg-gray-50 p-2 space-y-1">
                    {filteredModalComps.map(d => (
                      <label key={d} className="flex items-center gap-2 cursor-pointer hover:bg-white px-2 py-1 rounded transition-colors">
                        <input type="checkbox" checked={form.competitor_domains.includes(d)} onChange={() => toggleCompDomain(d)}
                          className="rounded border-gray-300 text-orange-500 focus:ring-orange-300 flex-shrink-0" />
                        <span className="text-sm text-gray-700">{d}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2 flex-shrink-0">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
              <button onClick={saveRule} disabled={saving || !form.name.trim()}
                className="px-4 py-2 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
                {saving ? '保存中…' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ══════════════════════════════ 月度趋势 ══════════════════════════════

interface MonthlyTrendPoint { month: string; app: number; game: number }
interface MonthlyDrillItem { keyword: string; contentType: string; volume: number }

function MonthlyTrendTab() {
  const [months, setMonths] = useState<MonthlyTrendPoint[]>([])
  const [earliestMonth, setEarliestMonth] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [drillMonth, setDrillMonth] = useState<string | null>(null)
  const [drillData, setDrillData] = useState<{ app: MonthlyDrillItem[]; game: MonthlyDrillItem[] } | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)

  useEffect(() => {
    fetch('/api/rules/monthly-trend').then(r => r.json()).then(d => {
      setMonths(d.months ?? [])
      setEarliestMonth(d.earliestMonth ?? null)
    }).finally(() => setLoading(false))
  }, [])

  function openDrill(month: string) {
    setDrillMonth(month)
    setDrillLoading(true)
    setDrillData(null)
    fetch(`/api/rules/monthly-trend?month=${month}`).then(r => r.json()).then(d => setDrillData({ app: d.app ?? [], game: d.game ?? [] })).finally(() => setDrillLoading(false))
  }

  const maxCount = Math.max(1, ...months.map(m => m.app + m.game))

  if (loading) return <Spinner />

  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">全部监控站点按月汇总新增关键词数量（应用/游戏），用来发现"哪个月哪个类目在涨"这种跨站点规律。</p>
      {earliestMonth && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          ⚠ 数据从 {earliestMonth} 才开始有——这张表之前是30天自动清理，2026-08-05 才改成永久保留，再往前的历史已经清掉了。跨年/跨月的季节性规律要再攒几个月数据才看得出来。
        </p>
      )}
      {months.length === 0 ? (
        <p className="text-sm text-gray-300 text-center py-10">暂无数据</p>
      ) : (
        <div className="space-y-2 mb-6">
          {months.map(m => (
            <button key={m.month} onClick={() => openDrill(m.month)}
              className={`w-full text-left px-4 py-2.5 rounded-lg border transition-colors ${drillMonth === m.month ? 'border-rose-300 bg-rose-50/40' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-800">{m.month}</span>
                <span className="text-xs text-gray-400">应用 {m.app} · 游戏 {m.game}</span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                <div className="bg-blue-400" style={{ width: `${(m.app / maxCount) * 100}%` }} />
                <div className="bg-purple-400" style={{ width: `${(m.game / maxCount) * 100}%` }} />
              </div>
            </button>
          ))}
        </div>
      )}

      {drillMonth && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
            <span className="text-sm font-semibold text-gray-700">{drillMonth} 热门新增词（按搜索量排序）</span>
          </div>
          {drillLoading ? <Spinner /> : drillData && (
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div>
                <p className="text-xs font-medium text-blue-600 px-4 py-2 bg-blue-50/40">应用</p>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                  {drillData.app.length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.app.map(i => (
                    <div key={i.keyword} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{fmtVol(i.volume)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-purple-600 px-4 py-2 bg-purple-50/40">游戏</p>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                  {drillData.game.length === 0 ? <p className="text-xs text-gray-300 text-center py-6">无数据</p> : drillData.game.map(i => (
                    <div key={i.keyword} className="px-4 py-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{i.keyword}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{fmtVol(i.volume)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
