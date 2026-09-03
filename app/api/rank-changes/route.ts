import { NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/get-user-profile'
import { fetchRankChanges } from '@/lib/crawler'

// On-demand endpoint (used for manual refresh or backfill)
export async function GET(req: Request) {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const domain = searchParams.get('domain') || ''
  const date = searchParams.get('date') || ''
  const type = searchParams.get('type') || 'rankup'

  if (domain && !/^[a-z0-9.-]{1,253}$/i.test(domain)) return NextResponse.json({ error: 'invalid domain' }, { status: 400 })
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'invalid date' }, { status: 400 })

  if (!domain || !date) {
    return NextResponse.json({ error: 'missing params' }, { status: 400 })
  }
  if (type !== 'rankup' && type !== 'rankdown') {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }

  const entries = await fetchRankChanges(domain, date, type as 'rankup' | 'rankdown')
  return NextResponse.json(entries.sort((a, b) => b.volume - a.volume))
}
