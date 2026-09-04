// IMPORTANT: Update lib/crawl-rules.ts and the rules modal in crawl-log/page.tsx
// whenever you change crawl logic, step timing, write targets, or add new steps.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export type ActivityType = 'cron_task' | 'cron_manual'
export type SiteLogStatus = 'ok' | 'empty' | 'skip' | 'fail' | 'suspect'

export async function activityStart(sb: Sb, opts: {
  type: ActivityType
  source: string
  step?: string
  domain?: string
  groupIndex?: number
  totalGroups?: number
  ip?: string
}): Promise<string | null> {
  try {
    const { data } = await sb.from('activity_log').insert({
      type: opts.type,
      source: opts.source,
      step: opts.step ?? null,
      domain: opts.domain ?? null,
      group_index: opts.groupIndex ?? null,
      total_groups: opts.totalGroups ?? null,
      ip: opts.ip ?? null,
      status: 'running',
    }).select('id').single()
    return (data as { id: string } | null)?.id ?? null
  } catch { return null }
}

export async function activityEnd(sb: Sb, id: string, opts: {
  status: 'done' | 'warn' | 'fail'
  ok?: number
  empty?: number
  skip?: number
  fail?: number
  rowsWritten?: number
  durationMs?: number
  summary?: string
}) {
  try {
    await sb.from('activity_log').update({
      status: opts.status,
      ok_count: opts.ok ?? 0,
      empty_count: opts.empty ?? 0,
      skip_count: opts.skip ?? 0,
      fail_count: opts.fail ?? 0,
      rows_written: opts.rowsWritten ?? 0,
      duration_ms: opts.durationMs ?? null,
      summary: opts.summary ?? null,
    }).eq('id', id)
  } catch { /* never throw — logging must not break crawls */ }
}

export async function siteLog(sb: Sb, activityId: string, opts: {
  domain: string
  status: SiteLogStatus
  rowsWritten?: number
  detail?: string
}) {
  try {
    await sb.from('activity_site_log').insert({
      activity_id: activityId,
      domain: opts.domain,
      status: opts.status,
      rows_written: opts.rowsWritten ?? 0,
      detail: opts.detail ?? null,
    })
  } catch { /* ignore */ }
}
