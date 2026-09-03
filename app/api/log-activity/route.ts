import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { activityStart, activityEnd } from '@/lib/activity-log'

export async function POST(req: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { step, domain, summary, ok, durationMs } = await req.json()
    const cleanStep = typeof step === 'string' ? step.slice(0, 80) : undefined
    const cleanDomain = typeof domain === 'string' && /^[a-z0-9.-]{1,253}$/i.test(domain) ? domain.toLowerCase() : undefined
    const cleanSummary = typeof summary === 'string' ? summary.slice(0, 500) : undefined
    const cleanOk = Number.isFinite(ok) ? Math.max(0, Math.min(1_000_000, Math.trunc(ok))) : 0
    const cleanDuration = Number.isFinite(durationMs) ? Math.max(0, Math.min(3_600_000, Math.trunc(durationMs))) : undefined
    const supabase = createServiceClient()
    const aid = await activityStart(supabase, {
      type: 'search',
      source: 'browser',
      step: cleanStep,
      domain: cleanDomain,
    })
    if (aid) await activityEnd(supabase, aid, {
      status: 'done',
      ok: cleanOk,
      durationMs: cleanDuration,
      summary: cleanSummary,
    })
  } catch { /* logging must never fail the caller */ }
  return NextResponse.json({ ok: true })
}
