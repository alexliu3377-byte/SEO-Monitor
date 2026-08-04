import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { lookupVolumeWithFallback } from '@/lib/keyword-base-match'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role: string = profile?.role ?? 'normal'
  const canSeeAll = role === 'super' || role === 'admin'

  if (!canSeeAll) {
    const { data: membership } = await service
      .from('task_group_members').select('user_id').eq('group_id', groupId).eq('user_id', user.id).maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: rows, error } = await service
    .from('distributed_keywords')
    .select('id, keyword, volume, volume_source, matched_keyword, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const keywords = (rows || []).map((r: { keyword: string }) => r.keyword)
  const claimedByKeyword = new Map<string, string>()
  if (keywords.length > 0) {
    // Not date-scoped — a 分发词 is meant to be worked on once, not
    // re-offered daily like the signal-driven discovery tabs.
    const { data: claims } = await service
      .from('member_claimed_keywords')
      .select('keyword, user_id')
      .eq('group_id', groupId)
      .in('keyword', keywords)
      .neq('status', 'dismissed')
    if (claims && claims.length > 0) {
      const userIds = Array.from(new Set(claims.map((c: { user_id: string }) => c.user_id)))
      const { data: members } = await service
        .from('task_group_members').select('user_id, username').eq('group_id', groupId).in('user_id', userIds)
      const usernameOf = new Map<string, string>((members || []).map((m: { user_id: string; username: string | null }) => [m.user_id, m.username || m.user_id.slice(0, 8)]))
      for (const c of claims as { keyword: string; user_id: string }[]) {
        if (!claimedByKeyword.has(c.keyword)) claimedByKeyword.set(c.keyword, usernameOf.get(c.user_id) ?? c.user_id.slice(0, 8))
      }
    }
  }

  const out = (rows || []).map((r: { id: string; keyword: string; volume: number; volume_source: string; matched_keyword: string | null; created_at: string }) => ({
    ...r,
    claimedBy: claimedByKeyword.get(r.keyword) ?? null,
  }))

  return NextResponse.json({ keywords: out })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { keywords } = await req.json() as { keywords?: string }
  if (!keywords || !keywords.trim()) return NextResponse.json({ error: '没有输入关键词' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role: string = profile?.role ?? 'normal'
  // 添加分发词只对 super/admin 开放——不额外要求"也是这个组的成员"，因为
  // 管理员大多数时候本来就不是自己管理的每个组的正式成员（2026-08-03 实测
  // 就是被这条多余的成员校验挡住了，报 Forbidden）。
  if (role !== 'super' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const list = Array.from(new Set(
    keywords.split('\n').map(k => k.trim()).filter(Boolean)
  ))
  if (list.length === 0) return NextResponse.json({ error: '没有有效的关键词' }, { status: 400 })
  if (list.length > 200) return NextResponse.json({ error: '一次最多添加200个词' }, { status: 400 })

  const rows = []
  for (const keyword of list) {
    const { volume, source, matchedKeyword } = await lookupVolumeWithFallback(service, keyword)
    rows.push({
      group_id: groupId, keyword, volume, volume_source: source, matched_keyword: matchedKeyword,
      added_by: user.id,
    })
  }

  const { data: inserted, error } = await service
    .from('distributed_keywords')
    .upsert(rows, { onConflict: 'group_id,keyword' })
    .select('id, keyword, volume, volume_source, matched_keyword')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ keywords: inserted })
}
