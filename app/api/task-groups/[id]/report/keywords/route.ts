import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'

interface RawKw {
  id: string; keyword: string; source: string; search_volume: number | null
  operation_type: string | null; final_keyword: string | null; page_url: string | null
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: groupId } = await params
  const { searchParams } = new URL(req.url)
  const memberId = searchParams.get('memberId')
  const date = searchParams.get('date')
  const page = Number(searchParams.get('page') || '0')
  const pageSize = Math.min(Number(searchParams.get('pageSize') || '50'), 200)

  if (!memberId || !date) return NextResponse.json({ error: 'Missing memberId or date' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'normal') as UserRole
  const canSeeAll = role === 'super' || role === 'admin'

  if (!await canAccessTaskGroup(service, user.id, role, groupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!canSeeAll && memberId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const from = page * pageSize
  const to = from + pageSize - 1

  const { data: rows, error, count } = await service
    .from('member_claimed_keywords')
    .select('id, keyword, source, search_volume, operation_type, final_keyword, page_url', { count: 'exact' })
    .eq('group_id', groupId)
    .eq('user_id', memberId)
    .eq('status', 'submitted')
    .eq('claimed_date', date)
    .order('search_volume', { ascending: false })
    .range(from, to)

  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({
    keywords: (rows ?? []).map((r: RawKw) => ({
      id: r.id,
      keyword: r.keyword,
      source: r.source,
      search_volume: Number(r.search_volume) || 0,
      operation_type: r.operation_type,
      final_keyword: r.final_keyword,
      page_url: r.page_url,
    })),
    total: count ?? 0,
    page,
    pageSize,
  })
}
