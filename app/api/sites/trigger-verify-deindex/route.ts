import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { dispatchGitHubWorkflow } from '@/lib/github-actions'

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

  const result = await dispatchGitHubWorkflow('verify-deindex.yml', {
    recheck_disappeared: recheck ? 'true' : 'false',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ ok: true, queued: true }, { status: 202 })
}
