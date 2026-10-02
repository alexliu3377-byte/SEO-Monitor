import 'server-only'

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from './supabase-server'

export async function requireAppUpdateAccess(options: { managerOnly?: boolean } = {}): Promise<
  | { ok: true; userId: string; role: 'normal' | 'admin' | 'super'; service: any }
  | { ok: false; response: NextResponse }
> {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const service = createServiceClient() as any
  const { data: profile } = await service
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || profile.is_active === false || !['normal', 'admin', 'super'].includes(profile.role)) {
    return { ok: false, response: NextResponse.json({ error: '当前账号无法使用应用更新中心' }, { status: 403 }) }
  }
  if (options.managerOnly && profile.role === 'normal') {
    return { ok: false, response: NextResponse.json({ error: '只有管理员可以新增应用或来源' }, { status: 403 }) }
  }
  return { ok: true, userId: user.id, role: profile.role, service }
}

export function appUpdateDatabaseError(error: { code?: string } | null, fallback: string) {
  const missing = error?.code === '42P01' || error?.code === 'PGRST202' || error?.code === 'PGRST205'
  return NextResponse.json(
    { error: missing ? '应用更新中心数据库迁移尚未运行' : fallback },
    { status: missing ? 503 : 500 }
  )
}
