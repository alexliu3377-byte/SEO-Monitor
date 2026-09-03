import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export async function GET(_req: Request, { params }: { params: Promise<{ domain: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: callerProfile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!callerProfile || !['admin', 'super'].includes(callerProfile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { domain } = await params
  const { data } = await service
    .from('competitor_profiles').select('*').eq('domain', decodeURIComponent(domain)).maybeSingle()

  return NextResponse.json({ profile: data ?? null })
}

export async function PUT(req: Request, { params }: { params: Promise<{ domain: string }> }) {
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

  const { domain } = await params
  const body = await req.json()
  const allowed = ['site_type', 'site_weight', 'site_ip', 'site_index_count', 'post_start_hour', 'post_end_hour', 'post_interval_minutes', 'notes', 'same_base_diff_sub_is_update', 'same_name_diff_date_is_update']
  const patch: Record<string, unknown> = { domain: decodeURIComponent(domain), updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) patch[key] = body[key] ?? null
  }

  const { data, error } = await service
    .from('competitor_profiles')
    .upsert(patch, { onConflict: 'domain' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  return NextResponse.json({ profile: data })
}
