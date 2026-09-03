import { NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/get-user-profile'
import { fetchRankupWithTitle } from '@/lib/crawler'

export const maxDuration = 120

export async function GET(request: Request) {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile.role !== 'super') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const domain = searchParams.get('domain')
  const date = searchParams.get('date')

  if (domain && !/^[a-z0-9.-]{1,253}$/i.test(domain)) return NextResponse.json({ error: 'invalid domain' }, { status: 400 })
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'invalid date' }, { status: 400 })

  if (!domain || !date) {
    return NextResponse.json({ error: 'missing domain or date' }, { status: 400 })
  }

  const items = await fetchRankupWithTitle(domain, date)
  return NextResponse.json({ items })
}
