import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import type { UserRole } from '@/lib/user-context'
import { invalidateGroupTrackingCache, normalizeDomains, normalizeTaskGroupMembers } from '@/lib/task-group-data'
import { resolveUserDisplayNames } from '@/lib/user-display-name'

async function getCaller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return { id: user.id, email: user.email ?? '', role: (data?.role ?? 'normal') as UserRole }
}

interface RawGroup { id: string; name: string; type: string; created_at: string; competitor_domains: string[] }
interface RawMember { group_id: string; user_id: string; username: string | null; member_type: string | null }

export async function GET() {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const [{ data: groups, error }, { data: members, error: membersError }] = await Promise.all([
    service.from('task_groups').select('*').order('created_at'),
    service.from('task_group_members').select('group_id, user_id, username, member_type'),
  ])
  if (error || membersError) return NextResponse.json({ error: 'Unable to load task groups' }, { status: 500 })

  const rawMembers = (members || []) as RawMember[]
  const displayNames = await resolveUserDisplayNames(service, rawMembers.map(m => m.user_id), rawMembers)
  const membersByGroup = new Map<string, { user_id: string; username: string; member_type: string }[]>()
  for (const m of rawMembers) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, [])
    membersByGroup.get(m.group_id)!.push({ user_id: m.user_id, username: displayNames.get(m.user_id) || '', member_type: m.member_type || 'app' })
  }

  const allGroups = ((groups || []) as RawGroup[]).map(g => ({
    ...g,
    members: membersByGroup.get(g.id) || [],
  }))

  const result = caller.role === 'normal'
    ? allGroups.filter(g => g.members.some(m => m.user_id === caller.id))
    : allGroups

  return NextResponse.json({ groups: result })
}

export async function POST(req: Request) {
  const caller = await getCaller()
  if (!caller || caller.role === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { type, members, name: nameInput, rank_domains, new_domains, associated_domains, competitor_domains, site_domains } = await req.json() as {
    type: 'game' | 'app' | 'both'
    members: { user_id: string; username: string; member_type?: string }[]
    name?: string
    rank_domains?: string[]
    new_domains?: string[]
    associated_domains?: string[]
    competitor_domains?: string[]
    site_domains?: string[]
  }

  if (!type || !members || members.length === 0) {
    return NextResponse.json({ error: '请至少选择一个成员' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  if (!['game', 'app', 'both'].includes(type)) {
    return NextResponse.json({ error: 'Invalid group type' }, { status: 400 })
  }
  const normalized = await normalizeTaskGroupMembers(service, members)
  if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 })
  const safeName = ((nameInput || '').trim() || normalized.members.map(member => member.username).join(' · ')).slice(0, 100)

  const { data: group, error } = await service
    .from('task_groups')
    .insert({ name: safeName, type, rank_domains: normalizeDomains(rank_domains), new_domains: normalizeDomains(new_domains), associated_domains: normalizeDomains(associated_domains), competitor_domains: normalizeDomains(competitor_domains), site_domains: normalizeDomains(site_domains) })
    .select()
    .single()
  if (error) return NextResponse.json({ error: 'Unable to create task group' }, { status: 500 })

  const { error: memberError } = await service.from('task_group_members').insert(
    normalized.members.map(m => ({ group_id: group.id, ...m }))
  )
  if (memberError) {
    await service.from('task_groups').delete().eq('id', group.id)
    return NextResponse.json({ error: 'Unable to save group members' }, { status: 500 })
  }
  await invalidateGroupTrackingCache(service, group.id)

  return NextResponse.json({ group: { ...group, members: normalized.members } })
}
