import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { getUserProfile } from '@/lib/get-user-profile'

export async function GET() {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.accessibleSiteIds?.length === 0) return NextResponse.json([])

  try {
    const supabase = createServiceClient()
    let query = supabase
      .from('sites')
      .select('domain')
      .eq('is_enabled', true)
      .order('focus_level', { ascending: true })
    if (profile.accessibleSiteIds) query = query.in('id', profile.accessibleSiteIds)
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json((data || []).map((s: { domain: string }) => s.domain))
  } catch {
    return NextResponse.json([], { status: 500 })
  }
}
