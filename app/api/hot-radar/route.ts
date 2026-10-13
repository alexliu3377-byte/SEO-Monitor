import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeHotRadarPayload } from '@/lib/hot-radar'
import { groupHotRadarFilterHash, refreshGroupHotRadarCache } from '@/lib/group-hot-radar-cache'
import { canAccessTaskGroup } from '@/lib/task-group-access'
import type { UserRole } from '@/lib/user-context'

export const maxDuration = 60

// 2026-08-11 起改成读 hot_radar_cache（由 daily-crawl.yml 在关键词重试后
// 先刷新、收录重试后再完整刷新），不再每次现场跑
// get_hot_new_words/get_hot_rank_words/get_hot_streak_words 三个RPC——这三个
// RPC 要扫 rank_changes/site_keyword_ranks 近30天全量数据（永久保留、每天
// 持续写入），单次2-8秒，用户反馈"热词雷达/分组任务每天打开都很慢"。
// 缓存没命中（比如刚上线还没跑过定时任务）时现场算一次并顺手写回缓存，
// 不会一直空着——但正常情况下每天只应该现场算这一次，其余请求都是缓存命中。
// （之前这里还留了 export const revalidate = 300，但 handler 里调用了
// auth.getUser() 读 cookie，Next.js 因此把这条路由判定成动态路由，路由级
// revalidate 对动态路由不生效，是个死配置，删掉——真正的缓存靠上面这张表。）
export async function GET(req: Request) {
  const authCheck = await createClient()
  const { data: { user } } = await authCheck.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any

  const groupId = new URL(req.url).searchParams.get('groupId')?.trim()
  if (groupId) {
    const [{ data: profile }, { data: group, error: groupError }, { data: globalCache, error: globalError }] = await Promise.all([
      supabase.from('user_profiles').select('role').eq('id', user.id).single(),
      supabase.from('task_groups').select('id, rank_domains, new_domains').eq('id', groupId).maybeSingle(),
      supabase.from('hot_radar_cache').select('payload, computed_at').eq('id', 'latest').maybeSingle(),
    ])
    if (groupError || !group) return NextResponse.json({ error: 'Task group not found' }, { status: 404 })
    const role = (profile?.role ?? 'normal') as UserRole
    if (!await canAccessTaskGroup(supabase, user.id, role, groupId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (globalError || !globalCache?.payload) {
      return NextResponse.json({ error: 'Hot radar cache is not ready' }, { status: 503 })
    }

    const expectedHash = groupHotRadarFilterHash({
      rankDomains: group.rank_domains ?? [],
      newDomains: group.new_domains ?? [],
    })
    const { data: groupCache, error: groupCacheError } = await supabase.from('group_hot_radar_cache')
      .select('payload, filter_hash, source_computed_at')
      .eq('group_id', groupId)
      .maybeSingle()

    if (
      !groupCacheError
      && groupCache?.payload
      && groupCache.filter_hash === expectedHash
      && groupCache.source_computed_at === globalCache.computed_at
    ) {
      return NextResponse.json(groupCache.payload)
    }

    // A just-created/edited group may not have a row yet. Build only this
    // group's compact cache immediately instead of making the member wait for
    // the next nightly refresh. If the migration is still rolling out, fall
    // back to the global payload so the workspace remains usable.
    try {
      const refreshed = await refreshGroupHotRadarCache(supabase, groupId)
      if (refreshed?.payload) return NextResponse.json(refreshed.payload)
    } catch (error) {
      console.error('Group hot radar cache refresh failed', { groupId, error })
    }
    return NextResponse.json(globalCache.payload)
  }

  const { data: cached } = await supabase.from('hot_radar_cache').select('payload').eq('id', 'latest').maybeSingle()
  if (cached?.payload) return NextResponse.json(cached.payload)

  const { payload } = await computeHotRadarPayload(supabase)
  await supabase.from('hot_radar_cache').upsert({ id: 'latest', payload, computed_at: new Date().toISOString() })
  return NextResponse.json(payload)
}
