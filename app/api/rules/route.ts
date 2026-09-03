import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { computeRowScore } from '@/lib/tracking-summary'
import { fetchAllRows } from '@/lib/supabase-paginate'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'super'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [{ data, error }, trackingRows, claimRows] = await Promise.all([
    service.from('rules').select('*').order('rule_number', { ascending: true }),
    fetchAllRows<{ id: string; rule_id: string; effectiveness: string }>((from, to) => service
      .from('competitor_tracking_records')
      .select('id, rule_id, effectiveness')
      .not('rule_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)),
    fetchAllRows<{ id: string; source_rule_id: string }>((from, to) => service
      .from('member_claimed_keywords')
      .select('id, source_rule_id')
      .not('source_rule_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)),
  ])

  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  // Aggregate competitor tracked stats per rule_id
  const statsMap = new Map<string, { tracked_success: number; tracked_fail: number; tracked_tracking: number }>()
  for (const row of trackingRows) {
    if (!row.rule_id) continue
    const s = statsMap.get(row.rule_id) ?? { tracked_success: 0, tracked_fail: 0, tracked_tracking: 0 }
    if (row.effectiveness === '有效') s.tracked_success++
    else if (row.effectiveness === '无效') s.tracked_fail++
    else s.tracked_tracking++
    statsMap.set(row.rule_id, s)
  }

  // Compute avg score per rule from member claims → site_tracking_records
  const claimToRule = new Map<string, string>()
  for (const c of claimRows) {
    claimToRule.set(c.id, c.source_rule_id)
  }

  const scoreMap = new Map<string, { total: number; count: number }>()
  if (claimToRule.size > 0) {
    const since90 = new Date(Date.now() + 8 * 3600000 - 90 * 86400000).toISOString().slice(0, 10)
    const allClaimIds = Array.from(claimToRule.keys())
    const BATCH = 200
    const siteTrackRows: { claim_id: string; rank_position: number | null; prev_rank_position: number | null; rank_volume: number | null; is_indexed: boolean; record_date: string; operation_type: string | null; submit_date: string; index_first_seen: string | null }[] = []
    const [, { data: envDays }] = await Promise.all([
      (async () => {
        for (let i = 0; i < allClaimIds.length; i += BATCH) {
          const rows = await fetchAllRows<typeof siteTrackRows[number]>((from, to) => service
            .from('site_tracking_records')
            .select('id, claim_id, rank_position, prev_rank_position, rank_volume, is_indexed, record_date, operation_type, submit_date, index_first_seen')
            .in('claim_id', allClaimIds.slice(i, i + BATCH))
            .order('record_date', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to))
          siteTrackRows.push(...rows)
        }
      })(),
      service
        .from('environment_daily')
        .select('date, crawl_anomaly, avg_index_change_pct')
        .gte('date', since90),
    ])
    // Re-sort across batches so seenClaims dedup picks the latest record_date first
    siteTrackRows.sort((a, b) => b.record_date.localeCompare(a.record_date))
    const siteTrack = siteTrackRows

    // Bad environment days: crawl anomaly OR site-wide index drop > 5%
    const badDates = new Set<string>()
    for (const e of (envDays ?? []) as { date: string; crawl_anomaly: boolean; avg_index_change_pct: number | null }[]) {
      if (e.crawl_anomaly || (e.avg_index_change_pct !== null && e.avg_index_change_pct < -5)) {
        badDates.add(e.date)
      }
    }

    const seenClaims = new Set<string>()
    for (const t of (siteTrack ?? []) as { claim_id: string; rank_position: number | null; prev_rank_position: number | null; rank_volume: number | null; is_indexed: boolean; record_date: string; operation_type: string | null; submit_date: string; index_first_seen: string | null }[]) {
      if (seenClaims.has(t.claim_id)) continue
      if (badDates.has(t.record_date)) continue  // env_excluded: try next record_date for this claim
      seenClaims.add(t.claim_id)
      const ruleId = claimToRule.get(t.claim_id)
      if (!ruleId) continue
      // 跟分组报告/成效追踪同一套公式（lib/tracking-summary.ts 的 computeRowScore
      // → lib/outcome-score.ts），'更新'型走简化版（不查历史区分真新排名）。
      const score = computeRowScore(t.rank_position, t.prev_rank_position, t.rank_volume ?? 0, t.is_indexed, t.operation_type, t.submit_date, t.index_first_seen)
      const s = scoreMap.get(ruleId) ?? { total: 0, count: 0 }
      s.total += score
      s.count += 1
      scoreMap.set(ruleId, s)
    }
  }

  const rules = (data ?? []).map((r: { id: string }) => {
    const sd = scoreMap.get(r.id)
    return {
      ...r,
      ...(statsMap.get(r.id) ?? { tracked_success: 0, tracked_fail: 0, tracked_tracking: 0 }),
      avg_score: sd && sd.count > 0 ? Math.round(sd.total / sd.count * 10) / 10 : null,
      avg_score_count: sd?.count ?? 0,
    }
  })

  return NextResponse.json({ rules })
}

export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service
    .from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { data, error } = await service
    .from('rules')
    .insert({
      name:                body.name,
      type:                body.type,
      status:              body.status ?? 'active',
      source:              body.source ?? 'manual',
      stage_applicability: body.stage_applicability ?? [],
      description:         body.description ?? null,
      confidence:          body.confidence ?? 0,
      success_count:       body.success_count ?? 0,
      fail_count:          body.fail_count ?? 0,
      priority:            body.priority ?? 0,
      site_ids:            body.site_ids ?? [],
      competitor_domains:  body.competitor_domains ?? [],
      source_key:          body.source_key ?? null,
      created_by:          user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  return NextResponse.json({ rule: data })
}
