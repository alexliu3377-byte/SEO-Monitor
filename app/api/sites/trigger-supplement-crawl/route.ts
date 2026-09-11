export const maxDuration = 15

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { dispatchGitHubWorkflow, normalizeCrawlDomain } from '@/lib/github-actions'

// POST /api/sites/trigger-supplement-crawl
// Triggers the supplement-crawl GitHub Actions workflow via workflow_dispatch.
export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'normal'
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { domain: rawDomain, period, customUrl } = await req.json().catch(() => ({}))
  const domain = normalizeCrawlDomain(rawDomain)
  if (!domain) return NextResponse.json({ error: '请输入有效的站点域名' }, { status: 400 })
  if (!['monthly', 'weekly', 'daily'].includes(period)) {
    return NextResponse.json({ error: '无效的 period，需为 monthly/weekly/daily' }, { status: 400 })
  }

  const result = await dispatchGitHubWorkflow('supplement-crawl.yml', {
    domain,
    period,
    custom_url: typeof customUrl === 'string' ? customUrl : '',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ ok: true, queued: true }, { status: 202 })
}
