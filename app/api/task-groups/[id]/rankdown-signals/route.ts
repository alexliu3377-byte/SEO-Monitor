import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import { normalizeDomains } from '@/lib/task-group-data'
import type { UserRole } from '@/lib/user-context'

interface RankdownSignalRow {
  keyword: string
  stat_date: string
  rank_position: number
  prev_rank: number | null
  volume: number
  url: string | null
  title: string | null
}

function malaysiaDate(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile, error: profileError } = await service
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profileError || !profile) {
    return NextResponse.json({ error: 'Unable to load user profile' }, { status: 500 })
  }

  const role = (profile.role ?? 'normal') as UserRole
  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: group, error: groupError } = await service
    .from('task_groups')
    .select('site_domains')
    .eq('id', groupId)
    .maybeSingle()
  if (groupError) return NextResponse.json({ error: 'Unable to load task group' }, { status: 500 })
  if (!group) return NextResponse.json({ error: 'Task group not found' }, { status: 404 })

  const groupDomains = new Set(normalizeDomains(group.site_domains))
  if (groupDomains.size === 0) return NextResponse.json({ rows: [] })

  const { data: sites, error: siteError } = await service.from('sites').select('id, domain')
  if (siteError) return NextResponse.json({ error: 'Unable to resolve group sites' }, { status: 500 })
  const siteIds = ((sites ?? []) as { id: string; domain: string }[])
    .filter(site => groupDomains.has(normalizeDomains([site.domain])[0] ?? ''))
    .map(site => site.id)
  if (siteIds.length === 0) return NextResponse.json({ rows: [] })

  try {
    const since = malaysiaDate(-30)
    const rows = await fetchAllRows<RankdownSignalRow>((from, to) => service
      .from('keyword_signal_rollup')
      .select('keyword, stat_date:last_seen, rank_position:latest_rank_position, prev_rank:latest_prev_rank, volume:max_volume, url:latest_url, title:latest_title')
      .in('site_id', siteIds)
      .eq('type', 'rankdown')
      .gte('last_seen', since)
      .order('last_seen', { ascending: false })
      .order('max_volume', { ascending: false })
      .order('site_id', { ascending: true })
      .order('keyword', { ascending: true })
      .range(from, to))

    return NextResponse.json(
      { rows },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    )
  } catch (error) {
    console.error('Rankdown signals load failed', { groupId, error })
    return NextResponse.json({ error: 'Unable to load rankdown signals' }, { status: 500 })
  }
}
