import { createClient, createServiceClient } from './supabase-server'
import type { UserProfile } from './user-context'

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role: UserProfile['role'] = (profile?.role ?? 'normal') as UserProfile['role']

  let accessibleSiteIds: string[] | null = null

  if (role !== 'super') {
    const [{ data: normalSites }, { data: granted }] = await Promise.all([
      role === 'normal'
        ? service.from('sites').select('id').eq('focus_level', 3)
        : Promise.resolve({ data: [] }),
      service.from('user_site_access').select('site_id').eq('user_id', user.id),
    ])
    accessibleSiteIds = [
      ...((normalSites as { id: string }[] ?? []).map((s: { id: string }) => s.id)),
      ...((granted as { site_id: string }[] ?? []).map((g: { site_id: string }) => g.site_id)),
    ]
  }

  return {
    id: user.id,
    email: user.email ?? '',
    role,
    accessibleSiteIds,
  }
}
