export const maxDuration = 15

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { dispatchGitHubWorkflow } from '@/lib/github-actions'

const DISCOVERY_TARGETS = ['app_store', 'google_play', 'taptap'] as const
type DiscoveryTarget = (typeof DISCOVERY_TARGETS)[number]

function isDiscoveryTarget(value: unknown): value is DiscoveryTarget {
  return typeof value === 'string' && DISCOVERY_TARGETS.includes(value as DiscoveryTarget)
}

export async function POST(request: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if ((profile?.role ?? 'normal') === 'normal') {
    return NextResponse.json({ error: '只有管理员可以启动发现任务' }, { status: 403 })
  }

  const { target } = await request.json().catch(() => ({}))
  if (!isDiscoveryTarget(target)) {
    return NextResponse.json({ error: '请选择有效的应用商店' }, { status: 400 })
  }

  const result = target === 'app_store'
    ? await dispatchGitHubWorkflow('app-store-discovery.yml', {
        country: '', queryCount: '12', mode: 'mixed', includeCharts: 'true',
      })
    : await dispatchGitHubWorkflow('marketplace-discovery.yml', {
        marketplace: target, country: 'us', limit: '20',
      })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, queued: true, target }, { status: 202 })
}
