import { NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/get-user-profile'
import { createServiceClient } from '@/lib/supabase-server'

// 竞品日收是全员可用的只读工具：所有人都能查看普通竞品站点；
// 普通组员的重点／侧重站点仍按 user_site_access 授权范围显示。
// 不复用 /api/sites，避免该管理接口的角色范围误伤这个页面。
export async function GET() {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const service = createServiceClient()
    let query = service
      .from('sites')
      .select('id, domain, name, focus_level, list_url, has_rank_data, has_rank_title, friend_links, is_enabled')
      .order('created_at', { ascending: false })

    if (profile.role === 'normal') {
      if (!profile.accessibleSiteIds?.length) return NextResponse.json({ sites: [] })
      query = query.in('id', profile.accessibleSiteIds)
    }

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ sites: data ?? [] })
  } catch (error) {
    console.error('Competitor daily site query failed', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
