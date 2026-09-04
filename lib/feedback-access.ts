export type FeedbackRole = 'normal' | 'admin' | 'super'
export type FeedbackScope = 'mine' | 'routine' | 'super'

export const FEEDBACK_TYPES = ['bug', 'usability', 'data', 'performance', 'feature', 'optimization', 'other'] as const
export type FeedbackType = typeof FEEDBACK_TYPES[number]

export const FEEDBACK_PAGES = [
  'home', 'charts', 'task-groups', 'group-report', 'research', 'hot-keywords',
  'site-intel', 'weight-monitor', 'index-monitor', 'competitor-daily', 'index-pages',
  'sites', 'crawl-log', 'development-log', 'settings', 'feedback',
] as const
export type FeedbackPage = typeof FEEDBACK_PAGES[number]

export const FEEDBACK_MESSAGE_TYPES = ['discussion', 'research', 'experiment', 'decision'] as const
export type FeedbackMessageType = typeof FEEDBACK_MESSAGE_TYPES[number]

export const ACTIVE_FEEDBACK_STATUSES = ['pending', 'accepted', 'in_progress', 'blocked'] as const

export function isFeedbackRole(value: unknown): value is FeedbackRole {
  return value === 'normal' || value === 'admin' || value === 'super'
}

export function isFeedbackType(value: unknown): value is FeedbackType {
  return typeof value === 'string' && (FEEDBACK_TYPES as readonly string[]).includes(value)
}

export function isFeedbackPage(value: unknown): value is FeedbackPage {
  return typeof value === 'string' && (FEEDBACK_PAGES as readonly string[]).includes(value)
}

export function isFeedbackMessageType(value: unknown): value is FeedbackMessageType {
  return typeof value === 'string' && (FEEDBACK_MESSAGE_TYPES as readonly string[]).includes(value)
}

export function feedbackScopeFor(role: FeedbackRole, requested: string | null): FeedbackScope {
  if (role === 'normal') return 'mine'
  if (role === 'admin') return 'routine'
  return requested === 'super' ? 'super' : 'routine'
}

export function canViewFeedback(
  viewerId: string,
  viewerRole: FeedbackRole,
  submitterId: string | null,
  submitterRole: FeedbackRole,
  scope: FeedbackScope
): boolean {
  if (viewerRole === 'normal') return submitterId === viewerId
  if (viewerRole === 'admin') return submitterRole !== 'super'
  return scope === 'super' ? submitterRole === 'super' : submitterRole !== 'super'
}

export function feedbackSubmissionLimits(role: FeedbackRole): { daily: number | null; open: number | null } {
  if (role === 'normal') return { daily: 2, open: 3 }
  if (role === 'admin') return { daily: 5, open: 10 }
  return { daily: null, open: null }
}
