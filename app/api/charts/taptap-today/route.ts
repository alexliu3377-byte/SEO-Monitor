import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { unstable_cache } from 'next/cache'

const BASE = 'https://www.taptap.cn'
export const maxDuration = 90
const UA = 'V%3D1%26PN%3DWebApp%26LANG%3Dzh_CN%26VN_CODE%3D102%26LOC%3DCN%26PLT%3DPC%26DS%3DAndroid'
const HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

function todayDayTs(): number {
  const now = new Date(Date.now() + 8 * 3600_000)
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

const readDay = unstable_cache(async (ts: number) => {
    const label = fmtDate(ts)
    const res = await fetch(`${BASE}/webapiv2/calendar/v1/event-list?X-UA=${UA}&day=${ts}`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error('TapTap calendar failed')
    const json = await res.json()
    const data = json?.data
    if (!data || !['list_a','list_b','list_c'].some(key => Array.isArray(data[key]))) throw new Error('Invalid TapTap calendar response')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = [...(data.list_a ?? []), ...(data.list_b ?? []), ...(data.list_c ?? [])].map((x: any) =>
      parseItem(x, label)
    )
    return { items,updatedAt: new Date().toISOString() }
}, ['taptap-calendar-day-success-v3'], { revalidate: 3600 })

const readTopEvents = unstable_cache(async () => {
    const res = await fetch(`${BASE}/webapiv2/calendar/v1/top-events?X-UA=${UA}`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error('TapTap calendar failed')
    const json = await res.json()
    if (!Array.isArray(json?.data?.list)) throw new Error('Invalid TapTap events response')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { items: (json.data.list as any[]).map(x => parseItem(x)),updatedAt: new Date().toISOString() }
}, ['taptap-calendar-events-success-v3'], { revalidate: 3600 })

async function fetchUpcoming30Days(day: number) {
  // Fetch days 1–30 in batches of 5 to avoid overwhelming the server
  const results: ReturnType<typeof parseItem>[] = []
  const timestamps: string[] = []
  let failedDays = 0
  for (let batch = 0; batch < 6; batch++) {
    const offsets = [1, 2, 3, 4, 5].map((i) => batch * 5 + i)
    const batchResults = await Promise.allSettled(offsets.map(offset => readDay(day + offset * 86400)))
    for (const r of batchResults) {
      if (r.status === 'fulfilled') { results.push(...r.value.items);timestamps.push(r.value.updatedAt) }
      else failedDays++
    }
  }
  return { items: results.filter(g => g.title),updatedAt: timestamps.sort()[0] ?? null,failedDays }
}

async function readCalendar(day: number) {
  const [today,upcoming,top] = await Promise.allSettled([
    readDay(day),fetchUpcoming30Days(day),readTopEvents(),
  ])
  const timestamps = [today,upcoming,top].flatMap(result => result.status === 'fulfilled' && result.value.updatedAt ? [result.value.updatedAt] : [])
  const failed = today.status === 'rejected' || top.status === 'rejected' || upcoming.status === 'rejected' || upcoming.value.failedDays > 0
  return {
    todayGames: today.status === 'fulfilled' ? today.value.items : [],
    upcomingGames: upcoming.status === 'fulfilled' ? upcoming.value.items : [],
    topEvents: top.status === 'fulfilled' ? top.value.items : [],
    updatedAt: timestamps.sort()[0] ?? null,failed,
    ...(failed ? { error: '部分 TapTap 日历资料暂未取得，已取得的资料仍可查看' } : {}),
  }
}

export async function GET() {
  // 跟 monthly-trend 同一个门槛——登录即可查，不限 super/admin。之前这里
  // 完全没做校验，无鉴权无限流地代理抓取第三方站点。
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(await readCalendar(todayDayTs()))
}
