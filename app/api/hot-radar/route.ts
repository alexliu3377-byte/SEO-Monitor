import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export const revalidate = 300  // cache 5 min; hot-radar data only updates twice a day
export const maxDuration = 30

function getMY(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

interface NewWordRow   { keyword: string; site_count: number; total_count: number; sites: string[]; first_date: string; last_date: string }
interface RankWordRow  { keyword: string; site_count: number; max_volume: number;  sites: string[]; first_date: string; last_date: string; rank_days: number }
interface StreakWordRow { keyword: string; domain: string; streak: number; volume: number; first_seen: string; last_seen: string }
interface VolumeRisingRow { keyword: string; volume: number; prev_volume: number | null; volume_change: number; stat_date: string }

export async function GET() {
  const authCheck = createClient()
  const { data: { user } } = await authCheck.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const since = getMY(-30)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const [
    { data: newWordsRaw },
    { data: rankWordsRaw },
    { data: streakWordsRaw },
    { data: volumeRisingRaw },
  ] = await Promise.all([
    db.rpc('get_hot_new_words',    { p_since: since }),
    db.rpc('get_hot_rank_words',   { p_since: since }),
    db.rpc('get_hot_streak_words', { p_since: since }),
    // keyword_volume only ever holds one row per keyword (see lib/keyword-volume.ts),
    // so "recently rose" just means volume_change > 0 on that single row, scoped
    // to a recent stat_date so long-stale rises don't linger forever.
    db.from('keyword_volume')
      .select('keyword, volume, prev_volume, volume_change, stat_date')
      .gt('volume_change', 0)
      .gte('stat_date', getMY(-14))
      .order('volume_change', { ascending: false })
      .limit(500),
  ])

  const toDate = (v: unknown) => v ? String(v).slice(0, 10) : ''

  const newWords = ((newWordsRaw || []) as NewWordRow[]).map((r) => ({
    keyword:   r.keyword,
    count:     Number(r.total_count),
    siteCount: Number(r.site_count),
    sites:     r.sites || [],
    last_date:  toDate(r.last_date),
    first_date: toDate(r.first_date),
  }))

  const rankWords = ((rankWordsRaw || []) as RankWordRow[]).map((r) => ({
    keyword:   r.keyword,
    siteCount: Number(r.site_count),
    volume:    Number(r.max_volume),
    sites:     r.sites || [],
    last_date:  toDate(r.last_date),
    first_date: toDate(r.first_date),
    rankDays:   Number(r.rank_days),
  }))

  const streakWords = ((streakWordsRaw || []) as StreakWordRow[]).map((r) => ({
    keyword:    r.keyword,
    streak:     Number(r.streak),
    domain:     r.domain,
    volume:     Number(r.volume),
    first_date: toDate(r.first_seen),
    last_date:  toDate(r.last_seen),
  }))

  // Cross-reference against our own rank_changes: does any tracked site
  // already rank for this rising-volume keyword? "出现站点" looks across the
  // whole 14-day window, but "排名波动" only cares about the MOST RECENT date
  // that has any data — 'both' only fires when that single latest date has
  // both a rankup and a rankdown (e.g. two different sites moving opposite
  // ways the same day), not "up sometime this window, down some other day".
  const vrKeywords = ((volumeRisingRaw || []) as VolumeRisingRow[]).map((r) => r.keyword)
  const siteTrendMap = new Map<string, { sites: Set<string>; latestDate: string; hasUpLatest: boolean; hasDownLatest: boolean }>()
  if (vrKeywords.length > 0) {
    const { data: sitesRaw } = await db.from('sites').select('id, domain')
    const siteIdToDomain = new Map<string, string>((sitesRaw || []).map((s: { id: string; domain: string }) => [s.id, s.domain]))
    const rcSince = getMY(-14)
    // 150/batch — CJK keywords in a large .in() list can exceed the ~16KB
    // HTTP header limit and fail silently above that (see
    // project_supabase_in_query_header_overflow memory).
    for (let i = 0; i < vrKeywords.length; i += 150) {
      const { data: rcRows } = await db.from('rank_changes')
        .select('keyword, site_id, type, stat_date')
        .in('keyword', vrKeywords.slice(i, i + 150))
        .gte('stat_date', rcSince)
      for (const row of (rcRows || []) as { keyword: string; site_id: string; type: string; stat_date: string }[]) {
        const domain = siteIdToDomain.get(row.site_id)
        if (!domain) continue
        let entry = siteTrendMap.get(row.keyword)
        if (!entry) { entry = { sites: new Set(), latestDate: '', hasUpLatest: false, hasDownLatest: false }; siteTrendMap.set(row.keyword, entry) }
        entry.sites.add(domain)
        const rowDate = String(row.stat_date).slice(0, 10)
        if (rowDate > entry.latestDate) {
          // Newer date found — this row's direction is all we know so far for it.
          entry.latestDate = rowDate
          entry.hasUpLatest = row.type === 'rankup'
          entry.hasDownLatest = row.type === 'rankdown'
        } else if (rowDate === entry.latestDate) {
          if (row.type === 'rankup') entry.hasUpLatest = true
          else if (row.type === 'rankdown') entry.hasDownLatest = true
        }
        // rowDate < entry.latestDate: older than the current latest, ignored for trend.
      }
    }
  }

  const volumeRisingWords = ((volumeRisingRaw || []) as VolumeRisingRow[]).map((r) => {
    const t = siteTrendMap.get(r.keyword)
    return {
      keyword:     r.keyword,
      volume:      Number(r.volume),
      prevVolume:  r.prev_volume != null ? Number(r.prev_volume) : null,
      change:      Number(r.volume_change),
      last_date:   toDate(r.stat_date),
      sites:       t ? Array.from(t.sites) : [],
      rankTrend:   (!t ? null : t.hasUpLatest && t.hasDownLatest ? 'both' : t.hasUpLatest ? 'up' : t.hasDownLatest ? 'down' : null) as 'up' | 'down' | 'both' | null,
    }
  })

  return NextResponse.json({ newWords, rankWords, streakWords, volumeRisingWords })
}
