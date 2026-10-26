import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { environmentSnapshotResponse } from '@/lib/environment-snapshot'

export const maxDuration = 60

async function handler(req: Request) {
  // 支持 Bearer CRON_SECRET（GitHub Actions 调用）或 admin/super 用户 session
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  let authed = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)

  if (!authed) {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = createServiceClient() as any
    const { data: profile } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
    if (['super', 'admin'].includes(profile?.role)) authed = true
  }
  if (!authed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    return await environmentSnapshotResponse(createServiceClient(), new URL(req.url).searchParams.get('date') ?? undefined)
  } catch (error) {
    console.error('Environment snapshot failed:', error)
    return NextResponse.json({ error: '环境快照保存失败，已保留原资料' }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
