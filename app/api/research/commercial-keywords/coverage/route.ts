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
interface GroupResult {
  groupName: string; members: string[]; expansions: string[]
}
interface CoverageRow {
  keyword: string; isExpansion: boolean; groupName: string
  domain: string; siteName: string; isOwnSite: boolean
  rankPosition: number | null; title: string | null; url: string | null
  platform: string; statDate: string
}

// 研究中心"商业词"tab 的核心接口——每个概念分组下的每个别名都逐个挖下拉词，
// 再把"全部别名+全部下拉词"拿去查现有排名数据里谁拿到了。同步一次性返回，
// 不落库（每次现查，保证新鲜度，避免另建缓存表）。2026-08-28 新增，2026-08-28
// 当天补了"同一概念多个别名"分组支持（见 ../route.ts 顶部注释）。
export async function POST(req: Request) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 词组详情页只查当前这一个组的覆盖（比查全部快很多），不传 groupName 时
  // 保留原来的全量模式（代码留着，前端目前只会走带 groupName 的路径）。
  const { groupName: scopeGroup } = await req.json().catch(() => ({})) as { groupName?: string }

  let seedQuery = service.from('commercial_keywords').select('keyword, group_name').order('created_at', { ascending: true })
  if (scopeGroup && scopeGroup.trim()) seedQuery = seedQuery.eq('group_name', scopeGroup.trim())
  const { data: seedRows } = await seedQuery
  const allSeeds = ((seedRows ?? []) as { keyword: string; group_name: string | null }[])
  if (allSeeds.length === 0) return NextResponse.json({ error: scopeGroup ? '这个组没有别名' : '清单是空的，先贴几个商业词' }, { status: 400 })

  // 按 group_name 归拢（没有 group_name 的老数据兜底成自己是自己的组）
  const groupToMembers = new Map<string, string[]>()
  for (const s of allSeeds) {
    const g = s.group_name || s.keyword
    if (!groupToMembers.has(g)) groupToMembers.set(g, [])
    groupToMembers.get(g)!.push(s.keyword)
  }
  const allMemberKeywords = allSeeds.map(s => s.keyword)

  // 1. 每个别名都单独挖一次下拉词——组内不同别名搜索习惯可能不一样，各自的
  // 下拉词都有价值；别名之间间隔200ms，避免短时间集中打百度建议接口
  const keywordToGroup = new Map<string, string>()
  for (const [group, members] of Array.from(groupToMembers.entries())) {
    for (const m of members) keywordToGroup.set(m, group)
  }

  const groupResults: GroupResult[] = []
  const allKeywordsSet = new Set<string>(allMemberKeywords)
  for (const [group, members] of Array.from(groupToMembers.entries())) {
    const expansionsSet = new Set<string>()
    for (const member of members) {
      const expansions = await fetchBaiduSuggestionsUnfiltered(member)
      for (const e of expansions) {
        if (!allMemberKeywords.includes(e)) expansionsSet.add(e)
      }
      await delay(200)
    }
    for (const e of Array.from(expansionsSet)) {
      allKeywordsSet.add(e)
      if (!keywordToGroup.has(e)) keywordToGroup.set(e, group)
    }
    groupResults.push({ groupName: group, members, expansions: Array.from(expansionsSet) })
  }
  const allKeywords = Array.from(allKeywordsSet)

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
      isExpansion: !allMemberKeywords.includes(r.keyword),
      groupName: keywordToGroup.get(r.keyword) ?? r.keyword,
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

  return NextResponse.json({ groupResults, coverage, noDataKeywords, totalKeywordsChecked: allKeywords.length })
}
