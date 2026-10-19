import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import type { UserRole } from '@/lib/user-context'
import { DAILY_RADAR_TABS, radarDate, radarDates, radarScope, validRadarDate } from '@/lib/radar-daily'

export const maxDuration = 60
export async function GET(request: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const tab = params.get('tab') || 'volumeRising'
  const date = params.get('date') || radarDate(tab === 'newWords' || tab === 'wordLib' ? -1 : 0)
  if (!(DAILY_RADAR_TABS as readonly string[]).includes(tab) || !validRadarDate(date)) {
    return NextResponse.json({ error: '请选择近7日或今日的有效资料日期' }, { status: 400 })
  }
  const groupId = params.get('groupId') || null
  if (groupId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId)) {
    return NextResponse.json({ error: 'Invalid group' }, { status: 400 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any
  try {
    let scope = radarScope()
    if (groupId) {
      const [{ data: profile, error: pe }, { data: group, error: ge }] = await Promise.all([
        db.from('user_profiles').select('role').eq('id', user.id).single(),
        db.from('task_groups').select('rank_domains,new_domains').eq('id', groupId).maybeSingle(),
      ])
      if (pe || ge) throw pe || ge
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })
      if (!await canAccessTaskGroup(db, user.id, profile.role as UserRole, groupId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      scope = radarScope(group.rank_domains ?? [], group.new_domains ?? [])
    }
    const integer = (key: string, fallback: number, max = 1000000) => {
      const raw = params.get(key)
      const number = raw === null ? fallback : Number(raw)
      return Number.isSafeInteger(number) ? Math.max(0, Math.min(max, number)) : fallback
    }
    const sorts = new Set(['date','keyword','volume','count','siteCount','rankDays','streak','change','netChange','long_tail_count','site_count'])
    const sortAliases: Record<string, string> = { longTailCount: 'long_tail_count', ...(tab === 'wordLib' ? { siteCount: 'site_count' } : {}) }
    const sort = sortAliases[params.get('sort') || ''] || params.get('sort') || 'date'
    const args = { p_date: date, p_scope: scope.key, p_tab: tab, p_group_id: groupId,
      p_page: integer('page', 0), p_size: Math.max(1, integer('pageSize', 20, 500)),
      p_keyword: (params.get('q') || '').trim().slice(0, 200), p_site: (params.get('site') || '').trim().slice(0, 200),
      p_min_sites: ['volumeRising','streak'].includes(tab) ? 1 : Math.max(1, integer('minSites', 1)), p_min_streak: Math.max(2, integer('minStreak', 2)),
      p_badge: ['new','updated'].includes(params.get('badge') || '') ? params.get('badge') : 'all',
      p_sort: sorts.has(sort) ? sort : 'date', p_direction: params.get('direction') === 'asc' ? 'asc' : 'desc' }
    const result = await db.rpc('get_daily_radar_page', args)
    if (result.error) throw result.error
    // Never rebuild heavy candidate data inside an interactive page request.
    if (!result.data?.cacheReady) return NextResponse.json({ error: '该日期资料缓存尚未准备好，请稍后重试' }, { status: 503 })
    return NextResponse.json({ ...result.data, availableDates: radarDates() }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Daily radar read failed', error)
    return NextResponse.json({ error: '该日期资料读取失败，请重试' }, { status: 503 })
  }
}
