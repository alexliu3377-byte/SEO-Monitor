import { NextResponse } from 'next/server'
import {
  isKeywordPrimaryCategory,
  isRankingKeyword,
  isValidKeywordSubcategory,
  type KeywordClassificationStatus,
} from '@/lib/keyword-classification'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { filterTaskGroupsForCaller, getAssignedSiteDomains } from '@/lib/task-group-access'
import type { UserRole } from '@/lib/user-context'

const CLASSIFICATION_STATUSES: KeywordClassificationStatus[] = ['pending', 'confirmed']
const LAYOUT_STATUSES = ['unassigned', 'assigned', 'issue'] as const
type LayoutStatus = typeof LAYOUT_STATUSES[number]

interface TaskGroupRow {
  id: string
  name: string
  site_domains: string[] | null
}

interface GroupMemberRow {
  group_id: string
  user_id: string
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\.$/, '')
}

async function requireActiveUser() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: '请先登录' }, { status: 401 }) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role, is_active').eq('id', user.id).maybeSingle()
  if (!profile || profile.is_active === false) return { error: NextResponse.json({ error: '账号已停用或无权访问' }, { status: 403 }) }
  return { service, userId: user.id, role: profile.role as UserRole }
}

// Return only the task groups and sites the current caller is allowed to work on.
// Duplicate domains are shown once, under the first accessible group.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAccessibleSiteGroups(service: any, userId: string, role: UserRole) {
  const membersQuery = role === 'normal'
    ? service.from('task_group_members').select('group_id, user_id').eq('user_id', userId)
    : Promise.resolve({ data: [], error: null })
  const [{ data: groups, error: groupError }, { data: members, error: memberError }] = await Promise.all([
    service.from('task_groups').select('id, name, site_domains').order('created_at', { ascending: true }),
    membersQuery,
  ])
  if (groupError || memberError) throw new Error(groupError?.message || memberError?.message || 'Unable to load task groups')

  const typedGroups = (groups ?? []) as TaskGroupRow[]
  const typedMembers = (members ?? []) as GroupMemberRow[]
  const assignedDomains = role === 'admin' ? await getAssignedSiteDomains(service, userId) : new Set<string>()
  const accessible = filterTaskGroupsForCaller(typedGroups, typedMembers, userId, role, assignedDomains)
  const seen = new Set<string>()

  return accessible.map(group => ({
    id: group.id,
    name: group.name,
    sites: (group.site_domains ?? [])
      .map(normalizeDomain)
      .filter(domain => domain && (role !== 'admin' || assignedDomains.has(domain)))
      .filter(domain => !seen.has(domain) && Boolean(seen.add(domain))),
  })).filter(group => group.sites.length > 0)
}

