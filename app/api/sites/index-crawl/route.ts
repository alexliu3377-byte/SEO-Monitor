export const maxDuration = 300

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchBaiduIndexPages } from '@/lib/crawler'

function getMYDate(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

// POST /api/sites/index-crawl  { domain: string }
// Crawls Baidu site: for given domain, upserts into site_indexed_pages for the matching site.
// Does NOT mark disappeared pages (manual crawl is supplemental, not authoritative).
export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'normal'
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const rawDomain = (body.domain || '').trim()
  const rawBaiduUrl = (body.baiduUrl || '').trim()
  const baiduCookie = (body.cookie || '').trim()
  if (!rawDomain && !rawBaiduUrl) return NextResponse.json({ error: '请输入域名或百度链接' }, { status: 400 })

  let domain: string
  let customBaseUrl: string | undefined

  if (rawBaiduUrl) {
    // Parse domain and strip pn from the Baidu URL (pn is handled by pagination)
    try {
      const url = new URL(rawBaiduUrl)
      const wd = url.searchParams.get('wd') || ''
      const siteMatch = wd.match(/site:([^/\s]+)/i)
      if (!siteMatch) return NextResponse.json({ error: '无法从链接解析域名（wd 参数需包含 site:domain）' }, { status: 400 })
      domain = siteMatch[1]
      // Keep semantically meaningful params; strip browser session noise (rsv_*, oq, etc.)
      // Preserve ct/si/fenlei as they activate Baidu's site-search mode for more complete results.
      const cleanUrl = new URL('https://www.baidu.com/s')
      cleanUrl.searchParams.set('wd', wd)
      const gpc = url.searchParams.get('gpc')
      if (gpc) cleanUrl.searchParams.set('gpc', gpc)
      if (url.searchParams.get('ct')) cleanUrl.searchParams.set('ct', url.searchParams.get('ct')!)
      if (url.searchParams.get('si')) cleanUrl.searchParams.set('si', url.searchParams.get('si')!)
      if (url.searchParams.get('fenlei')) cleanUrl.searchParams.set('fenlei', url.searchParams.get('fenlei')!)
      if (url.searchParams.get('ie')) cleanUrl.searchParams.set('ie', url.searchParams.get('ie')!)
      if (url.searchParams.get('tfflag')) cleanUrl.searchParams.set('tfflag', '1')
      customBaseUrl = cleanUrl.toString()
    } catch {
      return NextResponse.json({ error: '链接格式不正确' }, { status: 400 })
    }
  } else {
    // Plain domain input
    domain = rawDomain.replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/\/$/, '')
    if (!domain) return NextResponse.json({ error: '域名格式不正确' }, { status: 400 })
  }

  // Find matching site: exact match first, then suffix match (e.g. "sjwyx.com" matches "m.sjwyx.com")
  const { data: exactSites } = await service.from('sites').select('id, domain').eq('domain', domain).limit(1)
  const exactSite = (exactSites || [])[0]
  const site = exactSite ?? await (async () => {
    const { data: fuzzy } = await service.from('sites').select('id, domain').ilike('domain', `%${domain}%`).limit(5)
    return (fuzzy || []).find((s: { domain: string }) => s.domain.endsWith(domain) || domain.endsWith(s.domain))
  })()
  if (!site) return NextResponse.json({ error: `未找到域名 "${domain}" 对应的站点，请先在站点管理中添加` }, { status: 404 })

  const today = getMYDate()

  let totalFound = 0
  let totalNew = 0

  async function saveBatch(batch: import('@/lib/crawler').BaiduIndexedPage[]) {
    for (const chunk of chunkArray(batch, 500)) {
      const rows = chunk.map(p => ({
        site_id: site.id,
        url: p.url,
        title: p.title,
        snippet: p.snippet,
        baidu_date_str: p.baiduDateStr,
        first_seen_date: today,
        last_seen_date: today,
        disappeared_date: null,
        updated_at: new Date().toISOString(),
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (service.from('site_indexed_pages') as any).upsert(rows, {
        onConflict: 'site_id,url',
        ignoreDuplicates: false,
      }).select('first_seen_date')
      const inserted = ((res.data || []) as { first_seen_date: string }[])
      totalFound += chunk.length
      totalNew += inserted.filter(r => r.first_seen_date === today).length
    }
  }

  const { pages, failReason } = await fetchBaiduIndexPages(domain, saveBatch, baiduCookie || undefined, customBaseUrl)

  if (failReason === 'captcha' || failReason === 'http_error') {
    if (totalFound > 0) {
      // Partial results already saved — return what we got instead of error
      return NextResponse.json({ found: totalFound, newCount: totalNew, domain: site.domain, truncated: true })
    }
    return NextResponse.json({ error: '百度返回安全验证或HTTP错误，抓取被拦截', failReason }, { status: 502 })
  }

  if (totalFound === 0 && pages.length === 0) {
    return NextResponse.json({ found: 0, newCount: 0, domain, failReason: failReason ?? 'empty_results' })
  }

  // no_content means Baidu stopped returning results mid-crawl
  const truncated = failReason === 'no_content'

  return NextResponse.json({ found: totalFound, newCount: totalNew, domain: site.domain, truncated })
}
