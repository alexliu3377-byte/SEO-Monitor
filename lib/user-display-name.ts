type MemberName = { user_id: string; username: string | null }

// Resolve names consistently for current members and historical records made by
// admins who were not members at the time. Group-specific names win, followed
// by the canonical profile username, with a short UUID only as a last resort.
export async function resolveUserDisplayNames(
  service: any,
  userIds: string[],
  members: MemberName[] = []
) {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  const names = new Map<string, string>()
  for (const member of members) {
    if (member.username?.trim()) names.set(member.user_id, member.username.trim())
  }

  if (ids.length > 0) {
    const { data: profiles } = await service
      .from('user_profiles')
      .select('id, username')
      .in('id', ids)
    for (const profile of (profiles || []) as { id: string; username: string | null }[]) {
      if (!names.has(profile.id) && profile.username?.trim()) {
        names.set(profile.id, profile.username.trim())
      }
    }
  }

  for (const id of ids) {
    if (!names.has(id)) names.set(id, id.slice(0, 8))
  }
  return names
}
