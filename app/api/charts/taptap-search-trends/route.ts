import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { parseTapTapSearchTrends } from '@/lib/taptap-search-trends'

const ONE_DAY = 86_400
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function dailyNumericSearch(): string {
  const day = Math.floor(Date.now() / 86_400_000)
  const mixed = Math.imul(day, 2_654_435_761) >>> 0
  return String((mixed % 999_999) + 1)
}

const readDailyTapTapSearch = unstable_cache(async () => {
  try {
    const response = await fetch(`https://www.taptap.cn/search/${dailyNumericSearch()}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': UA,
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { items: [], unavailable: true }
    const items = parseTapTapSearchTrends(await response.text())
    return { items, unavailable: items.length === 0 }
  } catch {
    // Empty failures are cached too, preventing repeated retries during an outage.
    return { items: [], unavailable: true }
  }
}, ['taptap-search-trends-daily-v1'], { revalidate: ONE_DAY })

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await readDailyTapTapSearch())
}
