import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import type { UserRole } from '@/lib/user-context'

async function getCallerRole(): Promise<UserRole | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return ((data?.role ?? 'normal') as UserRole)
}

// GET /api/admin/users/[id]/access
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const callerRole = await getCallerRole()
  if (!callerRole || callerRole === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: target, error: targetError } = await service
    .from('user_profiles').select('role').eq('id', id).single()
  if (targetError || !target) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (callerRole === 'admin' && target.role !== 'normal') {
    return NextResponse.json({ error: 'Administrators can only manage normal accounts' }, { status: 403 })
  }
  const [{ data: restrictedSites }, { data: granted }] = await Promise.all([
    service.from('sites').select('id, domain, name, focus_level').in('focus_level', [1, 2]).order('focus_level').order('name'),
    service.from('user_site_access').select('site_id').eq('user_id', id),
  ])

  return NextResponse.json({
    restrictedSites: restrictedSites ?? [],
    grantedSiteIds: ((granted ?? []) as { site_id: string }[]).map(g => g.site_id),
  })
}

// PUT /api/admin/users/[id]/access
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const callerRole = await getCallerRole()
  if (!callerRole || callerRole === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { siteIds } = await req.json() as { siteIds: string[] }
  if (!Array.isArray(siteIds) || siteIds.length > 500 || siteIds.some(id => typeof id !== 'string')) {
    return NextResponse.json({ error: 'Invalid site list' }, { status: 400 })
  }
  const uniqueSiteIds = [...new Set(siteIds)]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const [{ data: target, error: targetError }, { data: validSites, error: sitesError }, { data: existing, error: existingError }] = await Promise.all([
    service.from('user_profiles').select('role').eq('id', id).single(),
    uniqueSiteIds.length > 0
      ? service.from('sites').select('id').in('id', uniqueSiteIds).in('focus_level', [1, 2])
      : Promise.resolve({ data: [], error: null }),
    service.from('user_site_access').select('site_id').eq('user_id', id),
  ])
  if (targetError || !target) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (callerRole === 'admin' && target.role !== 'normal') {
    return NextResponse.json({ error: 'Administrators can only manage normal accounts' }, { status: 403 })
  }
  if (sitesError || existingError) return NextResponse.json({ error: 'Unable to verify site access' }, { status: 500 })
  if ((validSites ?? []).length !== uniqueSiteIds.length) {
    return NextResponse.json({ error: 'One or more sites are invalid or unrestricted' }, { status: 400 })
  }

  const oldIds = new Set<string>(((existing ?? []) as { site_id: string }[]).map(row => row.site_id))
  const desiredIds = new Set(uniqueSiteIds)
  const toInsert = uniqueSiteIds.filter(siteId => !oldIds.has(siteId))
  const toDelete = [...oldIds].filter(siteId => !desiredIds.has(siteId))

  if (toInsert.length > 0) {
    const { error } = await service.from('user_site_access').insert(
      toInsert.map((site_id: string) => ({ user_id: id, site_id }))
    )
    if (error) return NextResponse.json({ error: 'Unable to grant site access' }, { status: 500 })
  }
  if (toDelete.length > 0) {
    const { error } = await service.from('user_site_access').delete().eq('user_id', id).in('site_id', toDelete)
    if (error) {
      if (toInsert.length > 0) {
        await service.from('user_site_access').delete().eq('user_id', id).in('site_id', toInsert)
      }
      return NextResponse.json({ error: 'Unable to revoke site access' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
