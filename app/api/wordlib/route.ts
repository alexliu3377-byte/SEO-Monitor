import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import { groupHotRadarFilterHash, refreshGroupHotRadarCache } from '@/lib/group-hot-radar-cache'
import type { UserRole } from '@/lib/user-context'

export const maxDuration = 60

interface WordLibraryPage {
  cacheReady: boolean
  data: Array<{ keyword: string; long_tail_count: number; site_count: number; sites: string[]; last_date: string }>
  total: number
  page: number
  pageSize: number
  computedAt: string | null
  availableDates: string[]
  availableSites: string[]
}

function integerParam(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function validDate(value: string | null) {
  if (!value) return true
  const parsed = new Date(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0 && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
}

export async function GET(request: Request) {
  try {
    const { data: { user } } = await (await createClient()).auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const params = new URL(request.url).searchParams
    const groupId = params.get('groupId') || null
    if (groupId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId)) {
      return NextResponse.json({ error: 'Invalid task group ID' }, { status: 400 })
    }
    const date = params.get('date') || null
    const startDate = params.get('startDate') || null
    const endDate = params.get('endDate') || null
    if (![date, startDate, endDate].every(validDate) || (startDate && endDate && startDate > endDate)) {
      return NextResponse.json({ error: 'Invalid date filter' }, { status: 400 })
    }
    const requestedSort = params.get('sort') || 'date'
    const sortAliases: Record<string, string> = {
      date: 'date', last_date: 'date', count: 'longTailCount', longTailCount: 'longTailCount',
      long_tail_count: 'longTailCount', siteCount: 'siteCount', site_count: 'siteCount', keyword: 'keyword',
    }
    const sort = Object.prototype.hasOwnProperty.call(sortAliases, requestedSort) ? sortAliases[requestedSort] : 'date'
    const direction = params.get('direction') === 'asc' ? 'asc' : 'desc'
    const page = integerParam(params.get('page'), 0, 0, 1000000)
    const pageSize = integerParam(params.get('pageSize'), 20, 1, 100)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any
    let expectedHash: string | null = null
    if (groupId) {
      const [{ data: profile, error: profileError }, { data: group, error: groupError }] = await Promise.all([
        db.from('user_profiles').select('role').eq('id', user.id).maybeSingle(),
        db.from('task_groups').select('rank_domains,new_domains').eq('id', groupId).maybeSingle(),
      ])
      if (profileError) throw profileError
      if (groupError) throw groupError
      if (!group) return NextResponse.json({ error: 'Task group not found' }, { status: 404 })
      if (!await canAccessTaskGroup(db, user.id, (profile?.role ?? 'normal') as UserRole, groupId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      expectedHash = groupHotRadarFilterHash({ rankDomains: group.rank_domains ?? [], newDomains: group.new_domains ?? [] })
    }
    const rpcArgs = {
      p_group_id: groupId,
      p_expected_filter_hash: expectedHash,
      p_page: page,
      p_page_size: pageSize,
      p_keyword: (params.get('q') ?? params.get('keyword') ?? params.get('search') ?? '').trim().slice(0, 200),
      p_date: date,
      p_start_date: startDate,
      p_end_date: endDate,
      p_min_long_tail: integerParam(params.get('minLongTail'), 2, 2, 2147483647),
      p_min_sites: integerParam(params.get('minSites'), 1, 1, 2147483647),
      p_site: (params.get('site') ?? '').trim().slice(0, 200),
      p_sort: sort,
      p_direction: direction,
    }
    async function readPage(): Promise<WordLibraryPage> {
      const { data, error } = await db.rpc('get_wordlib_cache_page', rpcArgs)
      if (error) throw error
      if (!data || typeof data.cacheReady !== 'boolean' || !Array.isArray(data.data)) {
        throw new Error('Invalid word library page result')
      }
      return data as WordLibraryPage
    }
    let result = await readPage()
    if (!result.cacheReady && groupId) {
      // Only a new group or an edited site scope needs a rebuild. Normal page
      // loads leave the large cache payload inside PostgreSQL.
      await refreshGroupHotRadarCache(db, groupId)
      result = await readPage()
    }
    if (!result.cacheReady) {
      return NextResponse.json({ error: '词库资料尚未生成，请稍后重试' }, { status: 503 })
    }
    return NextResponse.json({
      data: result.data, total: result.total, page: result.page, pageSize: result.pageSize,
      computedAt: result.computedAt, availableDates: result.availableDates, availableSites: result.availableSites,
    })
  } catch (error) {
    console.error('Word library cache read failed', error)
    return NextResponse.json({ error: '词库资料读取失败，请重试' }, { status: 503 })
  }
}
