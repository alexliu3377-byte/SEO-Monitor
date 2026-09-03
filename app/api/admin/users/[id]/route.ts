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

// PATCH /api/admin/users/[id]
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerRole()
  if (!caller || caller.role === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { role, username, email, password } = await req.json() as {
    role?: UserRole; username?: string; email?: string; password?: string
  }

  if (role !== undefined && !['normal', 'admin', 'super'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (username !== undefined && (!username.trim() || username.trim().length > 64)) {
    return NextResponse.json({ error: 'Invalid username' }, { status: 400 })
  }
  if (password !== undefined && password.length < 8) {
    return NextResponse.json({ error: 'Password must contain at least 8 characters' }, { status: 400 })
  }

  if (role !== undefined && caller.role === 'admin' && role === 'super') {
    return NextResponse.json({ error: '无权限设置超级账号' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: target, error: targetError } = await service.from('user_profiles').select('role').eq('id', id).single()
  if (targetError || !target) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (caller.role === 'admin' && target.role !== 'normal') {
    return NextResponse.json({ error: '无权限修改超级账号' }, { status: 403 })
  }

  // Update user_profiles (role / username)
  const profileUpdate: Record<string, unknown> = {}
  if (role !== undefined) profileUpdate.role = role
  if (username !== undefined) profileUpdate.username = username.trim()
  if (Object.keys(profileUpdate).length > 0) {
    const { error } = await service.from('user_profiles').update(profileUpdate).eq('id', id)
    if (error) {
      const status = error.code === '23505' ? 409 : 500
      return NextResponse.json({ error: status === 409 ? 'Username is already in use' : 'Profile update failed' }, { status })
    }
  }

  // Update auth user (email / password)
  if (email || password) {
    const authUpdate: { email?: string; password?: string } = {}
    if (email) authUpdate.email = email
    if (password) authUpdate.password = password
    const { error } = await service.auth.admin.updateUserById(id, authUpdate)
    if (error) return NextResponse.json({ error: 'Login details update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/users/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerRole()
  if (!caller || caller.role === 'normal') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (caller.callerId === id) {
    return NextResponse.json({ error: '不能删除自己的账号' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: target, error: targetError } = await service.from('user_profiles').select('role').eq('id', id).single()
  if (targetError || !target) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (caller.role === 'admin' && target.role !== 'normal') {
    return NextResponse.json({ error: '无权限删除超级账号' }, { status: 403 })
  }

  const { error } = await service.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: 'Account deletion failed' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
