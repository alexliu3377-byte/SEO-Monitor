import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { resolveUserDisplayNames } from '@/lib/user-display-name'

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

function getDateRange(period: string): { startDate: string; endDate: string } {
  const today = getMY()
  if (period === 'week') {
    const now = new Date(Date.now() + 8 * 3600000)
    const day = now.getUTCDay() // 0=Sun
    const daysFromMonday = day === 0 ? 6 : day - 1
    return { startDate: getMY(-daysFromMonday), endDate: today }
  }
  if (period === 'month') {
    const now = new Date(Date.now() + 8 * 3600000)
    const firstDay = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
    return { startDate: firstDay, endDate: today }
  }
  if (period === 'yesterday') {
    const y = getMY(-1)
    return { startDate: y, endDate: y }
  }
  return { startDate: today, endDate: today }
}

interface RawRow { user_id: string; keyword: string; source: string; search_volume: number; claimed_date: string; operation_type: string | null; final_keyword: string | null; page_url: string | null }
interface RawMember { user_id: string; username: string | null; member_type: string | null }

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') || 'today'
  const customStart = searchParams.get('startDate')
  const customEnd = searchParams.get('endDate')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role: string = profile?.role ?? 'normal'
  const canSeeAll = role === 'super' || role === 'admin'

  // Get group members (username stored in task_group_members directly)
  const { data: membersRaw } = await service
    .from('task_group_members')
    .select('user_id, username, member_type')
    .eq('group_id', groupId)

  const members: { userId: string; username: string; memberType: string }[] = (membersRaw || []).map((m: RawMember) => ({
    userId: m.user_id,
    username: m.username || '',
    memberType: m.member_type || 'app',
  }))

  // Normal users must be a member of the group
  if (!canSeeAll) {
    const isMember = members.some(m => m.userId === user.id)
    if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { startDate, endDate } = (customStart && customEnd && customStart <= customEnd)
    ? { startDate: customStart, endDate: customEnd }
    : getDateRange(period)

  let query = service
    .from('member_claimed_keywords')
    .select('user_id, keyword, source, search_volume, claimed_date, operation_type, final_keyword, page_url')
    .eq('group_id', groupId)
    .eq('status', 'submitted')
    .gte('claimed_date', startDate)
    .lte('claimed_date', endDate)
    .order('claimed_date', { ascending: false })
    .order('search_volume', { ascending: false })

  if (!canSeeAll) query = query.eq('user_id', user.id)

  const { data: rows, error } = await query
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  const rawRows = (rows || []) as RawRow[]
  const allUserIds = Array.from(new Set([
    ...members.map(m => m.userId),
    ...rawRows.map(r => r.user_id),
  ]))
  const usernameOf = await resolveUserDisplayNames(service, allUserIds, (membersRaw || []) as RawMember[])
  for (const member of members) member.username = usernameOf.get(member.userId)!
  for (const userId of allUserIds) {
    if (!members.some(m => m.userId === userId)) {
      members.push({ userId, username: usernameOf.get(userId)!, memberType: 'app' })
    }
  }

  // Build per-member aggregation
  const memberMap = new Map<string, {
    userId: string; username: string; memberType: string
    sourceMap: Map<string, { count: number; volume: number }>
    dateMap: Map<string, { count: number; volume: number }>
    total: { count: number; volume: number }
  }>()

  for (const m of members) {
    if (!canSeeAll && m.userId !== user.id) continue
    memberMap.set(m.userId, {
      userId: m.userId, username: m.username, memberType: m.memberType,
      sourceMap: new Map(), dateMap: new Map(),
      total: { count: 0, volume: 0 },
    })
  }

  for (const row of rawRows) {
    if (!memberMap.has(row.user_id)) continue
    const entry = memberMap.get(row.user_id)!
    const vol = Number(row.search_volume) || 0

    // Source
    const src = entry.sourceMap.get(row.source) ?? { count: 0, volume: 0 }
    src.count += 1; src.volume += vol
    entry.sourceMap.set(row.source, src)

    // Date
    const day = entry.dateMap.get(row.claimed_date) ?? { count: 0, volume: 0 }
    day.count += 1; day.volume += vol
    entry.dateMap.set(row.claimed_date, day)

    // Total
    entry.total.count += 1; entry.total.volume += vol
  }

  const SOURCE_ORDER = ['竞品涨排名', '共新增词', '交叉词', '连续上涨词', '更新词库', '搜索量查询']

  function sortSources(map: Map<string, { count: number; volume: number }>) {
    return SOURCE_ORDER
      .filter(s => map.has(s))
      .map(s => ({ source: s, ...map.get(s)! }))
      .concat(Array.from(map.entries()).filter(([s]) => !SOURCE_ORDER.includes(s)).map(([s, v]) => ({ source: s, ...v })))
  }

  const memberResults = Array.from(memberMap.values()).map(m => ({
    userId: m.userId,
    username: m.username,
    memberType: m.memberType,
    total: m.total,
    bySource: sortSources(m.sourceMap),
    byDate: Array.from(m.dateMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, d]) => ({ date, count: d.count, volume: d.volume })),
  }))

  // Group total (admin only)
  let groupTotal = null
  if (canSeeAll) {
    const totalSourceMap = new Map<string, { count: number; volume: number }>()
    let totalCount = 0; let totalVolume = 0
    for (const m of memberResults) {
      for (const s of m.bySource) {
        const ex = totalSourceMap.get(s.source) ?? { count: 0, volume: 0 }
        ex.count += s.count; ex.volume += s.volume
        totalSourceMap.set(s.source, ex)
      }
      totalCount += m.total.count; totalVolume += m.total.volume
    }
    groupTotal = { total: { count: totalCount, volume: totalVolume }, bySource: sortSources(totalSourceMap) }
  }

  return NextResponse.json({ period, startDate, endDate, groupTotal, members: memberResults })
}
