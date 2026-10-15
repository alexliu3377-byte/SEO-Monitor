import { fetchAllRows } from './supabase-paginate'
import type { UserRole } from './user-context'

export interface TaskGroupSiteOption {
  id: string
  domain: string
  name: string
  category: 'large' | 'medium' | 'small'
  is_enabled: boolean
  has_rank_data: boolean
}

// These lists have different purposes. Public competitor sources must not become
// assignable owned sites, and neither list needs crawler configuration fields.
const SITE_OPTION_COLUMNS = 'id, domain, name, category, is_enabled, has_rank_data'
const CATEGORY_ORDER: Record<string, number> = { large: 0, medium: 1, small: 2 }

function sortSites(sites: TaskGroupSiteOption[]) {
  return sites.sort((a, b) => (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9)
    || a.domain.localeCompare(b.domain))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadTaskGroupSiteOptions(service: any, caller: { id: string; role: UserRole }) {
  if (caller.role !== 'admin' && caller.role !== 'super') throw new Error('Forbidden')

  if (caller.role === 'super') {
    const sites = sortSites(await fetchAllRows<TaskGroupSiteOption>((from, to) => service.from('sites')
      .select(SITE_OPTION_COLUMNS).order('id').range(from, to)))
    return { ownedSites: sites, filterSites: sites }
  }

  const grants = await fetchAllRows<{ site_id: string }>((from, to) => service.from('user_site_access')
    .select('site_id').eq('user_id', caller.id).order('site_id').range(from, to))
  const siteIds = [...new Set(grants.map(grant => grant.site_id))]
  const [ownedSites, publicSources] = await Promise.all([
    siteIds.length === 0 ? Promise.resolve([] as TaskGroupSiteOption[]) : fetchAllRows<TaskGroupSiteOption>((from, to) => service.from('sites')
      .select(SITE_OPTION_COLUMNS).in('id', siteIds).order('id').range(from, to)),
    fetchAllRows<TaskGroupSiteOption>((from, to) => service.from('sites')
      .select(SITE_OPTION_COLUMNS).eq('focus_level', 3).order('id').range(from, to)),
  ])
  return {
    ownedSites: sortSites(ownedSites),
    filterSites: sortSites([...new Map([...publicSources, ...ownedSites].map(site => [site.id, site])).values()]),
  }
}
