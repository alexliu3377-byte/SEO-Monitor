import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

const REPO = 'jiianzhi98-ui/SEO-Monitor'
const WORKFLOW = 'verify-deindex.yml'

// POST /api/sites/trigger-verify-deindex
// Body: { recheck?: boolean }
// Triggers the verify-deindex GitHub Actions workflow via workflow_dispatch.
export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'normal'
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { recheck } = await req.json().catch(() => ({}))

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
        inputs: { recheck_disappeared: recheck ? 'true' : 'false' },
      }),
    }
  )

  if (!ghRes.ok) {
    const errText = await ghRes.text()
    return NextResponse.json({ error: `GitHub API 错误 (${ghRes.status}): ${errText}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
