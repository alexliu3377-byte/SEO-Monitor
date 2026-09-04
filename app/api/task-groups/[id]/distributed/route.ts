import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { guessBaseKeyword, type VolumeLookupResult } from '@/lib/keyword-base-match'
import { fetchAllRows } from '@/lib/supabase-paginate'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'

const DEFAULT_COOLDOWN_DAYS = 7
const LOOKUP_BATCH_SIZE = 100
const LOOKUP_CONCURRENCY = 10

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

async function lookupDistributedVolumes(service: any, keywords: string[]): Promise<Map<string, VolumeLookupResult>> {
  const result = new Map<string, VolumeLookupResult>()

  // Most distributed words already have an exact keyword_volume row. Resolve
  // those in batches first instead of issuing one query per word.
  for (let index = 0; index < keywords.length; index += LOOKUP_BATCH_SIZE) {
    const chunk = keywords.slice(index, index + LOOKUP_BATCH_SIZE)
    const { data, error } = await service.from('keyword_volume')
      .select('keyword, volume').in('keyword', chunk)
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as { keyword: string; volume: number }[]) {
      if (row.volume > 0) result.set(row.keyword, { volume: row.volume, source: 'exact', matchedKeyword: null })
    }
  }

  const missing = keywords.filter(keyword => !result.has(keyword))
  for (let start = 0; start < missing.length; start += LOOKUP_CONCURRENCY) {
    const batch = missing.slice(start, start + LOOKUP_CONCURRENCY)
    const resolved = await Promise.all(batch.map(async keyword => {
      const base = guessBaseKeyword(keyword)
      const hasDistinctBase = base.length >= 2 && base.toLowerCase() !== keyword.toLowerCase()
      const query = service.from('keyword_volume').select('keyword, volume')
        .ilike('keyword', hasDistinctBase ? `%${base}%` : keyword)
        .order('volume', { ascending: false }).limit(1)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      const best = (data ?? [])[0] as { keyword: string; volume: number } | undefined
      const value: VolumeLookupResult = best && best.volume > 0
        ? { volume: best.volume, source: hasDistinctBase ? 'base_match' : 'exact', matchedKeyword: hasDistinctBase ? best.keyword : null }
        : { volume: 0, source: 'unknown', matchedKeyword: null }
      return [keyword, value] as const
    }))
    for (const [keyword, value] of resolved) result.set(keyword, value)
  }

  return result
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'normal') as UserRole
  const canSeeAll = role === 'super' || role === 'admin'
  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await fetchAllRows<{ id: string; keyword: string; volume: number; volume_source: string; matched_keyword: string | null; repeatable: boolean; created_at: string; batch_id: string | null; batch_name: string | null; cooldown_days: number | null; daily_limit: number | null }>((from, to) =>
    service.from('distributed_keywords')
      .select('id, keyword, volume, volume_source, matched_keyword, repeatable, created_at, batch_id, batch_name, cooldown_days, daily_limit')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  )

  const keywords = rows.map(r => r.keyword)
  // Latest non-dismissed claim per keyword — repeatable words cycle back to
  // available once COOLDOWN_DAYS have passed since this date; non-repeatable
  // words are locked forever by any claim here, regardless of date.
  const latestClaimByKeyword = new Map<string, { user_id: string; claimed_date: string }>()
  const usernames = new Map<string, string>()
  if (keywords.length > 0) {
    const chunks: string[][] = []
    for (let index = 0; index < keywords.length; index += 100) chunks.push(keywords.slice(index, index + 100))
    const claimPages = await Promise.all(chunks.map(chunk =>
      fetchAllRows<{ id: string; keyword: string; user_id: string; claimed_date: string }>((from, to) =>
        service.from('member_claimed_keywords')
          .select('id, keyword, user_id, claimed_date')
          .eq('group_id', groupId)
          .in('keyword', chunk)
          .neq('status', 'dismissed')
          .order('claimed_date', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      )
    ))
    for (const c of claimPages.flat()) {
      if (!latestClaimByKeyword.has(c.keyword)) latestClaimByKeyword.set(c.keyword, c)
    }
    if (latestClaimByKeyword.size > 0) {
      const userIds = Array.from(new Set(Array.from(latestClaimByKeyword.values()).map(c => c.user_id)))
      const { data: members } = await service
        .from('task_group_members').select('user_id, username').eq('group_id', groupId).in('user_id', userIds)
      for (const m of (members ?? []) as { user_id: string; username: string | null }[]) {
        usernames.set(m.user_id, m.username || m.user_id.slice(0, 8))
      }
    }
  }

  const today = getMY()
  const out = rows.map(r => {
    const latest = latestClaimByKeyword.get(r.keyword)
    if (!latest) return { ...r, claimedBy: null, cooldownDaysLeft: null }
    const claimerName = usernames.get(latest.user_id) ?? latest.user_id.slice(0, 8)
    if (!r.repeatable) return { ...r, claimedBy: claimerName, cooldownDaysLeft: null }
    // 冷却天数改成逐词自己的字段（2026-08-20）——老数据/没填的批次 fallback 回7天。
    const cooldownDays = r.cooldown_days ?? DEFAULT_COOLDOWN_DAYS
    const daysSince = Math.floor((new Date(today).getTime() - new Date(latest.claimed_date).getTime()) / 86400000)
    if (daysSince < cooldownDays) return { ...r, claimedBy: claimerName, cooldownDaysLeft: cooldownDays - daysSince }
    return { ...r, claimedBy: null, cooldownDaysLeft: null } // cooldown 已过，重新可认领
  })

  return NextResponse.json({ keywords: out })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { keywords, repeatable, cooldownDays, dailyLimit, batchName } = await req.json() as {
    keywords?: string; repeatable?: boolean; cooldownDays?: number; dailyLimit?: number | null; batchName?: string
  }
  if (!keywords || !keywords.trim()) return NextResponse.json({ error: '没有输入关键词' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'normal') as UserRole
  // 添加分发词只对 super/admin 开放——不额外要求"也是这个组的成员"，因为
  // 管理员大多数时候本来就不是自己管理的每个组的正式成员（2026-08-03 实测
  // 就是被这条多余的成员校验挡住了，报 Forbidden）。
  if (role !== 'super' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const list = Array.from(new Set(
    keywords.split('\n').map(k => k.trim()).filter(Boolean)
  ))
  if (list.length === 0) return NextResponse.json({ error: '没有有效的关键词' }, { status: 400 })
  if (list.length > 200) return NextResponse.json({ error: '一次最多添加200个词' }, { status: 400 })

  // batch_id 标记"这一次提交"——冷却天数是每个词自己的属性不需要批次概念，
  // 但"每日名额上限"要知道"哪些词算同一批"才能一起计数，2026-08-20 加入。
  const batchId = crypto.randomUUID()
  const effectiveCooldownDays = Number.isFinite(cooldownDays) && cooldownDays! > 0 ? cooldownDays : DEFAULT_COOLDOWN_DAYS
  const effectiveDailyLimit = Number.isFinite(dailyLimit) && dailyLimit! > 0 ? dailyLimit : null
  const effectiveBatchName = (batchName || '').trim() || null

  const volumes = await lookupDistributedVolumes(service, list)
  const rows = list.map(keyword => {
    const { volume, source, matchedKeyword } = volumes.get(keyword) ?? { volume: 0, source: 'unknown' as const, matchedKeyword: null }
    return {
      group_id: groupId, keyword, volume, volume_source: source, matched_keyword: matchedKeyword,
      repeatable: !!repeatable, added_by: user.id,
      batch_id: batchId, batch_name: effectiveBatchName, cooldown_days: effectiveCooldownDays, daily_limit: effectiveDailyLimit,
    }
  })

  const { data: inserted, error } = await service
    .from('distributed_keywords')
    .upsert(rows, { onConflict: 'group_id,keyword' })
    .select('id, keyword, volume, volume_source, matched_keyword, repeatable, batch_name, cooldown_days, daily_limit')
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({ keywords: inserted })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { id, all } = await req.json().catch(() => ({})) as { id?: string; all?: boolean }
  if (!id && !all) return NextResponse.json({ error: '缺少参数' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'normal') as UserRole
  if (role !== 'super' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let query = service.from('distributed_keywords').delete().eq('group_id', groupId)
  if (!all) query = query.eq('id', id)
  const { error } = await query
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({ success: true })
}
