export const maxDuration = 15

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

const REPO = 'jiianzhi98-ui/SEO-Monitor'
const WORKFLOW = 'supplement-crawl.yml'

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

  const { domain, period, customUrl } = await req.json().catch(() => ({}))
  if (!domain) return NextResponse.json({ error: '缺少 domain' }, { status: 400 })
  if (!['monthly', 'weekly', 'daily'].includes(period)) {
    return NextResponse.json({ error: '无效的 period，需为 monthly/weekly/daily' }, { status: 400 })
  }

  const pat = process.env.GITHUB_PAT
  if (!pat) return NextResponse.json({ error: '服务器未配置 GITHUB_PAT，请联系管理员' }, { status: 500 })

  const ghRes = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          domain,
          period,
          custom_url: customUrl || '',
        },
      }),
    }
  )

  if (!ghRes.ok) {
    const errText = await ghRes.text()
    return NextResponse.json({ error: `GitHub API 错误 (${ghRes.status}): ${errText}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
