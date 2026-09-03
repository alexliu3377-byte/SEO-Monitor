import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const BASE = 'https://www.taptap.cn'
const UA = 'V%3D1%26PN%3DWebApp%26LANG%3Dzh_CN%26VN_CODE%3D102%26LOC%3DCN%26PLT%3DPC%26DS%3DAndroid'
const HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

function todayDayTs(): number {
  const now = new Date()
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000)
}

function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
}

function fmtTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const h = d.getUTCHours() + 8
  return `${String(h % 24).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseItem(x: any, dateLabel?: string) {
  const a = x.app_card_info ?? {}
  return {
    title: a.title ?? '',
    tag: x.sub_event_type_title ?? '',
    startDate: dateLabel ?? fmtDate(x.start_time),
    startTime: fmtTime(x.start_time),
    labels: (a.title_labels ?? []) as string[],
  }
}

async function fetchDay(offset: number): Promise<ReturnType<typeof parseItem>[]> {
  try {
    const ts = todayDayTs() + offset * 86400
    const label = fmtDate(ts)
    const res = await fetch(`${BASE}/webapiv2/calendar/v1/event-list?X-UA=${UA}&day=${ts}`, {
      headers: HEADERS,
      next: { revalidate: 3600 },
    })
    const json = await res.json()
    const data = json?.data ?? {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [...(data.list_a ?? []), ...(data.list_b ?? []), ...(data.list_c ?? [])].map((x: any) =>
      parseItem(x, label)
    )
  } catch {
    return []
  }
}

async function fetchTodayGames() {
  try {
    const ts = todayDayTs()
    const res = await fetch(`${BASE}/webapiv2/calendar/v1/event-list?X-UA=${UA}&day=${ts}`, {
      headers: HEADERS,
      next: { revalidate: 3600 },
    })
    const json = await res.json()
    const data = json?.data ?? {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [...(data.list_a ?? []), ...(data.list_b ?? []), ...(data.list_c ?? [])].map((x: any) =>
      parseItem(x)
    )
  } catch {
    return []
  }
}

async function fetchTopEvents() {
  try {
    const res = await fetch(`${BASE}/webapiv2/calendar/v1/top-events?X-UA=${UA}`, {
      headers: HEADERS,
      next: { revalidate: 3600 },
    })
    const json = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((json?.data?.list ?? []) as any[]).map((x) => parseItem(x))
  } catch {
    return []
  }
}

async function fetchUpcoming30Days(): Promise<ReturnType<typeof parseItem>[]> {
  // Fetch days 1–30 in batches of 5 to avoid overwhelming the server
  const results: ReturnType<typeof parseItem>[] = []
  for (let batch = 0; batch < 6; batch++) {
    const offsets = [1, 2, 3, 4, 5].map((i) => batch * 5 + i)
    const batchResults = await Promise.all(offsets.map((o) => fetchDay(o)))
    for (const r of batchResults) results.push(...r)
  }
  return results.filter((g) => g.title)
}

export async function GET() {
  // 跟 monthly-trend 同一个门槛——登录即可查，不限 super/admin。之前这里
  // 完全没做校验，无鉴权无限流地代理抓取第三方站点。
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [todayGames, upcomingGames, topEvents] = await Promise.all([
    fetchTodayGames(),
    fetchUpcoming30Days(),
    fetchTopEvents(),
  ])
  return NextResponse.json({ todayGames, upcomingGames, topEvents })
}
