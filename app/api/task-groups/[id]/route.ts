import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import type { UserRole } from '@/lib/user-context'
import { invalidateGroupTrackingCache, normalizeDomains, normalizeTaskGroupMembers } from '@/lib/task-group-data'
import { canAccessTaskGroup, canAdminUseGroupSites } from '@/lib/task-group-access'

async function getCaller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role, username').eq('id', user.id).single()
  return {
    id: user.id,
    email: user.email ?? '',
    username: String(data?.username ?? '').trim(),
    role: (data?.role ?? 'normal') as UserRole,
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await getCaller()
  if (!caller || caller.role === 'normal') {
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
  if (!await canAccessTaskGroup(service, caller.id, caller.role, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
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
  const normalizedSiteDomains = normalizeDomains(site_domains)
  if (!await canAdminUseGroupSites(service, caller.id, caller.role, normalizedSiteDomains)) {
    return NextResponse.json({ error: '只能把分组关联到你负责的站点' }, { status: 403 })
  }

  const { error: updateErr } = await service
    .from('task_groups')
    .update({ name: safeName, rank_domains: normalizeDomains(rank_domains), new_domains: normalizeDomains(new_domains), associated_domains: normalizeDomains(associated_domains), competitor_domains: normalizeDomains(competitor_domains), site_domains: normalizedSiteDomains })
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
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await getCaller()
  if (!caller || caller.role !== 'super') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > 8_192) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  const { username, password } = await req.json().catch(() => ({})) as { username?: string; password?: string }
  const normalizedUsername = username?.trim() ?? ''
  if (!normalizedUsername || !password || password.length > 1_024) {
    return NextResponse.json({ error: '请输入当前超管的用户名和密码' }, { status: 400 })
  }
  if (!caller.username || normalizedUsername.toLocaleLowerCase() !== caller.username.toLocaleLowerCase()) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 403 })
  }

  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { error: passwordError } = await verifier.auth.signInWithPassword({ email: caller.email, password })
  if (passwordError) return NextResponse.json({ error: '用户名或密码错误' }, { status: 403 })

  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { error } = await service.from('task_groups').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Unable to delete task group' }, { status: 500 })
  await invalidateGroupTrackingCache(service, id)

  return NextResponse.json({ success: true })
}
