import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { invalidateGroupTrackingCache } from '@/lib/task-group-data'
import type { UserRole } from '@/lib/user-context'
import { canOffboardUser } from '@/lib/user-offboarding'

interface OffboardResult {
  group_ids?: string[]
  removed_memberships?: number
  removed_site_grants?: number
  dismissed_pending_claims?: number
  disabled_at?: string
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const authClient = await createClient()
  const { data: { user: caller } } = await authClient.auth.getUser()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const [{ data: callerProfile }, { data: targetProfile, error: targetError }] = await Promise.all([
    service.from('user_profiles').select('role, is_active').eq('id', caller.id).single(),
    service.from('user_profiles').select('role, is_active').eq('id', id).single(),
  ])

  if (!callerProfile?.is_active) {
    return NextResponse.json({ error: '账号已停用' }, { status: 403 })
  }
  if (targetError || !targetProfile) {
    return NextResponse.json({ error: '账号不存在' }, { status: 404 })
  }
  if (!canOffboardUser(caller.id, callerProfile.role as UserRole, id, targetProfile.role as UserRole)) {
    return NextResponse.json({ error: caller.id === id ? '不能停用自己的账号' : '无权办理该账号离职' }, { status: 403 })
  }
  if (targetProfile.is_active === false) {
    return NextResponse.json({ error: '该账号已经停用' }, { status: 409 })
  }

  const { data, error } = await service.rpc('offboard_user', {
    p_user_id: id,
    p_actor_id: caller.id,
  })
  if (error) {
    console.error('Account offboarding failed', { targetId: id, code: error.code })
    return NextResponse.json({ error: '办理离职失败，请确认数据库迁移已应用' }, { status: 500 })
  }

  const result = (data ?? {}) as OffboardResult
  await Promise.all((result.group_ids ?? []).map(groupId => invalidateGroupTrackingCache(service, groupId)))

  // Banning is defense in depth. The profile flag is the authoritative gate in
  // proxy.ts and the login route, so a transient Auth failure cannot leave the
  // former employee with application access.
  const { error: banError } = await service.auth.admin.updateUserById(id, {
    ban_duration: '876000h',
  })
  if (banError) console.error('Unable to ban offboarded Auth user', { targetId: id })

  return NextResponse.json({
    ok: true,
    user: {
      id,
      is_active: false,
      disabled_at: result.disabled_at ?? new Date().toISOString(),
    },
    summary: {
      removedMemberships: result.removed_memberships ?? 0,
      removedSiteGrants: result.removed_site_grants ?? 0,
      dismissedPendingClaims: result.dismissed_pending_claims ?? 0,
    },
  })
}
