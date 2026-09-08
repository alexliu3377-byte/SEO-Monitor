export type FeedbackRole = 'normal' | 'admin' | 'super'
export type FeedbackScope = 'board' | 'mine' | 'super'

export const FEEDBACK_TYPES = ['bug', 'usability', 'data', 'performance', 'feature', 'optimization', 'site_submission', 'other'] as const
export type FeedbackType = typeof FEEDBACK_TYPES[number]

export const FEEDBACK_PAGES = [
  'home', 'charts', 'task-groups', 'group-report', 'research', 'hot-keywords',
  'trend-discovery',
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

export function normalizeSubmittedSite(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > 500) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
    if (!hostname.includes('.') || hostname === 'localhost' || /^\d+(\.\d+){3}$/.test(hostname)) return null
    if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.split('.').some(label => !label || label.startsWith('-') || label.endsWith('-'))) return null
    return hostname
  } catch {
    return null
  }
}

export function feedbackScopeFor(role: FeedbackRole, requested: string | null): FeedbackScope {
  if (requested === 'mine') return 'mine'
  if (role === 'super' && requested === 'super') return 'super'
  return 'board'
}

export function canViewFeedback(
  viewerId: string,
  viewerRole: FeedbackRole,
  submitterId: string | null,
  submitterRole: FeedbackRole,
  scope: FeedbackScope
): boolean {
  if (scope === 'mine') return submitterId === viewerId
  if (scope === 'super') return viewerRole === 'super' && submitterRole === 'super'
  return submitterRole !== 'super'
}

export function canReadFeedbackConversation(viewerRole: FeedbackRole, submitterRole: FeedbackRole): boolean {
  return submitterRole === 'super' ? viewerRole === 'super' : true
}

export function canReplyFeedbackConversation(
  viewerId: string,
  viewerRole: FeedbackRole,
  submitterId: string | null,
  submitterRole: FeedbackRole,
  isProjectOwner: boolean
): boolean {
  if (submitterRole === 'super') return viewerRole === 'super'
  return isProjectOwner || submitterId === viewerId
}

export function feedbackSubmissionLimits(role: FeedbackRole): { daily: number | null; open: number | null } {
  if (role === 'normal') return { daily: 2, open: 3 }
  if (role === 'admin') return { daily: 5, open: 10 }
  return { daily: null, open: null }
}
