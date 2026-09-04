import type { UserRole } from './user-context'

interface GroupWithSites {
  id: string
  site_domains?: string[] | null
}

interface GroupMemberRef {
  group_id: string
  user_id: string
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\.$/, '')
}

export function groupMatchesAssignedSites(groupDomains: string[] | null | undefined, assignedDomains: Iterable<string>) {
  const allowed = new Set(Array.from(assignedDomains, normalizeDomain).filter(Boolean))
  return (groupDomains ?? []).some(domain => allowed.has(normalizeDomain(domain)))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAssignedSiteDomains(service: any, userId: string): Promise<Set<string>> {
  const { data: grants, error: grantError } = await service.from('user_site_access')
    .select('site_id').eq('user_id', userId)
  if (grantError) throw new Error('Unable to load assigned sites')
  const siteIds = ((grants ?? []) as { site_id: string }[]).map(grant => grant.site_id)
  if (siteIds.length === 0) return new Set()

  const { data: sites, error: siteError } = await service.from('sites').select('domain').in('id', siteIds)
  if (siteError) throw new Error('Unable to resolve assigned sites')
  return new Set(((sites ?? []) as { domain: string }[]).map(site => normalizeDomain(site.domain)).filter(Boolean))
}

export function filterTaskGroupsForCaller<T extends GroupWithSites>(
  groups: T[],
  members: GroupMemberRef[],
  userId: string,
  role: UserRole,
  assignedDomains: Iterable<string> = [],
) {
  if (role === 'super') return groups
  if (role === 'admin') return groups.filter(group => groupMatchesAssignedSites(group.site_domains, assignedDomains))
  const memberGroupIds = new Set(members.filter(member => member.user_id === userId).map(member => member.group_id))
  return groups.filter(group => memberGroupIds.has(group.id))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function canAccessTaskGroup(service: any, userId: string, role: UserRole, groupId: string) {
  if (role === 'super') return true
  if (role === 'normal') {
    const { data } = await service.from('task_group_members').select('user_id')
      .eq('group_id', groupId).eq('user_id', userId).maybeSingle()
    return !!data
  }

  const [{ data: group }, assignedDomains] = await Promise.all([
    service.from('task_groups').select('site_domains').eq('id', groupId).maybeSingle(),
    getAssignedSiteDomains(service, userId),
  ])
  return !!group && groupMatchesAssignedSites(group.site_domains, assignedDomains)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function canAdminUseGroupSites(service: any, userId: string, role: UserRole, groupDomains: string[] | null | undefined) {
  if (role === 'super') return true
  if (role !== 'admin') return false
  const assignedDomains = await getAssignedSiteDomains(service, userId)
  const normalizedGroupDomains = (groupDomains ?? []).map(normalizeDomain).filter(Boolean)
  return normalizedGroupDomains.length > 0 && normalizedGroupDomains.every(domain => assignedDomains.has(domain))
}
