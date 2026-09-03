import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

// GET /api/task-groups/[id]/rules?competitor=1
// Returns rules applied to this group's sites (or competitor domains if ?competitor=1)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { id } = await params

  // Only members or admins may read a group's rules
  const { data: membership } = await service
    .from('task_group_members').select('user_id').eq('group_id', id).eq('user_id', user.id).single()
  if (!membership) {
    const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
    const role = profile?.role ?? 'normal'
    if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isCompetitor = new URL(req.url).searchParams.get('competitor') === '1'

  // Get the group
  const { data: group } = await service
    .from('task_groups').select('site_domains, competitor_domains').eq('id', id).single()
  if (!group) return NextResponse.json({ rules: [] })

  const { data: allRules, error } = await service
    .from('rules').select('*').order('rule_number', { ascending: true })
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  if (isCompetitor) {
    const groupDomains: string[] = group.competitor_domains ?? []
    const filtered = (allRules ?? []).filter((r: { competitor_domains?: string[] }) =>
      (r.competitor_domains ?? []).some((d: string) => groupDomains.includes(d))
    )
    return NextResponse.json({ rules: filtered })
  }

  // Own-site rules: resolve site_domains → site IDs
  const domains: string[] = group.site_domains ?? []
  if (domains.length === 0) return NextResponse.json({ rules: [] })

  const { data: sites } = await service
    .from('sites').select('id').in('domain', domains)
  const siteIds = (sites ?? []).map((s: { id: string }) => s.id)

  const filtered = (allRules ?? []).filter((r: { site_ids?: string[] }) =>
    (r.site_ids ?? []).some((sid: string) => siteIds.includes(sid))
  )
  return NextResponse.json({ rules: filtered })
}
