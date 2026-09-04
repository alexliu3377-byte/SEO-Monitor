import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { resolveUserDisplayNames } from '@/lib/user-display-name'
import type { UserRole } from '@/lib/user-context'
import { filterTaskGroupsForCaller, getAssignedSiteDomains } from '@/lib/task-group-access'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

function getDateRange(period: string): { startDate: string; endDate: string } {
  const today = getMY()
  if (period === 'week') {
    const now = new Date(Date.now() + 8 * 3600000)
    const day = now.getUTCDay()
    const daysFromMonday = day === 0 ? 6 : day - 1
    return { startDate: getMY(-daysFromMonday), endDate: today }
  }
  if (period === 'month') {
    const now = new Date(Date.now() + 8 * 3600000)
    return {
      startDate: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`,
      endDate: today,
    }
  }
  if (period === 'yesterday') {
    const yesterday = getMY(-1)
    return { startDate: yesterday, endDate: yesterday }
  }
  return { startDate: today, endDate: today }
}

interface RawGroup { id: string; name: string; created_at: string; site_domains: string[] }
interface RawMember { group_id: string; user_id: string; username: string | null; member_type: string | null }
interface RawClaim { group_id: string; user_id: string; source: string; search_volume: number }
interface SourceTotal { count: number; volume: number }

const SOURCE_ORDER = ['竞品涨排名', '共新增词', '交叉词', '连续上涨词', '更新词库', '搜索量查询']

function sortSources(sourceMap: Map<string, SourceTotal>) {
  return SOURCE_ORDER
    .filter(source => sourceMap.has(source))
    .map(source => ({ source, ...sourceMap.get(source)! }))
    .concat(
      Array.from(sourceMap.entries())
        .filter(([source]) => !SOURCE_ORDER.includes(source))
        .map(([source, total]) => ({ source, ...total })),
    )
}

export async function GET(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'normal') as UserRole
  const canSeeAll = role === 'super' || role === 'admin'

  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') || 'yesterday'
  const customStart = searchParams.get('startDate')
  const customEnd = searchParams.get('endDate')
  const { startDate, endDate } = customStart && customEnd && customStart <= customEnd
    ? { startDate: customStart, endDate: customEnd }
    : getDateRange(period)

  const [allGroups, allMembers] = await Promise.all([
    fetchAllRows<RawGroup>((from, to) => service.from('task_groups')
      .select('id, name, created_at, site_domains')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    fetchAllRows<RawMember>((from, to) => service.from('task_group_members')
      .select('group_id, user_id, username, member_type')
      .order('group_id', { ascending: true })
      .order('user_id', { ascending: true })
      .range(from, to)),
  ])

  const assignedDomains = role === 'admin' ? await getAssignedSiteDomains(service, user.id) : new Set<string>()
  const groups = filterTaskGroupsForCaller(allGroups, allMembers, user.id, role, assignedDomains)
  const visibleGroupIds = new Set(groups.map(group => group.id))
  const members = allMembers.filter(member => visibleGroupIds.has(member.group_id))

  if (groups.length === 0) {
    return NextResponse.json({ period, startDate, endDate, groups: [] })
  }

  const claims = await fetchAllRows<RawClaim>((from, to) => {
    let query = service.from('member_claimed_keywords')
      .select('group_id, user_id, source, search_volume')
      .in('group_id', groups.map(group => group.id))
      .eq('status', 'submitted')
      .gte('claimed_date', startDate)
      .lte('claimed_date', endDate)
      .order('group_id', { ascending: true })
      .order('user_id', { ascending: true })
      .range(from, to)
    if (!canSeeAll) query = query.eq('user_id', user.id)
    return query
  })

  const allVisibleUserIds = Array.from(new Set([
    ...members.map(member => member.user_id),
    ...claims.map(claim => claim.user_id),
  ]))
  const displayNames = await resolveUserDisplayNames(service, allVisibleUserIds, members)
  const claimsByMember = new Map<string, { total: SourceTotal; sources: Map<string, SourceTotal> }>()
  for (const claim of claims) {
    const key = `${claim.group_id}|${claim.user_id}`
    const entry = claimsByMember.get(key) ?? { total: { count: 0, volume: 0 }, sources: new Map() }
    const volume = Number(claim.search_volume) || 0
    entry.total.count += 1
    entry.total.volume += volume
    const source = entry.sources.get(claim.source) ?? { count: 0, volume: 0 }
    source.count += 1
    source.volume += volume
    entry.sources.set(claim.source, source)
    claimsByMember.set(key, entry)
  }

  const result = groups.map(group => {
    const currentMembers = members.filter(member => member.group_id === group.id && (canSeeAll || member.user_id === user.id))
    const historicalMembers = claims
      .filter(claim => claim.group_id === group.id && !currentMembers.some(member => member.user_id === claim.user_id))
      .map(claim => ({ group_id: group.id, user_id: claim.user_id, username: null, member_type: 'app' }))
      .filter((member, index, rows) => rows.findIndex(row => row.user_id === member.user_id) === index)
    const groupMembers = [...currentMembers, ...historicalMembers]
      .map(member => {
        const entry = claimsByMember.get(`${group.id}|${member.user_id}`)
        return {
          userId: member.user_id,
          username: displayNames.get(member.user_id) || member.username || member.user_id.slice(0, 8),
          memberType: member.member_type || 'app',
          total: entry?.total ?? { count: 0, volume: 0 },
          bySource: entry ? sortSources(entry.sources) : [],
        }
      })

    const groupSources = new Map<string, SourceTotal>()
    const groupTotal = { count: 0, volume: 0 }
    for (const member of groupMembers) {
      groupTotal.count += member.total.count
      groupTotal.volume += member.total.volume
      for (const source of member.bySource) {
        const current = groupSources.get(source.source) ?? { count: 0, volume: 0 }
        current.count += source.count
        current.volume += source.volume
        groupSources.set(source.source, current)
      }
    }

    return {
      id: group.id,
      name: group.name,
      groupTotal: canSeeAll ? { total: groupTotal, bySource: sortSources(groupSources) } : null,
      members: groupMembers,
    }
  })

  return NextResponse.json({ period, startDate, endDate, groups: result })
}
