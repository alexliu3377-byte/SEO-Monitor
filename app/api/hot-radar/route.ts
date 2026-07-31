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

  const volumeRisingWords = ((volumeRisingRaw || []) as VolumeRisingRow[]).map((r) => ({
    keyword:     r.keyword,
    volume:      Number(r.volume),
    prevVolume:  r.prev_volume != null ? Number(r.prev_volume) : null,
    change:      Number(r.volume_change),
    last_date:   toDate(r.stat_date),
  }))

  return NextResponse.json({ newWords, rankWords, streakWords, volumeRisingWords })
}
