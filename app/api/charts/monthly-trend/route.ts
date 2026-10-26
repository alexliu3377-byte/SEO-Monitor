import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { monthlyTrendResponse } from '@/lib/monthly-trend-data'

export const maxDuration = 300

async function requireLogin(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authorization = req.headers.get('authorization')
  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any
    return { service, isCron: true }
  }

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  return { service, isCron: false }
}

export async function GET(req: Request) {
  try {
    const ctx = await requireLogin(req)
    if (ctx.error) return ctx.error
    return await monthlyTrendResponse(ctx.service, new URL(req.url).searchParams, ctx.isCron)
  } catch (error) {
    console.error('Monthly trend request failed:', error)
    return NextResponse.json({ error: '月度趋势资料读取失败，请重试' }, { status: 500 })
  }
}
