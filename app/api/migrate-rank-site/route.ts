import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

// 网站管理"排名"（has_rank_title）/"涨跌"（has_rank_data）两个模式互斥，切换
// 时可选把历史数据搬到对应表。2026-08-11 修复：这两个RPC函数原本搬去的是
// site_rank_keywords——一张早期建的、后来被 site_keyword_ranks（多了 prev_rank
// 字段，真正被 scripts/crawl-rank.ts 每天写入）取代的旧表，早就没有任何日常
// 抓取逻辑再往里写了，迁移过去等于迁移到一个不会再更新的死表。已改成
// migrate_rank_changes_to_site_keyword_ranks / migrate_site_keyword_ranks_to_rank_changes，
// 指向真正在用的 site_keyword_ranks；旧表 site_rank_keywords 已删除。
export async function POST(request: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { site_id, direction } = await request.json()
  if (!site_id || !direction) return NextResponse.json({ error: '缺少参数' }, { status: 400 })

  try {
    let rows = 0
    if (direction === 'to_site_keyword_ranks') {
      const { data, error } = await service.rpc('migrate_rank_changes_to_site_keyword_ranks', { p_site_id: site_id })
      if (error) throw error
      rows = data ?? 0
    } else if (direction === 'to_rank_changes') {
      const { data, error } = await service.rpc('migrate_site_keyword_ranks_to_rank_changes', { p_site_id: site_id })
      if (error) throw error
      rows = data ?? 0
    } else {
      return NextResponse.json({ error: '无效 direction' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, rows })
  } catch (err: unknown) {
    console.error('Rank site migration failed', err)
    return NextResponse.json({ error: '迁移失败' }, { status: 500 })
  }
}
