import { fetchAllRows } from './supabase-paginate'
import type { FeedbackRole } from './feedback-access'

// The API authenticates and checks active role before calling this service-only helper.
export async function loadFeedbackUnreadCount(service: any, viewerId: string, role: FeedbackRole): Promise<number> {
  const { data, error } = await service.rpc('get_feedback_unread_count', { p_viewer_id: viewerId })
  if (!error) {
    const count = typeof data === 'string' && /^\d+$/.test(data) ? Number(data) : data
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid unread count')
    return count
  }
  // Deploy-compatible fallback only when this additive migration is absent.
  // Database outages and denied permissions must not be disguised as an empty badge.
  if (!['PGRST202', '42883'].includes(error.code)) throw error
  type UnreadCandidate = { id: string; latest_message_at: string; latest_message_author_id: string | null }
  type ReadState = { request_id: string; last_read_at: string }
  const visibleSubmitterRoles = role === 'super' ? ['normal', 'admin', 'super'] : ['normal', 'admin']
  const candidates = await fetchAllRows<UnreadCandidate>((from, to) => service
    .from('development_requests')
    .select('id, latest_message_at, latest_message_author_id')
    .in('submitter_role', visibleSubmitterRoles)
    .not('latest_message_at', 'is', null)
    .neq('latest_message_author_id', viewerId)
    .order('id', { ascending: true })
    .range(from, to))
  const reads = await fetchAllRows<ReadState>((from, to) => service
    .from('development_request_message_reads')
    .select('request_id, last_read_at')
    .eq('user_id', viewerId)
    .order('request_id', { ascending: true })
    .range(from, to))
  const readAt = new Map(reads.map(read => [read.request_id, read.last_read_at]))
  const unreadCount = candidates.reduce((count, request) => {
    const lastReadAt = readAt.get(request.id)
    return !lastReadAt || Date.parse(lastReadAt) < Date.parse(request.latest_message_at) ? count + 1 : count
  }, 0)
  return unreadCount
}