export async function GET(request: Request) {
  const access = await requireActiveUser()
  if ('error' in access) return access.error

  const { searchParams } = new URL(request.url)
  const page = Math.max(0, Number.parseInt(searchParams.get('page') || '0', 10) || 0)
  const pageSize = Math.min(100, Math.max(20, Number.parseInt(searchParams.get('pageSize') || '50', 10) || 50))
  const classificationStatus = searchParams.get('classificationStatus') || 'confirmed'
  const layoutStatus = searchParams.get('layoutStatus') || 'all'
  const category = searchParams.get('category') || ''
  const subcategory = searchParams.get('subcategory') || ''
  const search = (searchParams.get('q') || '').trim().slice(0, 100)

  const service = access.service
  let query = service.from('keyword_volume')
    .select('keyword, volume, content_category, content_subcategory, classification_status, layout_site_domains, layout_status, layout_issue_note', { count: 'exact' })

  if (CLASSIFICATION_STATUSES.includes(classificationStatus as KeywordClassificationStatus)) {
    query = query.eq('classification_status', classificationStatus)
  }
  if (category) {
    query = category === '待分类'
      ? query.eq('classification_status', 'pending')
      : query.eq('content_category', category)
  }
  if (subcategory) query = query.eq('content_subcategory', subcategory)
  if (LAYOUT_STATUSES.includes(layoutStatus as LayoutStatus)) query = query.eq('layout_status', layoutStatus)
  if (search) query = query.ilike('keyword', `%${search}%`)

  query = query.order('volume', { ascending: false }).order('keyword', { ascending: true })
  const from = page * pageSize

  try {
    const [{ data, count, error }, summaryResult, siteGroups] = await Promise.all([
      query.range(from, from + pageSize - 1),
      service.rpc('keyword_classification_summary'),
      loadAccessibleSiteGroups(service, access.userId, access.role),
    ])

    if (error || summaryResult.error) {
      console.error('Keyword layout load failed:', error?.message || summaryResult.error?.message)
      return NextResponse.json({ error: '词库布局资料读取失败' }, { status: 500 })
    }

    return NextResponse.json({
      items: data ?? [],
      total: count ?? 0,
      summary: summaryResult.data ?? [],
      siteGroups,
    })
  } catch (error) {
    console.error('Keyword layout site groups load failed:', error)
    return NextResponse.json({ error: '分组任务站点读取失败' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const access = await requireActiveUser()
  if ('error' in access) return access.error
  const body = await request.json().catch(() => null) as {
    action?: unknown
    keyword?: unknown
    category?: unknown
    subcategory?: unknown
    domains?: unknown
    problem?: unknown
    issueNote?: unknown
  } | null
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
  if (!keyword) return NextResponse.json({ error: '关键词无效' }, { status: 400 })

  const service = access.service

  if (body?.action === 'set-sites') {
    const requestedDomains = Array.isArray(body.domains)
      ? Array.from(new Set(body.domains.filter((value): value is string => typeof value === 'string').map(normalizeDomain).filter(Boolean)))
      : []
    if (requestedDomains.length > 100) return NextResponse.json({ error: '单个关键词最多布局 100 个站点' }, { status: 400 })

    let siteGroups: Awaited<ReturnType<typeof loadAccessibleSiteGroups>>
    try {
      siteGroups = await loadAccessibleSiteGroups(service, access.userId, access.role)
    } catch (error) {
      console.error('Keyword layout authorization failed:', error)
      return NextResponse.json({ error: '分组任务站点读取失败' }, { status: 500 })
    }
    const allowedDomains = new Set(siteGroups.flatMap(group => group.sites))
    if (requestedDomains.some(domain => !allowedDomains.has(domain))) {
      return NextResponse.json({ error: '只能选择你可访问的分组任务站点' }, { status: 403 })
    }

    const { data: current, error: currentError } = await service.from('keyword_volume')
      .select('layout_site_domains, layout_status').eq('keyword', keyword).maybeSingle()
    if (currentError || !current) return NextResponse.json({ error: '关键词不存在' }, { status: 404 })

    const existingDomains = ((current.layout_site_domains ?? []) as string[]).map(normalizeDomain).filter(Boolean)
    const preservedDomains = access.role === 'super'
      ? []
      : existingDomains.filter(domain => !allowedDomains.has(domain))
    const nextDomains = Array.from(new Set([...preservedDomains, ...requestedDomains]))
    const nextStatus: LayoutStatus = current.layout_status === 'issue'
      ? 'issue'
      : nextDomains.length > 0 ? 'assigned' : 'unassigned'

    const { error } = await service.from('keyword_volume').update({
      layout_site_domains: nextDomains,
      layout_status: nextStatus,
      layout_updated_by: access.userId,
      layout_updated_at: new Date().toISOString(),
    }).eq('keyword', keyword)
    if (error) return NextResponse.json({ error: '站点布局保存失败' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body?.action === 'set-issue') {
    if (typeof body.problem !== 'boolean') return NextResponse.json({ error: '问题状态无效' }, { status: 400 })
    const { data: current, error: currentError } = await service.from('keyword_volume')
      .select('layout_site_domains').eq('keyword', keyword).maybeSingle()
    if (currentError || !current) return NextResponse.json({ error: '关键词不存在' }, { status: 404 })

    const domains = (current.layout_site_domains ?? []) as string[]
    const nextStatus: LayoutStatus = body.problem ? 'issue' : domains.length > 0 ? 'assigned' : 'unassigned'
    const issueNote = body.problem && typeof body.issueNote === 'string'
      ? body.issueNote.trim().slice(0, 200) || '组员标记有问题'
      : body.problem ? '组员标记有问题' : null
    const { error } = await service.from('keyword_volume').update({
      layout_status: nextStatus,
      layout_issue_note: issueNote,
      layout_updated_by: access.userId,
      layout_updated_at: new Date().toISOString(),
    }).eq('keyword', keyword)
    if (error) return NextResponse.json({ error: '问题状态保存失败' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (!isKeywordPrimaryCategory(body?.category)) {
    return NextResponse.json({ error: '一级分类无效' }, { status: 400 })
  }
  const category = body.category
  const subcategory = typeof body?.subcategory === 'string' ? body.subcategory.trim() : ''
  if (category === '排行榜' && !isRankingKeyword(keyword)) {
    return NextResponse.json({ error: '只有包含排行榜、榜单、前10、前十、前20、前二十、十大或10大的关键词才能设为排行榜' }, { status: 400 })
  }
  if (!isValidKeywordSubcategory(category, subcategory)) {
    return NextResponse.json({ error: category === '游戏' || category === '应用' ? '请选择有效的二级分类' : '该一级分类不应设置二级分类' }, { status: 400 })
  }

  const { error } = await service.from('keyword_volume').update({
    content_category: category,
    content_subcategory: subcategory || null,
    classification_status: 'confirmed',
    classification_source: 'manual',
    classification_confidence: 1,
    classification_reason: '人工修改',
    reviewed_at: new Date().toISOString(),
  }).eq('keyword', keyword)
  if (error) return NextResponse.json({ error: '保存分类失败' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const access = await requireActiveUser()
  if ('error' in access) return access.error
  if (access.role !== 'super') return NextResponse.json({ error: '仅超管可以删除词库资料' }, { status: 403 })

  const body = await request.json().catch(() => null) as { keyword?: unknown } | null
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
  if (!keyword) return NextResponse.json({ error: '关键词无效' }, { status: 400 })

  const { data: current } = await access.service.from('keyword_volume')
    .select('layout_status').eq('keyword', keyword).maybeSingle()
  if (!current || current.layout_status !== 'issue') {
    return NextResponse.json({ error: '请先把关键词标记为有问题，再由超管删除' }, { status: 400 })
  }

  const { error } = await access.service.rpc('exclude_keyword_volume', {
    p_keyword: keyword,
    p_user_id: access.userId,
  })
  if (error) {
    console.error('Keyword exclusion failed:', error.message)
    return NextResponse.json({ error: '删除词库资料失败' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
