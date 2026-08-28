import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

async function requireAdmin() {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, service }
}

const VALID_STATUSES = ['pending', 'accepted', 'ignored']

// "新词发现"审核列表——rank-title 抓取时顺手记录的"来源词↔已知商业概念组"
// 命中证据（见 scripts/crawl-rank.ts 的 upsertDiscovery）。默认只看待审核的，
// 按"为什么值得看"排序：出现过的站点数多、命中次数多、排名好的排前面。
export async function GET(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'pending'
  const groupName = searchParams.get('groupName')
  if (!VALID_STATUSES.includes(status)) return NextResponse.json({ error: '无效的状态' }, { status: 400 })

  let query = service
    .from('commercial_keyword_discoveries')
    .select('*')
    .eq('status', status)
    .order('last_seen_at', { ascending: false })
    .limit(500)
  if (groupName) query = query.eq('group_name', groupName)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as { site_domains: string[] | null; seen_count: number; best_rank_position: number | null }[]
  rows.sort((a, b) => {
    const siteCountDiff = (b.site_domains?.length ?? 0) - (a.site_domains?.length ?? 0)
    if (siteCountDiff !== 0) return siteCountDiff
    const seenDiff = b.seen_count - a.seen_count
    if (seenDiff !== 0) return seenDiff
    if (a.best_rank_position == null && b.best_rank_position == null) return 0
    if (a.best_rank_position == null) return 1
    if (b.best_rank_position == null) return -1
    return a.best_rank_position - b.best_rank_position
  })

  return NextResponse.json({ discoveries: rows })
}

export async function PATCH(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { user, service } = ctx

  const { id, action, alias, groupName } = await req.json() as {
    id?: string; action?: 'accept' | 'ignore'; alias?: string; groupName?: string
  }
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  if (action !== 'accept' && action !== 'ignore') return NextResponse.json({ error: '无效的操作' }, { status: 400 })

  if (action === 'ignore') {
    const { error } = await service.from('commercial_keyword_discoveries')
      .update({ status: 'ignored', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // accept：把这个词正式加进商业词清单（归到指定/默认的概念组），再把这条
  // 发现标记成已处理。词已存在（比如用户自己也手动加过）就忽略冲突，不报错。
  if (!alias || !alias.trim()) return NextResponse.json({ error: '缺少要加入的别名' }, { status: 400 })
  if (!groupName || !groupName.trim()) return NextResponse.json({ error: '缺少所属概念组' }, { status: 400 })

  const { error: insertError } = await service
    .from('commercial_keywords')
    .upsert({ keyword: alias.trim(), group_name: groupName.trim(), added_by: user.id }, { onConflict: 'keyword', ignoreDuplicates: true })
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const { error } = await service.from('commercial_keyword_discoveries')
    .update({ status: 'accepted', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
