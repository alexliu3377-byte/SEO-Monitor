import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import type { UserRole } from '@/lib/user-context'

async function getCallerRole(): Promise<{ callerId: string; role: UserRole } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return { callerId: user.id, role: ((data?.role ?? 'normal') as UserRole) }
}

const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/

function isValidIpv4(ip: string) {
  return ipv4Re.test(ip) && ip.split('.').every(part => Number(part) >= 0 && Number(part) <= 255)
}

// GET /api/admin/users/[id]/ip-whitelist
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerRole()
  if (!caller || caller.role === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data, error } = await service
    .from('user_profiles')
    .select('role, allowed_ips')
    .eq('id', id)
    .single()
  if (error || !data) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (caller.role === 'admin' && data.role !== 'normal') {
    return NextResponse.json({ error: 'Administrators can only manage normal accounts' }, { status: 403 })
  }

  return NextResponse.json({ allowedIps: data?.allowed_ips ?? [] })
}

// PUT /api/admin/users/[id]/ip-whitelist
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerRole()
  if (!caller || caller.role === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { allowedIps } = await req.json() as { allowedIps: string[] }
  if (!Array.isArray(allowedIps) || allowedIps.length > 50 || allowedIps.some(ip => typeof ip !== 'string')) {
    return NextResponse.json({ error: 'Invalid IP list' }, { status: 400 })
  }
  const normalized = [...new Set(allowedIps.map(ip => ip.trim()).filter(Boolean))]
  if (normalized.some(ip => !isValidIpv4(ip))) {
    return NextResponse.json({ error: 'Invalid IPv4 address' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: target, error: targetError } = await service
    .from('user_profiles').select('role').eq('id', id).single()
  if (targetError || !target) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (caller.role === 'admin' && target.role !== 'normal') {
    return NextResponse.json({ error: 'Administrators can only manage normal accounts' }, { status: 403 })
  }
  const { error } = await service
    .from('user_profiles')
    .update({ allowed_ips: normalized.length > 0 ? normalized : null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'IP whitelist update failed' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
