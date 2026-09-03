import { createClient } from '@supabase/supabase-js'

type ClaimRow = {
  id: string
  group_id: string | null
  user_id: string | null
  keyword: string | null
  claimed_date: string | null
  status: string | null
  created_at: string | null
  submitted_at: string | null
  page_url: string | null
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function fetchAll<T>(makeQuery: (from: number, to: number) => PromiseLike<{
  data: T[] | null
  error: { message: string } | null
}>): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

function findDuplicates<T>(rows: T[], keyOf: (row: T) => string): T[][] {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return [...grouped.values()].filter(group => group.length > 1)
}

async function main() {
  const [claims, profiles, memberships, accessGrants] = await Promise.all([
    fetchAll<ClaimRow>((from, to) => supabase
      .from('member_claimed_keywords')
      .select('id, group_id, user_id, keyword, claimed_date, status, created_at, submitted_at, page_url')
      .order('id', { ascending: true })
      .range(from, to)),
    fetchAll<{ id: string; username: string | null }>((from, to) => supabase
      .from('user_profiles').select('id, username').order('id').range(from, to)),
    fetchAll<{ group_id: string | null; user_id: string | null }>((from, to) => supabase
      .from('task_group_members').select('group_id, user_id').order('group_id').order('user_id').range(from, to)),
    fetchAll<{ user_id: string | null; site_id: string | null }>((from, to) => supabase
      .from('user_site_access').select('user_id, site_id').order('user_id').order('site_id').range(from, to)),
  ])

  const activeClaims = claims.filter(claim => claim.status !== 'dismissed')

  const grouped = new Map<string, ClaimRow[]>()
  for (const claim of activeClaims) {
    const key = `${claim.group_id}\u0000${claim.claimed_date}\u0000${claim.keyword}`
    const rows = grouped.get(key) ?? []
    rows.push(claim)
    grouped.set(key, rows)
  }
  const duplicateGroups = [...grouped.values()].filter(rows => rows.length > 1)

  const groupIds = [...new Set(duplicateGroups.flatMap(rows => rows.map(row => row.group_id)).filter((id): id is string => id !== null))]
  const claimIds = duplicateGroups.flatMap(rows => rows.map(row => row.id))

  const { data: groups, error: groupsError } = groupIds.length > 0
    ? await supabase.from('task_groups').select('id, name').in('id', groupIds)
    : { data: [], error: null }
  if (groupsError) throw new Error(groupsError.message)

  const trackingCounts = new Map<string, number>()
  for (let i = 0; i < claimIds.length; i += 100) {
    const chunk = claimIds.slice(i, i + 100)
    const tracks = await fetchAll<{ claim_id: string }>((from, to) => supabase
      .from('site_tracking_records')
      .select('claim_id')
      .in('claim_id', chunk)
      .order('id', { ascending: true })
      .range(from, to))
    for (const track of tracks) {
      trackingCounts.set(track.claim_id, (trackingCounts.get(track.claim_id) ?? 0) + 1)
    }
  }

  const groupNames = new Map((groups ?? []).map(row => [row.id as string, row.name as string]))
  const usernames = new Map(profiles.map(row => [row.id, row.username]))
  const details = duplicateGroups.map(rows => {
    const ranked = [...rows].sort((a, b) => {
      const statusDiff = Number(b.status === 'submitted') - Number(a.status === 'submitted')
      if (statusDiff !== 0) return statusDiff
      const trackingDiff = (trackingCounts.get(b.id) ?? 0) - (trackingCounts.get(a.id) ?? 0)
      if (trackingDiff !== 0) return trackingDiff
      return (a.created_at ?? '').localeCompare(b.created_at ?? '')
    })
    const submittedRows = rows.filter(row => row.status === 'submitted')
    return {
      groupId: rows[0].group_id,
      groupName: rows[0].group_id ? groupNames.get(rows[0].group_id) ?? null : null,
      date: rows[0].claimed_date,
      keyword: rows[0].keyword,
      recommendedKeepId: ranked[0].id,
      needsManualReview: submittedRows.length > 1 || rows.filter(row => (trackingCounts.get(row.id) ?? 0) > 0).length > 1,
      rows: ranked.map(row => ({
        ...row,
        username: row.user_id ? usernames.get(row.user_id) ?? null : null,
        trackingRecords: trackingCounts.get(row.id) ?? 0,
      })),
    }
  })

  const duplicateUsernames = findDuplicates(
    profiles.filter(row => row.username !== null),
    row => row.username!.trim().toLocaleLowerCase('en-US')
  )
  const duplicateMemberships = findDuplicates(
    memberships,
    row => `${row.group_id}\u0000${row.user_id}`
  )
  const duplicateAccessGrants = findDuplicates(
    accessGrants,
    row => `${row.user_id}\u0000${row.site_id}`
  )
  const claimsWithNullFields = claims.filter(row =>
    row.group_id === null || row.user_id === null || row.keyword === null ||
    row.claimed_date === null || row.status === null)

  console.log(JSON.stringify({
    blockers: {
      duplicateUsernames: duplicateUsernames.length,
      claimsWithNullFields: claimsWithNullFields.length,
      duplicateMemberships: duplicateMemberships.length,
      duplicateAccessGrants: duplicateAccessGrants.length,
    },
    duplicateGroups: details.length,
    duplicateRows: details.reduce((sum, item) => sum + item.rows.length, 0),
    details,
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
