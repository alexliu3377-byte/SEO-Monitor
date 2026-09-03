import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

interface KwRow { keyword: string; content_date: string }

function dayDiff(a: string, b: string) {
  return (new Date(a).getTime() - new Date(b).getTime()) / 86400000
}

// Find topic clusters: groups of keywords sharing the same root prefix,
// added within 7 days of each other. Root must be ≥2 chars.
function buildClusters(rows: KwRow[]) {
  const kwDates = new Map<string, string[]>()
  for (const r of rows) {
    if (!kwDates.has(r.keyword)) kwDates.set(r.keyword, [])
    const dates = kwDates.get(r.keyword)!
    if (!dates.includes(r.content_date)) dates.push(r.content_date)
  }

  const sorted = Array.from(kwDates.keys()).sort((a, b) => a.length - b.length)
  const used: string[] = []

  const clusters: { root: string; keywords: string[]; dates: string[]; date_range: string }[] = []

  for (const root of sorted) {
    if (used.includes(root) || root.length < 2) continue
    const rootDates = kwDates.get(root)!
    const members = [root]
    const allDates = rootDates.slice()

    for (const kw of sorted) {
      if (kw === root || used.includes(kw)) continue
      if (!kw.startsWith(root)) continue
      const kwDs = kwDates.get(kw)!
      const close = kwDs.some(d => rootDates.some(rd => Math.abs(dayDiff(d, rd)) <= 7))
      if (close) { members.push(kw); allDates.push(...kwDs) }
    }

    if (members.length >= 2) {
      for (const k of members) if (!used.includes(k)) used.push(k)
      const seen: string[] = []
      for (const d of allDates) if (!seen.includes(d)) seen.push(d)
      const uniq = seen.sort()
      clusters.push({
        root,
        keywords: members,
        dates: uniq,
        date_range: uniq.length > 0
          ? uniq[0] === uniq[uniq.length - 1] ? uniq[0] : `${uniq[0]} ~ ${uniq[uniq.length - 1]}`
          : '',
      })
    }
  }

  return clusters
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if ((profile?.role ?? 'normal') === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // 项目里"近N天"统一按MYT（UTC+8）换算，避免边界附近少算/多算一天。
  const since = new Date(Date.now() + 8 * 3600000 - 30 * 86400000).toISOString().slice(0, 10)

  const { data: rows, error } = await service
    .from('raw_keywords')
    .select('keyword, content_date')
    .eq('site_id', id)
    .gte('content_date', since)
    .order('content_date', { ascending: true })

  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  const allRows: KwRow[] = rows ?? []

  // Method 1: exact duplicates (same keyword, multiple dates)
  const kwDateMap = new Map<string, string[]>()
  for (const r of allRows) {
    if (!kwDateMap.has(r.keyword)) kwDateMap.set(r.keyword, [])
    const ds = kwDateMap.get(r.keyword)!
    if (!ds.includes(r.content_date)) ds.push(r.content_date)
  }
  const exactDuplicates = Array.from(kwDateMap.entries())
    .filter(([, dates]) => dates.length > 1)
    .map(([keyword, dates]) => ({ keyword, dates: dates.sort(), occurrences: dates.length }))
    .sort((a, b) => b.occurrences - a.occurrences)

  // Method 2: topic clusters (prefix-based)
  const topicClusters = buildClusters(allRows)

  return NextResponse.json({ exactDuplicates, topicClusters })
}
