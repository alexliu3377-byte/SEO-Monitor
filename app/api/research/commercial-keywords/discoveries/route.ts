import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/supabase-paginate'

async function requireAdmin() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, service }
}

const VALID_STATUSES = ['pending', 'accepted']

// "新词发现"审核列表——rank-title 抓取时顺手记录的"来源词↔已知商业概念组"
// 命中证据（见 scripts/crawl-rank.ts 的 upsertDiscovery）。默认只看待审核的，
// 按"为什么值得看"排序：出现过的站点数多、命中次数多、排名好的排前面。
export async function GET(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'pending'
  const groupName = searchParams.get('groupName')
  const summary = searchParams.get('summary')
  if (!VALID_STATUSES.includes(status)) return NextResponse.json({ error: '无效的状态' }, { status: 400 })

  if (summary === 'groups') {
    const rows = await fetchAllRows<{ group_name: string }>((from, to) => service
      .from('commercial_keyword_discoveries')
      .select('group_name')
      .eq('status', status)
      .order('id', { ascending: true })
      .range(from, to))
    const groups: Record<string, number> = {}
    for (const row of rows) groups[row.group_name] = (groups[row.group_name] ?? 0) + 1
    return NextResponse.json({ groups, total: rows.length })
  }

  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = service
    .from('commercial_keyword_discoveries')
    .select('*', { count: 'exact' })
    .eq('status', status)
    .order('seen_count', { ascending: false })
    .order('best_rank_position', { ascending: true, nullsFirst: false })
    .order('last_seen_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to)
  if (groupName) query = query.eq('group_name', groupName)
  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  const discoveries = (data ?? []) as Record<string, unknown>[]
  if (discoveries.length === 0) {
    return NextResponse.json({ discoveries: [], total: count ?? 0, page, pageSize })
  }

  // Show the actual titles behind "N 个站点" so reviewers can judge whether
  // a candidate is really an alias instead of trusting an opaque count.
  type EvidenceRow = {
    site_id: string; keyword: string; title: string | null; url: string | null
    platform: string; rank_position: number | null; stat_date: string
  }
  const sourceKeywords = [...new Set(discoveries.map(row => String(row.source_keyword ?? '')).filter(Boolean))]
  const since = new Date(Date.now() + 8 * 3600000 - 30 * 86400000).toISOString().slice(0, 10)
  let evidenceRows: EvidenceRow[] = []
  try {
    evidenceRows = await fetchAllRows<EvidenceRow>((evidenceFrom, evidenceTo) => service
      .from('site_keyword_ranks')
      .select('site_id, keyword, title, url, platform, rank_position, stat_date')
      .in('keyword', sourceKeywords)
      .gte('stat_date', since)
      .not('title', 'is', null)
      .order('stat_date', { ascending: false })
      .order('rank_position', { ascending: true, nullsFirst: false })
      .range(evidenceFrom, evidenceTo))
  } catch (evidenceError) {
    console.error('Unable to load commercial keyword discovery evidence:', evidenceError)
  }

  const siteIds = [...new Set(evidenceRows.map(row => row.site_id))]
  const siteMap = new Map<string, { domain: string; name: string }>()
  if (siteIds.length > 0) {
    const { data: sites } = await service.from('sites').select('id, domain, name').in('id', siteIds)
    for (const site of (sites ?? []) as { id: string; domain: string; name: string }[]) {
      siteMap.set(site.id, { domain: site.domain, name: site.name })
    }
  }

  const enriched = discoveries.map(discovery => {
    const sourceKeyword = String(discovery.source_keyword ?? '')
    const matchedAlias = String(discovery.matched_alias ?? '').toLowerCase()
    const seen = new Set<string>()
    const evidence = evidenceRows
      .filter(row => row.keyword === sourceKeyword && row.title?.toLowerCase().includes(matchedAlias))
      .filter(row => {
        const key = `${row.site_id}|${row.platform}|${row.title}|${row.url ?? ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 12)
      .map(row => ({
        domain: siteMap.get(row.site_id)?.domain ?? '未知站点',
        siteName: siteMap.get(row.site_id)?.name ?? '',
        title: row.title,
        url: row.url,
        platform: row.platform,
        rankPosition: row.rank_position,
        statDate: row.stat_date,
      }))
    return { ...discovery, evidence }
  })

  return NextResponse.json({ discoveries: enriched, total: count ?? 0, page, pageSize })
}

export async function PATCH(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { user, service } = ctx

  const { id, action, alias, groupName } = await req.json() as {
    id?: string; action?: 'accept' | 'ignore'; alias?: string; groupName?: string
  }
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  if (action !== 'accept' && action !== 'ignore') return NextResponse.json({ error: '无效的操作' }, { status: 400 })

  if (action === 'ignore') {
    const { data: discovery, error: readError } = await service.from('commercial_keyword_discoveries')
      .select('source_keyword')
      .eq('id', id)
      .maybeSingle()
    if (readError || !discovery?.source_keyword) return NextResponse.json({ error: '找不到这个新词' }, { status: 404 })

    const { error: ignoreError } = await service.from('commercial_keyword_ignored_terms').upsert({
      normalized_keyword: discovery.source_keyword.trim().toLowerCase(),
      ignored_by: user.id,
      ignored_at: new Date().toISOString(),
    }, { onConflict: 'normalized_keyword' })
    if (ignoreError) return NextResponse.json({ error: '忽略名单尚未建立，请先运行最新数据库迁移' }, { status: 503 })

    // Once a term is blacklisted, remove all of its evidence rows. The small
    // blacklist entry is enough to prevent it from being discovered again.
    const { error } = await service.from('commercial_keyword_discoveries')
      .delete()
      .eq('source_keyword', discovery.source_keyword)
    if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // accept：把这个词正式加进商业词清单（归到指定/默认的概念组），再把这条
  // 发现标记成已处理。词已存在（比如用户自己也手动加过）就忽略冲突，不报错。
  if (!alias || !alias.trim()) return NextResponse.json({ error: '缺少要加入的别名' }, { status: 400 })
  if (!groupName || !groupName.trim()) return NextResponse.json({ error: '缺少所属概念组' }, { status: 400 })

  const normalizedAlias = alias.trim()
  const normalizedGroupName = groupName.trim()
  const { data: existingKeyword, error: existingError } = await service
    .from('commercial_keywords')
    .select('group_name')
    .ilike('keyword', normalizedAlias)
    .limit(1)
    .maybeSingle()
  if (existingError) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  if (existingKeyword && existingKeyword.group_name !== normalizedGroupName) {
    return NextResponse.json({
      error: `这个词已经属于「${existingKeyword.group_name}」，请先确认后再调整`,
    }, { status: 409 })
  }

  if (!existingKeyword) {
    const { error: insertError } = await service
      .from('commercial_keywords')
      .insert({ keyword: normalizedAlias, group_name: normalizedGroupName, added_by: user.id })
    if (insertError) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const { error } = await service.from('commercial_keyword_discoveries')
    .update({ status: 'accepted', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
