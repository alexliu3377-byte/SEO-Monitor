type MemberInput = { user_id: string; username?: string | null; member_type?: string | null }

export type NormalizedTaskGroupMember = {
  user_id: string
  username: string
  member_type: 'app' | 'game' | 'both'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, ''))
    .filter(Boolean))]
    .slice(0, 500)
}

export async function normalizeTaskGroupMembers(
  service: any,
  members: MemberInput[]
): Promise<{ members: NormalizedTaskGroupMember[]; error?: string }> {
  if (!Array.isArray(members) || members.length === 0 || members.length > 100) {
    return { members: [], error: 'A group must contain between 1 and 100 members' }
  }
  const userIds = [...new Set(members.map(member => member?.user_id))]
  if (userIds.length !== members.length || userIds.some(id => typeof id !== 'string' || !UUID_RE.test(id))) {
    return { members: [], error: 'Invalid or duplicate group member' }
  }

  const { data: profiles, error } = await service
    .from('user_profiles')
    .select('id, username')
    .in('id', userIds)
  if (error || (profiles ?? []).length !== userIds.length) {
    return { members: [], error: 'One or more group members do not exist' }
  }
  const usernameById = new Map<string, string>(
    (profiles ?? []).map((profile: { id: string; username: string | null }) => [
      profile.id,
      profile.username?.trim() || profile.id.slice(0, 8),
    ])
  )

  return {
    members: members.map(member => ({
      user_id: member.user_id,
      username: usernameById.get(member.user_id)!,
      member_type: ['app', 'game', 'both'].includes(member.member_type || '')
        ? member.member_type as 'app' | 'game' | 'both'
        : 'app',
    })),
  }
}

export async function invalidateGroupTrackingCache(service: any, groupId: string) {
  const { error } = await service.rpc('invalidate_group_tracking_paged_cache', { p_group_id: groupId })
  if (!error) return
  if (!['42883', 'PGRST202'].includes(error.code ?? '')) {
    console.error('Failed to invalidate paged group tracking cache', { groupId, code: error.code })
  }
  const { error: legacyError } = await service.from('group_tracking_cache').delete().eq('group_id', groupId)
  if (legacyError) console.error('Failed to invalidate group tracking cache', { groupId, code: legacyError.code })
}
