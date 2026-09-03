import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service
    .from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const allowed = [
    'site_stage', 'site_focus', 'site_strategy',
    'site_weight', 'site_ip', 'site_index_count',
    'post_start_hour', 'post_end_hour', 'post_interval_minutes',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key] ?? null
  }

  const { data, error } = await service
    .from('sites').update(patch).eq('id', id)
    .select('id, domain, name, site_stage, site_focus, site_strategy, site_weight, site_ip, site_index_count, post_start_hour, post_end_hour, post_interval_minutes')
    .single()

  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  return NextResponse.json({ site: data })
}
