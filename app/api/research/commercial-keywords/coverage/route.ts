export const maxDuration = 180

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchBaiduSuggestionsUnfiltered } from '@/lib/crawler'
import { fetchOwnSiteDomains } from '@/lib/tracking-summary'

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

interface RankRow {
  site_id: string; keyword: string; rank_position: number | null
  title: string | null; url: string | null; platform: string; stat_date: string
}
interface CoverageRow {
  keyword: string; isExpansion: boolean; seedKeyword: string
  domain: string; siteName: string; isOwnSite: boolean
  rankPosition: number | null; title: string | null; url: string | null
  platform: string; statDate: string
}

// 研究中心"商业词"tab 的核心接口——种子词逐个挖下拉词，再把"种子词+全部
// 下拉词"拿去查现有排名数据里谁拿到了。同步一次性返回，不落库（每次现查，
// 保证新鲜度，避免另建缓存表）。2026-08-28 新增。
export async function POST(req: Request) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: seedRows } = await service.from('commercial_keywords').select('keyword').order('created_at', { ascending: true })
  const seeds = ((seedRows ?? []) as { keyword: string }[]).map(r => r.keyword)
  if (seeds.length === 0) return NextResponse.json({ error: '清单是空的，先贴几个商业词' }, { status: 400 })

  // 1. 逐个种子词挖下拉词——种子词之间间隔200ms，避免短时间集中打百度建议接口
  const seedResults: { seed: string; expansions: string[] }[] = []
  const allKeywordsSet = new Set<string>()
  for (const seed of seeds) {
    allKeywordsSet.add(seed)
    const expansions = await fetchBaiduSuggestionsUnfiltered(seed)
    const filtered = expansions.filter(e => e !== seed)
    for (const e of filtered) allKeywordsSet.add(e)
    seedResults.push({ seed, expansions: filtered })
    await delay(200)
  }
  const allKeywords = Array.from(allKeywordsSet)

  // 每个关键词属于哪个种子词（下拉词优先记它是谁挖出来的；种子词自己记自己）
  const keywordToSeed = new Map<string, string>()
  for (const seed of seeds) keywordToSeed.set(seed, seed)
  for (const { seed, expansions } of seedResults) {
    for (const e of expansions) if (!keywordToSeed.has(e)) keywordToSeed.set(e, seed)
  }

  // 2. 关键词全集去重后，分批查 site_keyword_ranks（只有"排名"模式站点有
  // rank_position/title，"涨跌"模式站点没有这些细节，本来就查不到）
  const since = new Date(Date.now() + 8 * 3600000 - 7 * 86400000).toISOString().slice(0, 10)
  const rankRows: RankRow[] = []
  for (const chunk of chunkArray(allKeywords, 150)) {
    const { data, error } = await service
      .from('site_keyword_ranks')
      .select('site_id, keyword, rank_position, title, url, platform, stat_date')
      .in('keyword', chunk)
      .gte('stat_date', since)
      .order('stat_date', { ascending: false })
    if (error) console.error('商业词覆盖查询 site_keyword_ranks 失败:', error.message)
    if (data) rankRows.push(...(data as RankRow[]))
  }

  // 每个 (site_id, keyword, platform) 组合取最新一条（rankRows 已按 stat_date desc 排好）
  const latestByKey = new Map<string, RankRow>()
  for (const r of rankRows) {
    const key = `${r.site_id}|${r.keyword}|${r.platform}`
    if (!latestByKey.has(key)) latestByKey.set(key, r)
  }

  // 3. 关联站点信息 + own/reference 标记
  const siteIds = Array.from(new Set(Array.from(latestByKey.values()).map(r => r.site_id)))
  const siteMap = new Map<string, { domain: string; name: string }>()
  if (siteIds.length > 0) {
    const { data: sites } = await service.from('sites').select('id, domain, name').in('id', siteIds)
    for (const s of (sites ?? []) as { id: string; domain: string; name: string }[]) siteMap.set(s.id, { domain: s.domain, name: s.name })
  }
  const ownDomains = await fetchOwnSiteDomains(service)

  const coverage: CoverageRow[] = Array.from(latestByKey.values()).map(r => {
    const site = siteMap.get(r.site_id)
    return {
      keyword: r.keyword,
      isExpansion: !seeds.includes(r.keyword),
      seedKeyword: keywordToSeed.get(r.keyword) ?? r.keyword,
      domain: site?.domain ?? '(未知站点)',
      siteName: site?.name ?? '',
      isOwnSite: site ? ownDomains.has(site.domain) : false,
      rankPosition: r.rank_position,
      title: r.title,
      url: r.url,
      platform: r.platform,
      statDate: r.stat_date,
    }
  }).sort((a, b) => {
    if (a.rankPosition == null && b.rankPosition == null) return 0
    if (a.rankPosition == null) return 1
    if (b.rankPosition == null) return -1
    return a.rankPosition - b.rankPosition
  })

  const matchedKeywords = new Set(coverage.map(c => c.keyword))
  const noDataKeywords = allKeywords.filter(k => !matchedKeywords.has(k))

  return NextResponse.json({ seedResults, coverage, noDataKeywords, totalKeywordsChecked: allKeywords.length })
}
