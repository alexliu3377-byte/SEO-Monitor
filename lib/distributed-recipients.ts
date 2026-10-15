const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// NULL is the established all-group behavior. An empty array must never
// accidentally fall back to all-group when the admin selected nobody.
export function parseDistributedRecipients(value: unknown): string[] | null {
  if (value == null) return null
  if (!Array.isArray(value) || value.length === 0 || value.length > 200
    || value.some(id => typeof id !== 'string' || !UUID.test(id))) {
    throw new Error('指定组员时请至少选择一名有效组员，最多 200 人')
  }
  return [...new Set((value as string[]).map(id => id.toLowerCase()))].sort()
}

export function canClaimDistributedKeyword(recipients: readonly string[] | null | undefined, userId: string) {
  return !!userId && (recipients == null || recipients.includes(userId))
}

export function distributedRecipientLabel(recipients: readonly string[] | null | undefined, members: readonly { user_id: string; username: string }[]) {
  if (recipients == null) return '全组'
  const names = new Map(members.map(member => [member.user_id, member.username]))
  return recipients.map(id => names.get(id) || '已移出组员').join('、') || '未指定组员'
}
