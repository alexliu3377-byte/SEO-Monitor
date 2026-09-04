import { isProjectOwner } from './project-owner'

export const RELEASE_STATUSES = ['completed', 'in_progress', 'planned'] as const
export type ReleaseStatus = typeof RELEASE_STATUSES[number]

export const REQUEST_STATUSES = [
  'pending',
  'accepted',
  'researching',
  'trial',
  'in_progress',
  'completed',
  'blocked',
  'declined',
] as const
export type DevelopmentRequestStatus = typeof REQUEST_STATUSES[number]

export function canReadDevelopmentLog(role: string | null | undefined): boolean {
  return role === 'super'
}

export function canSubmitDevelopmentRequest(role: string | null | undefined): boolean {
  return role === 'normal' || role === 'admin' || role === 'super'
}

export function canManageDevelopmentLog(userId: string | null | undefined): boolean {
  return isProjectOwner(userId)
}

export function isReleaseStatus(value: unknown): value is ReleaseStatus {
  return typeof value === 'string' && (RELEASE_STATUSES as readonly string[]).includes(value)
}

export function isDevelopmentRequestStatus(value: unknown): value is DevelopmentRequestStatus {
  return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value)
}

export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function cleanStringList(value: unknown, maxItems = 20, maxItemLength = 500): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems)
}
