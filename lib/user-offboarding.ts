import type { UserRole } from '@/lib/user-context'

export function canOffboardUser(
  callerId: string,
  callerRole: UserRole,
  targetId: string,
  targetRole: UserRole,
) {
  if (callerId === targetId || callerRole === 'normal') return false
  if (callerRole === 'admin') return targetRole === 'normal'
  return callerRole === 'super'
}
