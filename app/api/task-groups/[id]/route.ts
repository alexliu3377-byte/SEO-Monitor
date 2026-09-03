import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import type { UserRole } from '@/lib/user-context'
import { invalidateGroupTrackingCache, normalizeDomains, normalizeTaskGroupMembers } from '@/lib/task-group-data'

async function getCallerRole(): Promise<UserRole | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return (data?.role ?? 'normal') as UserRole
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = await getCallerRole()
  if (!role || role === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { name, members, rank_domains, new_domains, associated_domains, competitor_domains, site_domains } = await req.json() as {
    name: string
    members: { user_id: string; username: string; member_type?: string }[]
    rank_domains?: string[]
    new_domains?: string[]
    associated_domains?: string[]
    competitor_domains?: string[]
    site_domains?: string[]
  }

  if (!members || members.length === 0) {
    return NextResponse.json({ error: '请至少选择一个成员' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const normalized = await normalizeTaskGroupMembers(service, members)
  if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 })
  const safeName = typeof name === 'string' ? name.trim().slice(0, 100) : ''
  if (!safeName) return NextResponse.json({ error: 'Group name is required' }, { status: 400 })

  const [{ data: previousGroup, error: groupError }, { data: previousMembers, error: membersError }] = await Promise.all([
    service.from('task_groups')
      .select('name, rank_domains, new_domains, associated_domains, competitor_domains, site_domains')
      .eq('id', id).single(),
    service.from('task_group_members')
      .select('group_id, user_id, username, member_type')
      .eq('group_id', id),
  ])
  if (groupError || !previousGroup) return NextResponse.json({ error: 'Task group not found' }, { status: 404 })
  if (membersError) return NextResponse.json({ error: 'Unable to load current group members' }, { status: 500 })

  const { error: updateErr } = await service
    .from('task_groups')
    .update({ name: safeName, rank_domains: normalizeDomains(rank_domains), new_domains: normalizeDomains(new_domains), associated_domains: normalizeDomains(associated_domains), competitor_domains: normalizeDomains(competitor_domains), site_domains: normalizeDomains(site_domains) })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: 'Unable to update task group' }, { status: 500 })

  const { error: deleteError } = await service.from('task_group_members').delete().eq('group_id', id)
  if (deleteError) {
    await service.from('task_groups').update(previousGroup).eq('id', id)
    return NextResponse.json({ error: 'Unable to replace group members' }, { status: 500 })
  }
  const { error: insertError } = await service.from('task_group_members').insert(
    normalized.members.map(m => ({ group_id: id, ...m }))
  )
  if (insertError) {
    const { error: restoreError } = await service.from('task_group_members').insert(previousMembers ?? [])
    await service.from('task_groups').update(previousGroup).eq('id', id)
    if (restoreError) console.error('Task group member rollback failed', { groupId: id, code: restoreError.code })
    return NextResponse.json({ error: 'Unable to save group members; previous data was restored' }, { status: 500 })
  }
  await invalidateGroupTrackingCache(service, id)

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = await getCallerRole()
  if (!role || role === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { error } = await service.from('task_groups').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Unable to delete task group' }, { status: 500 })
  await invalidateGroupTrackingCache(service, id)

  return NextResponse.json({ success: true })
}
