import { NextResponse } from 'next/server'
import { getContentCaller } from '@/lib/content-access-server'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import { resolveUserDisplayNames } from '@/lib/user-display-name'
import { computeGroupTrackingPayload, saveGroupTrackingPayload, type EnrichedTrackRow } from '@/lib/group-tracking-cache'
import { dedupeTrackingTargets } from '@/lib/tracking-target-dedupe'
import { OVERWRITE_PAGE_SIZE, overwriteError, parseOverwriteRequest, validateOverwriteUrl } from '@/lib/submission-overwrite'

export const maxDuration = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const privateHeaders = { 'Cache-Control': 'private, no-store' }
type Context = { params: Promise<{ id: string }> }

async function authorize(context: Context) {
  const { caller, service } = await getContentCaller()
  const { id: groupId } = await context.params
  if (!caller) return { response: NextResponse.json({ error: '请先登录' }, { status: 401 }) }
  if (!UUID.test(groupId)) return { response: NextResponse.json({ error: '分组编号无效' }, { status: 400 }) }
  if (!await canAccessTaskGroup(service, caller.id, caller.role, groupId)) return { response: NextResponse.json({ error: '你没有这个分组的权限' }, { status: 403 }) }
  return { caller, service, groupId }
}

export async function GET(request: Request, context: Context) {
  const access = await authorize(context)
  if (access.response) return access.response
  const { service, caller, groupId } = access
  const params = new URL(request.url).searchParams
  const pageInput = params.get('page') ?? '0'
  if (!/^\d{1,4}$/.test(pageInput)) return NextResponse.json({ error: '页码无效' }, { status: 400 })
  const page = Number(pageInput)
  const claimId = params.get('claimId')
  if (claimId) {
    if (!UUID.test(claimId)) return NextResponse.json({ error: '提交记录编号无效' }, { status: 400 })
    const { data, error, count } = await service.from('submission_overwrite_history')
      .select('id,actor_name,old_username,before_submission,after_submission,overwritten_at', { count: 'exact' })
      .eq('group_id', groupId).eq('claim_id', claimId)
      .order('overwritten_at', { ascending: false }).order('id')
      .range(page * OVERWRITE_PAGE_SIZE, (page + 1) * OVERWRITE_PAGE_SIZE - 1)
    if (error) {
      const failure = overwriteError(error)
      return NextResponse.json({ error: failure.message }, { status: failure.status })
    }
    return NextResponse.json({ rows: (data ?? []).map((row: {
      id: string; actor_name: string; old_username: string; overwritten_at: string
      before_submission: { keyword: string; final_keyword: string | null; submitted_at: string | null }
      after_submission: { keyword: string }
    }) => ({
      id: row.id, actor_name: row.actor_name, old_username: row.old_username, overwritten_at: row.overwritten_at,
      old_keyword: row.before_submission.keyword, old_final_keyword: row.before_submission.final_keyword,
      old_submitted_at: row.before_submission.submitted_at, new_keyword: row.after_submission.keyword,
    })), total: count ?? 0, page, pageSize: OVERWRITE_PAGE_SIZE }, { headers: privateHeaders })
  }
  let url: string
  try { url = validateOverwriteUrl(params.get('url')) } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
  const { data, error } = await service.rpc('find_group_submissions_for_overwrite', {
    p_actor_id: caller.id, p_group_id: groupId, p_url: url, p_offset: page * OVERWRITE_PAGE_SIZE,
  })
  if (error) {
    const failure = overwriteError(error)
    return NextResponse.json({ error: failure.message }, { status: failure.status })
  }
  const names = await resolveUserDisplayNames(service, [caller.id])
  return NextResponse.json({ ...data, actorName: names.get(caller.id), page, pageSize: OVERWRITE_PAGE_SIZE }, { headers: privateHeaders })
}

export async function POST(request: Request, context: Context) {
  const access = await authorize(context)
  if (access.response) return access.response
  const { caller, service, groupId } = access
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return NextResponse.json({ error: '请求内容过大' }, { status: 413 })
  let input: ReturnType<typeof parseOverwriteRequest>
  try {
    const body = await request.text()
    if (Buffer.byteLength(body, 'utf8') > 4096) return NextResponse.json({ error: '请求内容过大' }, { status: 413 })
    input = parseOverwriteRequest(JSON.parse(body))
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? '请求格式不正确' : (error as Error).message }, { status: 400 })
  }
  // Keep a server-only snapshot for incremental cache repair. The atomic RPC
  // removes both old caches, so no stale former-owner report remains visible.
  const cached = await service.from('group_tracking_cache').select('payload,computed_at').eq('group_id', groupId).maybeSingle()
  const { data: result, error } = await service.rpc('overwrite_group_submission', {
    p_actor_id: caller.id, p_group_id: groupId, p_claim_id: input.claimId,
    p_expected_version: input.version, p_keyword: input.keyword,
  })
  if (error) {
    const failure = overwriteError(error)
    return NextResponse.json({ error: failure.message }, { status: failure.status })
  }
  let cacheReady = false
  try {
    const oldRows = cached.data?.payload as EnrichedTrackRow[] | undefined
    const cachedAt = Date.parse(cached.data?.computed_at ?? '')
    const usableCache = !cached.error && Array.isArray(oldRows) && Number.isFinite(cachedAt)
      && Date.now() - cachedAt <= 26 * 3600000 && oldRows.every(row => Array.isArray(row.device_rankings))
    const rows = usableCache
      ? dedupeTrackingTargets([
          ...oldRows!.filter(row => row.claim_id !== input.claimId),
          ...await computeGroupTrackingPayload(service, groupId, input.claimId),
        ])
      : await computeGroupTrackingPayload(service, groupId)
    await saveGroupTrackingPayload(service, groupId, rows)
    cacheReady = true
  } catch (cacheError) {
    // The submission/history transaction has already committed. Do not return
    // an apparent failed overwrite that encourages duplicate retries.
    console.warn('Submission overwrite saved; tracking cache refresh pending', {
      groupId, claimId: input.claimId, code: (cacheError as { code?: string }).code,
    })
  }
  return NextResponse.json({ success: true, ...result, cacheReady,
    message: cacheReady ? '覆盖成功，成效报告已同步' : '覆盖成功；成效缓存尚待刷新，提交与历史已保存',
  }, { headers: privateHeaders })
}
