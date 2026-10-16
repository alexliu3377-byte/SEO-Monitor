import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { hotRadarSections, selectHotRadarSections, type HotRadarPayload } from '@/lib/hot-radar'
import { groupHotRadarFilterHash, refreshGroupHotRadarCache } from '@/lib/group-hot-radar-cache'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import type { UserRole } from '@/lib/user-context'

export const maxDuration = 60

export async function GET(req: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(req.url).searchParams
  const groupId = params.get('groupId')?.trim()
  if (groupId && !/^[0-9a-f-]{36}$/i.test(groupId)) {
    return NextResponse.json({ error: 'Invalid task group' }, { status: 400 })
  }
  const sections = hotRadarSections(params.get('sections'))
  const payloadColumns = sections.map(section => `${section}:payload->${section}`).join(',')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any
  try {
    // Cache hits inspect the tiny global version, not its entire JSON payload.
    const { data: global, error: globalError } = await db.from('hot_radar_cache')
      .select('computed_at,section_updated_at,failed_sections,source_data_date,source_complete,source_warnings').eq('id','latest').maybeSingle()
    if (globalError) throw globalError
    if (!global) return NextResponse.json({ error: '热词资料尚未生成，请稍后重试' }, { status: 503 })
    const sourceMeta = { sourceDataDate: global.source_data_date,sourceComplete: global.source_complete,sourceWarnings: global.source_warnings ?? [] }

    if (groupId) {
      const [{ data: profile, error: profileError }, { data: group, error: groupError }] = await Promise.all([
        db.from('user_profiles').select('role').eq('id',user.id).single(),
        db.from('task_groups').select('rank_domains,new_domains').eq('id',groupId).maybeSingle(),
      ])
      if (profileError) throw profileError
      if (groupError) throw groupError
      if (!group) return NextResponse.json({ error: 'Task group not found' }, { status: 404 })
      if (!await canAccessTaskGroup(db,user.id,(profile?.role ?? 'normal') as UserRole,groupId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const filterHash = groupHotRadarFilterHash({ rankDomains: group.rank_domains ?? [], newDomains: group.new_domains ?? [] })
      const { data: cached, error } = await db.from('group_hot_radar_cache')
        .select(`filter_hash,source_computed_at,computed_at,section_updated_at,${payloadColumns}`).eq('group_id',groupId).maybeSingle()
      if (error) throw error
      if (cached && cached.filter_hash === filterHash) {
        return NextResponse.json({
          ...selectHotRadarSections(cached as HotRadarPayload, sections),
          cache: { ...sourceMeta,computedAt: cached.computed_at, stale: cached.source_computed_at !== global.computed_at,
            sectionUpdatedAt: cached.section_updated_at, failedSections: (global.failed_sections ?? []).filter((section: string) => !(group.rank_domains?.length || group.new_domains?.length) || section === 'volumeRisingWords') },
        })
      }
      // Only a new/edited group's missing result is rebuilt. An older valid
      // result remains readable while nightly refreshes run.
      const refreshed = await refreshGroupHotRadarCache(db,groupId)
      if (!refreshed) return NextResponse.json({ error: '分组热词资料尚未生成，请稍后重试' }, { status: 503 })
      return NextResponse.json({ ...selectHotRadarSections(refreshed.payload,sections), cache: { ...sourceMeta,computedAt: refreshed.computed_at, stale: false,sectionUpdatedAt: refreshed.section_updated_at,failedSections: (global.failed_sections ?? []).filter((section: string) => !(group.rank_domains?.length || group.new_domains?.length) || section === 'volumeRisingWords') } })
    }
    const { data: cached, error } = await db.from('hot_radar_cache').select(payloadColumns).eq('id','latest').single()
    if (error) throw error
    return NextResponse.json({
      ...selectHotRadarSections(cached as HotRadarPayload, sections),
      cache: { ...sourceMeta,computedAt: global.computed_at, sectionUpdatedAt: global.section_updated_at, failedSections: global.failed_sections ?? [] },
    })
  } catch (error) {
    console.error('Hot radar cache read failed', error)
    return NextResponse.json({ error: '热词资料读取失败，请稍后重试' }, { status: 503 })
  }
}
