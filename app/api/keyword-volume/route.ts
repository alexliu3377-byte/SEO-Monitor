import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { activityStart, activityEnd } from '@/lib/activity-log'

async function log(supabase: ReturnType<typeof createServiceClient>, step: string, ok: number, summary: string, t0: number) {
  const aid = await activityStart(supabase, { type: 'search', source: 'browser', step })
  if (aid) await activityEnd(supabase, aid, { status: 'done', ok, summary, durationMs: Date.now() - t0 })
}

export async function GET(req: Request) {
  const authCheck = createClient()
  const { data: { user } } = await authCheck.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() || ''
  const exportParam = searchParams.get('export')
  const exportAll = exportParam === '1'
  const exportToday = exportParam === 'today'
  const t0 = Date.now()

  const supabase = createServiceClient()

  if (exportToday) {
    // Malaysia UTC+8: today starts at (todayMY 00:00 +08:00) in UTC
    const nowMs = Date.now() + 8 * 60 * 60 * 1000
    const todayMY = new Date(nowMs).toISOString().slice(0, 10)
    const todayStartUTC = new Date(todayMY + 'T00:00:00+08:00').toISOString()

    const { data: rawData, error: rawErr } = await supabase
      .from('raw_keywords')
      .select('keyword')
      .gte('discovered_at', todayStartUTC)
    if (rawErr) return NextResponse.json({ error: rawErr.message }, { status: 500 })

    const keywords = Array.from(new Set((rawData || []).map((r: { keyword: string }) => r.keyword)))
    if (keywords.length === 0) return NextResponse.json({ keywords: [] })

    const { data: volData } = await supabase
      .from('keyword_volume')
      .select('keyword, volume, latest_trend')
      .in('keyword', keywords)

    const volMap = new Map((volData || []).map((r: { keyword: string; volume: number; latest_trend: string | null }) => [r.keyword, r]))
    const result = keywords
      .map(kw => {
        const row = volMap.get(kw)
        return { keyword: kw, volume: row?.volume ?? 0, latest_trend: row?.latest_trend ?? null }
      })
      .sort((a, b) => b.volume - a.volume)

    await log(supabase, 'kw-export-today', result.length, `今日新词导出 ${result.length} 个`, t0)
    return NextResponse.json({ keywords: result })
  }

  if (exportAll) {
    const batchSize = 2000
    let offset = 0
    const allRows: { keyword: string; volume: number }[] = []
    while (true) {
      const { data, error } = await supabase
        .from('keyword_volume')
        .select('keyword, volume, latest_trend')
        .order('volume', { ascending: false })
        .order('keyword', { ascending: true })
        .range(offset, offset + batchSize - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data || data.length === 0) break
      allRows.push(...data)
      if (data.length < batchSize) break
      offset += batchSize
    }
    await log(supabase, 'kw-export-all', allRows.length, `全量导出 ${allRows.length} 个词`, t0)
    return NextResponse.json({ keywords: allRows })
  }

  const PAGE_SIZE = 50
  const pg = Math.max(0, parseInt(searchParams.get('page') || '0', 10))
  const offset = pg * PAGE_SIZE

  let countQuery = supabase.from('keyword_volume').select('*', { count: 'exact', head: true })
  if (q) countQuery = countQuery.ilike('keyword', `%${q}%`)

  let dataQuery = supabase
    .from('keyword_volume')
    .select('keyword, volume, latest_trend, volume_change')
    .order('volume', { ascending: false })
    .order('keyword', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)
  if (q) dataQuery = dataQuery.ilike('keyword', `%${q}%`)

  const [{ count }, { data, error }] = await Promise.all([countQuery, dataQuery])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = data || []
  const total = count ?? 0
  if (q && pg === 0) await log(supabase, 'kw-search', total, `搜索「${q}」→ ${total} 个词`, t0)
  return NextResponse.json({ keywords: results, total })
}
