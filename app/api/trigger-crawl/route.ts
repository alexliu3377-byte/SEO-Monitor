import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { dispatchGitHubWorkflow, isCrawlStep, normalizeCrawlDomain } from '@/lib/github-actions'

export const maxDuration = 15

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'normal'
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const site = normalizeCrawlDomain(body.site)
  if (!site) return NextResponse.json({ error: '请输入有效的站点域名' }, { status: 400 })
  if (!isCrawlStep(body.step)) return NextResponse.json({ error: '无效的抓取步骤' }, { status: 400 })

  try {
    const result = await dispatchGitHubWorkflow('daily-crawl.yml', {
      step: body.step,
      site,
      date: '',
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    return NextResponse.json({ ok: true, queued: true, site, step: body.step }, { status: 202 })
  } catch (error) {
    console.error('Crawl dispatch failed', error)
    return NextResponse.json({ error: '重抓任务启动失败，请稍后重试' }, { status: 502 })
  }
}
