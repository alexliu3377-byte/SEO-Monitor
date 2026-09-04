import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { invalidateGroupTrackingCache } from '@/lib/task-group-data'
import { resolveUserDisplayNames } from '@/lib/user-display-name'
import { fetchAllRows } from '@/lib/supabase-paginate'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

async function getCallerId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

async function getCallerRole(callerId: string): Promise<UserRole> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', callerId).single()
  return (data?.role ?? 'normal') as UserRole
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const callerId = await getCallerId()
  if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)
  const requestedUserId = searchParams.get('userId')
  const date = searchParams.get('date') || getMY()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const role = await getCallerRole(callerId)
  if (!await canAccessTaskGroup(service, callerId, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only an authorized admin/super can query other users' records.
  let userId = callerId
  if (requestedUserId && requestedUserId !== callerId) {
    if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    userId = requestedUserId
  }

  const SELECT_COLS = 'id, keyword, keyword_type, source, search_volume, status, operation_type, final_keyword, page_url, claimed_date, created_at'
  let keywords = await fetchAllRows<Record<string, unknown>>((from, to) => service
    .from('member_claimed_keywords')
    .select(SELECT_COLS)
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .eq('claimed_date', date)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to))

  // 待提交（pending）的认领不该因为翻到"今天"就从列表里消失——之前严格按
  // claimed_date=date 匹配，隔天再打开就看不到昨天还没提交的词了，而爬虫只
  // 追踪 status='submitted' 的认领（scripts/crawl.ts），组员往往没意识到还
  // 留着旧的待提交，直接重新认领一遍，造成重复认领+原来那条永远卡在pending。
  // （2026-08-04 用户反馈"更新提交还是有问题"排查出的根因：Joanne 08-03 认领
  // 的三个词一直卡在pending，08-04 她又重新认领了一遍才提交成功。）
  // 只在查看"今天"时才往前找——翻到某个历史日期就应该精确显示那一天，不然
  // 回看历史记录也会被塞进不属于那天的东西。
  if (date === getMY()) {
    const stray = await fetchAllRows<Record<string, unknown>>((from, to) => service
        .from('member_claimed_keywords')
        .select(SELECT_COLS)
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .lt('claimed_date', date)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to))
    if (stray.length > 0) keywords = [...stray, ...keywords]
  }

  return NextResponse.json({ keywords })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const callerId = await getCallerId()
  if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { keyword, source, search_volume, operation_type, final_keyword, page_url, source_rule_id, userId: requestedUserId } = await req.json() as {
    keyword: string
    source: string
    search_volume?: number
    operation_type?: string
    final_keyword?: string
    page_url?: string
    source_rule_id?: string | null
    userId?: string
  }

  if (!keyword || typeof keyword !== 'string' || keyword.trim().length > 200 || typeof source !== 'string' || source.length > 100) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const callerRole = await getCallerRole(callerId)
  if (!await canAccessTaskGroup(service, callerId, callerRole, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 代组员认领——只有 admin/super 能指定别人的 userId（跟 GET 的
  // requestedUserId 是同一套权限模型）。2026-08-17 加入：之前不管前端"查看
  // 谁的"切换成什么样，认领动作永远写成 callerId 自己，导致管理员切到组员
  // 视图后双击认领，认领记录实际却算在管理员自己头上——今日推荐合并视图
  // 需要"代组员认领"，顺带把这个既有的口径不一致也修掉。
  let targetUserId = callerId
  if (requestedUserId && requestedUserId !== callerId) {
    if (callerRole !== 'super' && callerRole !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    targetUserId = requestedUserId
  }

  // Verify caller is a member of this group — super/admin bypass this (2026-08-11
  // 用户反馈：超管本人没被加进某个分组的成员列表时，双击认领会被这条检查
  // 挡掉、前端又没处理403，表现就是"双击没反应"。超管/管理员本来就能看到
  // 全部分组、能编辑任何组员的认领记录（见下面 PATCH 的 canEditOthers），
  // 认领这个动作理应有同等权限，不需要先手动把自己加进成员列表）。
  const { data: targetMembership } = await service
    .from('task_group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', targetUserId)
    .maybeSingle()
  if (!targetMembership) {
    return NextResponse.json({ error: 'Claims must be assigned to a member of this group' }, { status: 400 })
  }
  if (callerRole !== 'super' && callerRole !== 'admin') {
    const { data: membership } = await service
      .from('task_group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', callerId)
      .single()
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const claimedDate = getMY()

  // Check if ANY member of the group already claimed this keyword today (not
  // just the caller) — 2026-07-29: previously only checked the caller's own
  // claims, so two different members could unknowingly both claim and work on
  // the same keyword. Same keyword + same day is now reserved group-wide.
  const { data: existing } = await service
    .from('member_claimed_keywords')
    .select('id, user_id')
    .eq('group_id', groupId)
    .eq('keyword', keyword)
    .eq('claimed_date', claimedDate)
    .neq('status', 'dismissed')
    .maybeSingle()

  if (existing) {
    let claimedByName = '其他组员'
    if (existing.user_id === targetUserId) {
      claimedByName = targetUserId === callerId ? '你自己' : '这个组员自己'
    } else {
      const { data: member } = await service
        .from('task_group_members')
        .select('username')
        .eq('group_id', groupId)
        .eq('user_id', existing.user_id)
        .maybeSingle()
      if (member?.username) claimedByName = member.username
      if (!member?.username) {
        const names = await resolveUserDisplayNames(service, [existing.user_id])
        claimedByName = names.get(existing.user_id) ?? claimedByName
      }
    }
    return NextResponse.json({ error: `这个词今天已经被${claimedByName}认领了`, claimedBy: claimedByName }, { status: 409 })
  }

  // 分发词批次每日名额上限（2026-08-20）——整组当天从同一批分发词里总共只能
  // 认领 daily_limit 个，先到先得，跟上面"同词当天已被认领"是同一种"先查后插"
  // 模式，不额外加锁。只对 source='分发词' 生效，其它认领来源不受影响。
  if (source === '分发词') {
    const { data: dw } = await service
      .from('distributed_keywords')
      .select('batch_id, daily_limit')
      .eq('group_id', groupId).eq('keyword', keyword).maybeSingle()
    if (dw?.batch_id && dw.daily_limit != null) {
      const { data: batchKeywords } = await service
        .from('distributed_keywords')
        .select('keyword').eq('batch_id', dw.batch_id)
      const kwList = (batchKeywords ?? []).map((r: { keyword: string }) => r.keyword)
      const { count } = await service
        .from('member_claimed_keywords')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', groupId).eq('claimed_date', claimedDate)
        .in('keyword', kwList).neq('status', 'dismissed')
      if ((count ?? 0) >= dw.daily_limit) {
        return NextResponse.json({ error: `这批词今天的名额（${dw.daily_limit}个）已经用完了` }, { status: 409 })
      }
    }
  }

  const { data, error } = await service
    .from('member_claimed_keywords')
    .insert({
      group_id: groupId,
      user_id: targetUserId,
      keyword,
      keyword_type: null,
      source,
      search_volume: search_volume || 0,
      claimed_date: claimedDate,
      status: 'pending',
      operation_type: operation_type || null,
      final_keyword: final_keyword || null,
      page_url: page_url || null,
      source_rule_id: source_rule_id || null,
    })
    .select('id, keyword, keyword_type, source, search_volume, status, operation_type, final_keyword, page_url, created_at')
    .single()

  if (error?.code === '23505') {
    return NextResponse.json({ error: '这个词今天已经被组内其他成员认领了' }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  await invalidateGroupTrackingCache(service, groupId)
  return NextResponse.json({ keyword: data })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const callerId = await getCallerId()
  if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { claimId, status, final_keyword, page_url, operation_type } = await req.json() as {
    claimId: string
    status?: string
    final_keyword?: string
    page_url?: string
    operation_type?: string
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const VALID_STATUSES = ['pending', 'submitted', 'dismissed']
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const service = createServiceClient() as any
  const updateData: Record<string, unknown> = {}
  if (status !== undefined) {
    updateData.status = status
    if (status === 'submitted') updateData.submitted_at = new Date().toISOString()
  }
  if (final_keyword !== undefined) updateData.final_keyword = final_keyword || null
  if (page_url !== undefined) updateData.page_url = page_url || null
  if (operation_type !== undefined) updateData.operation_type = operation_type || null

  // Admin/super can edit any member's claim; normal users can only edit their own
  const callerRole = await getCallerRole(callerId)
  if (!await canAccessTaskGroup(service, callerId, callerRole, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const canEditOthers = callerRole === 'super' || callerRole === 'admin'

  let query = service
    .from('member_claimed_keywords')
    .update(updateData)
    .eq('id', claimId)
    .eq('group_id', groupId)
  if (!canEditOthers) query = query.eq('user_id', callerId)

  const { data: updated, error } = await query.select('id').maybeSingle()
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Claim not found or not editable' }, { status: 404 })
  await invalidateGroupTrackingCache(service, groupId)
  return NextResponse.json({ success: true })
}

// Submit all pending for a given date
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const callerId = await getCallerId()
  if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const body = await req.json().catch(() => ({})) as { date?: string; userId?: string }
  const date = body.date || getMY()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const callerRole = await getCallerRole(callerId)
  if (!await canAccessTaskGroup(service, callerId, callerRole, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const targetUserId = body.userId && body.userId !== callerId && ['admin', 'super'].includes(callerRole)
    ? body.userId
    : callerId
  const { data: targetMembership } = await service
    .from('task_group_members').select('user_id')
    .eq('group_id', groupId).eq('user_id', targetUserId).maybeSingle()
  if (!targetMembership) return NextResponse.json({ error: 'Target user is not a member of this group' }, { status: 400 })

  // GET above pulls forward any older still-pending claims when viewing
  // "today" (see the comment there) — the "提交" button has to actually
  // submit those too, or they'd show up but clicking submit would silently
  // leave them untouched. Only widen this when date is today; submitting a
  // past date (browsing history) stays exact-match.
  let query = service
    .from('member_claimed_keywords')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .eq('user_id', targetUserId)
    .eq('status', 'pending')
  query = date === getMY() ? query.lte('claimed_date', date) : query.eq('claimed_date', date)

  const { error } = await query
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  await invalidateGroupTrackingCache(service, groupId)
  return NextResponse.json({ success: true })
}
