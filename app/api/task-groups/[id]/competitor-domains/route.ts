import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import type { UserRole } from '@/lib/user-context'
import { canAccessTaskGroup } from '@/lib/task-group-access'

async function getCaller(): Promise<{ id: string; role: UserRole } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return { id: user.id, role: (data?.role ?? 'normal') as UserRole }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await getCaller()
  if (!caller || caller.role === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { competitor_domains } = await req.json() as { competitor_domains: string[] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  if (!await canAccessTaskGroup(service, caller.id, caller.role, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { error } = await service
    .from('task_groups')
    .update({ competitor_domains: competitor_domains || [] })
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  return NextResponse.json({ success: true })
}
