import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from './supabase-server'
import { canManageDevelopmentLog, canReadDevelopmentLog } from './development-log'

export async function authorizeDevelopmentLog(write = false) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: '请先登录' }, { status: 401 }) }
  const service = createServiceClient() as any
  const { data: profile, error } = await service.from('user_profiles').select('role, username, is_active').eq('id', user.id).maybeSingle()
  if (error || !profile || profile.is_active === false || !canReadDevelopmentLog(profile.role)
    || (write && !canManageDevelopmentLog(user.id))) {
    return { error: NextResponse.json({ error: write ? '只有项目负责人可以维护开发进度' : '无权查看开发进度' }, { status: 403 }) }
  }
  return { service, user, canManage: canManageDevelopmentLog(user.id) }
}

export function developmentDatabaseError(error: { code?: string; message?: string } | null) {
  const code = error?.code
  const missing = ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code ?? '')
  if (missing) return NextResponse.json({ error: '开发进度尚未初始化，请联系负责人完成数据库更新' }, { status: 503 })
  if (code === '40001') return NextResponse.json({ error: '这条事项已有更新，请关闭后重新打开再编辑；你的输入尚未清除' }, { status: 409 })
  if (code === 'P0002') return NextResponse.json({ error: '事项不存在' }, { status: 404 })
  if (code === '22023') return NextResponse.json({ error: '阶段、检查项或验收资料不完整；归档还需要选择已发布版本' }, { status: 400 })
  return NextResponse.json({ error: '开发进度操作失败，请稍后重试' }, { status: 500 })
}
