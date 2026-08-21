export const maxDuration = 300

import { NextResponse } from 'next/server'

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

// Strip a leading www./m. host label and a trailing slash so tracking can match
// a claimed page_url against site_indexed_pages/site_keyword_ranks URLs even
// when the subdomain/protocol/trailing-slash format differs. Mirrors
// scripts/crawl.ts's bareUrl()/urlSubdomainVariants() — see that file for the
// full rationale (2026-07-29).
function bareUrl(url: string): string {
  return url.replace(/^(https?:\/\/)?(www\.|m\.)?/i, '').replace(/\/$/, '')
}
function urlSubdomainVariants(url: string): string[] {
  const bare = bareUrl(url)
  const hosts = [bare, `www.${bare}`, `m.${bare}`]
  const variants = new Set<string>()
  for (const host of hosts) {
    for (const proto of ['', 'http://', 'https://']) {
      variants.add(`${proto}${host}`)
      variants.add(`${proto}${host}/`)
    }
  }
  return Array.from(variants)
}
import { createServiceClient } from '@/lib/supabase-server'
import {
  fetchHtmlListPages,
  cleanTitle,
  fetchAizhanData,
  fetchRankChanges,
  fetchRankupWithTitle,
  fetchRankdownWithTitle,
  fetchBaiduIndexPages,
  type HtmlSource,
} from '@/lib/crawler'
import { activityStart, activityEnd, siteLog } from '@/lib/activity-log'
import { upsertKeywordVolumeWithChange } from '@/lib/keyword-volume'

interface SiteRecord {
  id: string
  domain: string
  crawl_type: 'html'
  crawl_frequency: 'daily'
  list_url: string | null
  title_selector: string | null
  date_selector: string | null
  source_types: string | null
  url_selectors: string | null
  enable_version_clean: boolean
  version_suffixes: string[]
}

// Malaysia time helpers (UTC+8)
function getMalaysiaDate(offsetDays = 0): string {
  const ms = Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

function parseContentDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  const m = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const m2 = dateStr.match(/^(\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (m2) return `20${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  } catch { /* ignore */ }
  return null
}


export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // All dates use Malaysia time (UTC+8)
  const today = getMalaysiaDate()       // today's snapshot date (for weight/index)
  const yesterday = getMalaysiaDate(-1) // yesterday's content date (for new keywords)

  const results: { site: string; count: number; error?: string }[] = []

  const { searchParams } = new URL(request.url)
  const siteFilter = searchParams.get('site')
  const step = searchParams.get('step') // 'keywords' | 'rank' | 'weight' | 'index-pages' | null (all)
  const runKeywords    = !step || step === 'keywords'
  const runRank        = !step || step === 'rank'
  const runWeight      = !step || step === 'weight'
  const runIndexPages  = step === 'index-pages'
  const runRankTitle   = step === 'rank-title'
  const runTracking    = step === 'tracking'
  const isSingleSite = !!siteFilter
  const logType = isSingleSite ? 'cron_manual' as const : 'cron_task' as const

  try {
    let query = supabase.from('sites').select('*')
    if (!runIndexPages) query = query.eq('is_enabled', true) // index-pages uses has_index_pages flag instead
    if (siteFilter) query = query.eq('domain', siteFilter)
    const { data: sitesRaw, error: sitesErr } = await query
    if (sitesErr) throw sitesErr
    const sites = (sitesRaw || []) as SiteRecord[]

    // ── Keywords ────────────────────────────────────────────────────────────────
    if (runKeywords) {
      let kwOk = 0, kwEmpty = 0, kwFail = 0, kwRows = 0
      const kwStart = Date.now()
      const kwAid = await activityStart(supabase, { type: logType, source: 'vercel', step: 'keywords', domain: siteFilter ?? undefined })

      for (const site of sites) {
        try {
          type RawEntry = { title: string; content_date: string | null; content_type?: string; source_url: string | null }
          let rawEntries: RawEntry[] = []
          const hasCrawlConfig = !!(site.list_url && site.title_selector)

          if (hasCrawlConfig) {
            const htmlCutoff = getMalaysiaDate(-1)
            const maxPg = 3
            const SRC_SEP = '|||'
            const listUrl = site.list_url!
            const isNew = listUrl.includes(SRC_SEP)
            const urlBlocks = isNew ? listUrl.split(SRC_SEP) : listUrl.split('\n').map((u: string) => u.trim()).filter(Boolean)
            const titleSels = (site.title_selector || '').split(isNew ? SRC_SEP : '\n').map((s: string) => s.trim())
            const dateSels = (site.date_selector || '').split(isNew ? SRC_SEP : '\n').map((s: string) => s.trim())
            const sourceTypesList = (site.source_types || '').split(isNew ? SRC_SEP : '\n').map((s: string) => s.trim())
            const urlSelsList = (site.url_selectors || '').split(SRC_SEP).map((s: string) => s.trim())
            // Process each source separately to track content_type
            for (let i = 0; i < urlBlocks.length; i++) {
              const srcType = sourceTypesList[i] === 'game' ? 'game' : 'app'
              const srcUrlSel = urlSelsList[i] ?? urlSelsList[0] ?? ''
              const srcUrls = isNew
                ? urlBlocks[i].split('\n').map((u: string) => u.trim()).filter(Boolean)
                : [urlBlocks[i]]
              for (let urlIdx = 0; urlIdx < srcUrls.length; urlIdx++) {
                const src: HtmlSource = {
                  url: srcUrls[urlIdx],
                  titleSelector: titleSels[i] || titleSels[0] || '',
                  dateSelector: dateSels[i] || dateSels[0] || '',
                  urlSelector: srcUrlSel || undefined,
                }
                const srcEntries = await fetchHtmlListPages([src], htmlCutoff, maxPg, isSingleSite)
                for (const e of srcEntries) {
                  rawEntries.push({ title: e.title, content_date: parseContentDate(e.date), content_type: srcType, source_url: srcUrlSel ? (e.url || null) : null })
                }
              }
            }
          }

          // Dedup within this crawl batch by keyword (first source wins, preserves content_type)
          const seenInBatch = new Set<string>()
          const cleanedEntries = rawEntries
            .map((e) => ({
              keyword: cleanTitle(e.title, site.enable_version_clean),
              content_date: e.content_date,
              content_type: e.content_type || 'app',
              source_url: e.source_url,
            }))
            .filter((e) => {
              if (e.keyword.length === 0 || seenInBatch.has(e.keyword)) return false
              seenInBatch.add(e.keyword)
              return true
            })

          // 日期解析失败仍按 yesterday 填充写库（避免影响下游按 content_date 分组的功能），
          // 但统计出来放进 activity_site_log 的 detail，方便定位选择器坏了的站点
          const nullDateCount = cleanedEntries.filter((e) => !e.content_date).length

          let newCount = 0

          if (cleanedEntries.length > 0) {
            // Dedup by (keyword, content_date): same keyword on the same website date must not be re-inserted
            const batchDates = Array.from(new Set(cleanedEntries.map(e => e.content_date).filter((d): d is string => !!d)))
            const hasNullDate = cleanedEntries.some(e => !e.content_date)
            const existingKeys = new Set<string>()

            for (const cd of batchDates) {
              const { data: existing } = await supabase
                .from('raw_keywords')
                .select('keyword')
                .eq('site_id', site.id)
                .eq('content_date', cd)
                .limit(10000)
              for (const row of (existing || []) as { keyword: string }[]) {
                existingKeys.add(`${cd}|${row.keyword}`)
              }
            }

            if (hasNullDate) {
              // For undated entries, fall back to same-MYT-day dedup
              const todayMYTStart = new Date(new Date(today + 'T16:00:00.000Z').getTime() - 86400000).toISOString()
              const { data: existingNull } = await supabase
                .from('raw_keywords')
                .select('keyword')
                .eq('site_id', site.id)
                .gte('discovered_at', todayMYTStart)
                .is('content_date', null)
              for (const row of (existingNull || []) as { keyword: string }[]) {
                existingKeys.add(`null|${row.keyword}`)
              }
            }

            const newEntries = cleanedEntries.filter(e => {
              const key = e.content_date ? `${e.content_date}|${e.keyword}` : `null|${e.keyword}`
              return !existingKeys.has(key)
            })
            newCount = newEntries.length

            if (newEntries.length > 0) {
              const rows = newEntries.map((e) => ({
                keyword: e.keyword,
                site_id: site.id,
                discovered_at: new Date().toISOString(),
                content_date: e.content_date || yesterday,
                content_type: e.content_type || 'app',
                source_url: e.source_url ?? null,
              }))
              for (const chunk of chunkArray(rows, 500)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase.from('raw_keywords') as any).upsert(chunk, { onConflict: 'site_id,content_date,keyword', ignoreDuplicates: true })
              }
            }

            // Backfill source_url for existing keywords that were crawled before url_selector was configured
            if (cleanedEntries.some(e => e.source_url)) {
              const urlMap = new Map(cleanedEntries.filter(e => e.source_url).map(e => [e.keyword, e.source_url!]))
              if (urlMap.size > 0) {
                const { data: needBackfill } = await supabase
                  .from('raw_keywords')
                  .select('id, keyword')
                  .eq('site_id', site.id)
                  .in('keyword', Array.from(urlMap.keys()).slice(0, 500))
                  .is('source_url', null)
                // Group by source_url and batch-update instead of N individual UPDATEs
                const byUrl = new Map<string, string[]>()
                for (const row of (needBackfill || []) as { id: string; keyword: string }[]) {
                  const srcUrl = urlMap.get(row.keyword)
                  if (srcUrl) {
                    if (!byUrl.has(srcUrl)) byUrl.set(srcUrl, [])
                    byUrl.get(srcUrl)!.push(row.id)
                  }
                }
                for (const [srcUrl, ids] of Array.from(byUrl.entries())) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  await (supabase.from('raw_keywords') as any).update({ source_url: srcUrl }).in('id', ids)
                }
              }
            }
          }

          if (hasCrawlConfig) {
            // Write per-type counts to competitor_kw_stats, keyed by content_date (website's own date)
            const [appRes, gameRes] = await Promise.all([
              supabase.from('raw_keywords')
                .select('id', { count: 'exact', head: true })
                .eq('site_id', site.id).eq('content_type', 'app')
                .eq('content_date', yesterday)
                .not('keyword', 'like', '%电脑版%'),
              supabase.from('raw_keywords')
                .select('id', { count: 'exact', head: true })
                .eq('site_id', site.id).eq('content_type', 'game')
                .eq('content_date', yesterday)
                .not('keyword', 'like', '%电脑版%'),
            ])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('competitor_kw_stats') as any).upsert(
              { site_id: site.id, stat_date: yesterday, app_count: appRes.count ?? 0, game_count: gameRes.count ?? 0, updated_at: new Date().toISOString() },
              { onConflict: 'site_id,stat_date' }
            )

            if (rawEntries.length === 0) {
              kwEmpty++
              if (kwAid) await siteLog(supabase, kwAid, { domain: site.domain, status: 'empty', detail: '页面返回空（疑似限流或选择器失效）' })
            } else {
              kwOk++
              kwRows += newCount
              const dateDetail = nullDateCount > 0 ? `，⚠${nullDateCount}条日期解析失败（按昨日填充，请检查日期CSS选择器）` : ''
              if (kwAid) await siteLog(supabase, kwAid, { domain: site.domain, status: 'ok', rowsWritten: newCount, detail: `新词${newCount}条${dateDetail}` })
            }
          } else {
            if (kwAid) await siteLog(supabase, kwAid, { domain: site.domain, status: 'skip', detail: '无list_url配置' })
          }

          results.push({ site: site.domain, count: newCount })
        } catch (siteErr: unknown) {
          kwFail++
          const errMsg = siteErr instanceof Error ? siteErr.message : '抓取失败'
          if (kwAid) await siteLog(supabase, kwAid, { domain: site.domain, status: 'fail', detail: errMsg })
          results.push({ site: site.domain, count: 0, error: errMsg })
        }
      }

      if (kwAid) await activityEnd(supabase, kwAid, {
        status: kwFail > 0 ? 'fail' : kwEmpty > 0 ? 'warn' : 'done',
        ok: kwOk, empty: kwEmpty, fail: kwFail, rowsWritten: kwRows,
        durationMs: Date.now() - kwStart,
      })

      // Cleanup old data (only on keywords step to avoid running 3x per day)
      // raw_keywords/rank_changes 永久保留，见 scripts/crawl.ts 里同名清理逻辑上的注释
      await supabase.from('competitor_kw_stats').delete().lt('stat_date', getMalaysiaDate(-30))
      await supabase.from('activity_log').delete().lt('logged_at', new Date(Date.now() - 7 * 86400000).toISOString())
    }

    // ── Rank ─────────────────────────────────────────────────────────────────────
    if (runRank) {
      let rkOk = 0, rkEmpty = 0, rkFail = 0, rkRows = 0
      const rkStart = Date.now()
      const rkAid = await activityStart(supabase, { type: logType, source: 'vercel', step: 'rank', domain: siteFilter ?? undefined })

      for (const site of sites) {
        try {
          const rankDate = today
          let rankupEntries = await fetchRankChanges(site.domain, rankDate, 'rankup')
          await new Promise((r) => setTimeout(r, 2000))
          let rankdownEntries = await fetchRankChanges(site.domain, rankDate, 'rankdown')
          await new Promise((r) => setTimeout(r, 2000))
          // Retry each type individually if it returned 0 — one may succeed while the other got rate-limited
          if (rankupEntries.length === 0) {
            await new Promise((r) => setTimeout(r, 5000))
            rankupEntries = await fetchRankChanges(site.domain, rankDate, 'rankup')
            await new Promise((r) => setTimeout(r, 2000))
          }
          if (rankdownEntries.length === 0) {
            await new Promise((r) => setTimeout(r, 5000))
            rankdownEntries = await fetchRankChanges(site.domain, rankDate, 'rankdown')
            await new Promise((r) => setTimeout(r, 2000))
          }
          const rankRows = [
            ...rankupEntries.map((e) => ({ site_id: site.id, stat_date: rankDate, type: 'rankup', keyword: e.keyword, volume: e.volume })),
            ...rankdownEntries.map((e) => ({ site_id: site.id, stat_date: rankDate, type: 'rankdown', keyword: e.keyword, volume: e.volume })),
          ]
          if (rankRows.length > 0) {
            await supabase.from('rank_changes').delete().eq('site_id', site.id).eq('stat_date', rankDate)
            for (const chunk of chunkArray(rankRows, 500)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase.from('rank_changes') as any).insert(chunk)
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('sites') as any).update({ has_rank_data: true }).eq('id', site.id)
          }
          const kwMap = new Map<string, { volume: number; latest_trend: string }>()
          for (const e of rankdownEntries) kwMap.set(e.keyword, { volume: e.volume, latest_trend: 'rankdown' })
          for (const e of rankupEntries) kwMap.set(e.keyword, { volume: e.volume, latest_trend: 'rankup' })
          const kwWithVol = Array.from(kwMap.entries()).filter(([, v]) => v.volume > 0)
            .map(([keyword, v]) => ({ keyword, volume: v.volume, latest_trend: v.latest_trend, stat_date: rankDate }))
          const kwNoVol = Array.from(kwMap.entries()).filter(([, v]) => v.volume <= 0)
            .map(([keyword, v]) => ({ keyword, volume: 0, latest_trend: v.latest_trend, stat_date: rankDate }))
          await upsertKeywordVolumeWithChange(supabase, kwWithVol)
          for (const chunk of chunkArray(kwNoVol, 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('keyword_volume') as any).upsert(chunk, { onConflict: 'keyword', ignoreDuplicates: true })
          }
          for (const chunk of chunkArray(kwNoVol.filter(r => r.latest_trend === 'rankup').map(r => r.keyword), 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('keyword_volume') as any).update({ latest_trend: 'rankup' }).in('keyword', chunk)
          }
          for (const chunk of chunkArray(kwNoVol.filter(r => r.latest_trend === 'rankdown').map(r => r.keyword), 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('keyword_volume') as any).update({ latest_trend: 'rankdown' }).in('keyword', chunk)
          }

          if (rankRows.length > 0) {
            rkOk++
            rkRows += rankRows.length
            if (rkAid) await siteLog(supabase, rkAid, { domain: site.domain, status: 'ok', rowsWritten: rankRows.length, detail: `涨入${rankupEntries.length} | 跌出${rankdownEntries.length}` })
          } else {
            rkEmpty++
            if (rkAid) await siteLog(supabase, rkAid, { domain: site.domain, status: 'empty', detail: '涨入0 | 跌出0（疑似限流）' })
          }
        } catch (rankErr) {
          rkFail++
          const msg = rankErr instanceof Error ? rankErr.message : '排名抓取失败'
          if (rkAid) await siteLog(supabase, rkAid, { domain: site.domain, status: 'fail', detail: msg })
          results.push({ site: site.domain, count: -1, error: msg })
        }
      }

      // 增量维护"连续上涨词/竞品涨排名"汇总表（2026-08-20）——见 scripts/crawl.ts
      // runRank() 同名调用的注释。
      try {
        await (supabase as any).rpc('refresh_keyword_signal_rollup', { p_date: today })
      } catch (e) {
        console.error(`refresh_keyword_signal_rollup 失败: ${e instanceof Error ? e.message : e}`)
      }

      if (rkAid) await activityEnd(supabase, rkAid, {
        status: rkFail > 0 ? 'fail' : rkEmpty > 0 ? 'warn' : 'done',
        ok: rkOk, empty: rkEmpty, fail: rkFail, rowsWritten: rkRows,
        durationMs: Date.now() - rkStart,
      })
    }

    // ── Weight + Index ────────────────────────────────────────────────────────────
    // Retries up to 2 times on failure (likely rate-limited) with 30s wait each
    if (runWeight) {
      let wtOk = 0, wtFail = 0, wtRows = 0
      const wtStart = Date.now()
      const wtAid = await activityStart(supabase, { type: logType, source: 'vercel', step: 'weight', domain: siteFilter ?? undefined })

      for (const site of sites) {
        let fetched = false
        let lastData: { pc: number; mobile: number; indexCount: number } | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) await new Promise((r) => setTimeout(r, isSingleSite ? 5000 : 30000))
            const { pc, mobile, indexCount, pcIpMin, pcIpMax, mobileIpMin, mobileIpMax } = await fetchAizhanData(site.domain)
            await Promise.all([
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase.from('weight_history') as any).upsert(
                { site_id: site.id, record_date: today, pc_weight: pc, mobile_weight: mobile, pc_ip: pcIpMin, pc_ip_max: pcIpMax, mobile_ip: mobileIpMin, mobile_ip_max: mobileIpMax },
                { onConflict: 'site_id,record_date' }
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase.from('index_snapshots') as any).upsert(
                { site_id: site.id, snapshot_date: today, index_count: indexCount },
                { onConflict: 'site_id,snapshot_date' }
              ),
            ])
            lastData = { pc, mobile, indexCount }
            fetched = true
            break
          } catch {
            // retry on next attempt
          }
        }
        // Always pace between sites — skipping delay on failure causes immediate hammering of the next site
        await new Promise((r) => setTimeout(r, 3000))

        if (fetched && lastData) {
          wtOk++
          wtRows += 2
          if (wtAid) await siteLog(supabase, wtAid, {
            domain: site.domain, status: 'ok', rowsWritten: 2,
            detail: `pc=${lastData.pc} mobile=${lastData.mobile} index=${lastData.indexCount}`,
          })
        } else {
          wtFail++
          if (wtAid) await siteLog(supabase, wtAid, { domain: site.domain, status: 'fail', detail: '3次重试后放弃' })
          results.push({ site: site.domain, count: -1, error: '权重抓取失败（3次重试后放弃）' })
        }
      }

      if (wtAid) await activityEnd(supabase, wtAid, {
        status: wtFail > 0 ? 'warn' : 'done',
        ok: wtOk, fail: wtFail, rowsWritten: wtRows,
        durationMs: Date.now() - wtStart,
      })
    }

    // ── Index Pages ───────────────────────────────────────────────────────────────
    if (runIndexPages) {
      let ipOk = 0, ipEmpty = 0, ipFail = 0, ipRows = 0
      const ipStart = Date.now()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const indexPageSites = (sites as any[]).filter((s: any) => s.has_index_pages)
      const ipAid = await activityStart(supabase, { type: logType, source: 'vercel', step: 'index-pages', domain: siteFilter ?? undefined })

      for (const site of indexPageSites) {
        try {
          const { pages, failReason } = await fetchBaiduIndexPages(site.domain)
          if (pages.length === 0) {
            const reasonMap: Record<string, string> = {
              captcha: '百度安全验证拦截（IP被封）',
              no_content: '页面无搜索结果区域（可能被拦截）',
              http_error: 'HTTP请求失败',
              empty_results: '百度site:查询无结果（该域名未被收录或已过滤）',
            }
            const detail = reasonMap[failReason ?? ''] ?? '百度site:查询返回空'
            ipEmpty++
            if (ipAid) await siteLog(supabase, ipAid, { domain: site.domain, status: 'empty', detail })
          } else {
            let newCount = 0
            for (const chunk of chunkArray(pages, 500)) {
              const rows = chunk.map(p => ({
                site_id: site.id,
                url: p.url,
                title: p.title,
                snippet: p.snippet,
                baidu_date_str: p.baiduDateStr,
                first_seen_date: today,      // preserved by DB trigger on UPDATE
                last_seen_date: today,
                disappeared_date: null,      // clear if was previously disappeared
                updated_at: new Date().toISOString(),
              }))
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const res = await (supabase.from('site_indexed_pages') as any).upsert(rows, {
                onConflict: 'site_id,url',
                ignoreDuplicates: false,
              }).select('first_seen_date')
              const inserted = ((res.data || []) as { first_seen_date: string }[])
              newCount += inserted.filter(r => r.first_seen_date === today).length
            }

            // Only mark as disappeared if the page was seen in the last 30 days but is not in today's crawl.
            // Pages older than 30 days are outside the observable window — absence in today's crawl
            // does NOT mean de-indexed (Baidu's site: results for a month may not surface old content).
            const window30d = getMalaysiaDate(-30)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: disappeared } = await (supabase.from('site_indexed_pages') as any)
              .update({ disappeared_date: today })
              .eq('site_id', site.id)
              .gte('last_seen_date', window30d)    // was seen within the observable window
              .lt('last_seen_date', today)          // but not in today's crawl
              .is('disappeared_date', null)
              .select('id')
            const disappearedCount = (disappeared || []).length

            ipRows += newCount
            ipOk++
            if (ipAid) await siteLog(supabase, ipAid, { domain: site.domain, status: 'ok', rowsWritten: newCount, detail: `发现${pages.length}条，新增${newCount}条，脱收${disappearedCount}条` })
          }
        } catch (e) {
          ipFail++
          const msg = e instanceof Error ? e.message : '收录页面抓取失败'
          if (ipAid) await siteLog(supabase, ipAid, { domain: site.domain, status: 'fail', detail: msg })
        }
        await new Promise(r => setTimeout(r, 10000))
      }

      if (ipAid) await activityEnd(supabase, ipAid, {
        status: ipFail > 0 ? 'warn' : ipEmpty > 0 ? 'warn' : 'done',
        ok: ipOk, empty: ipEmpty, fail: ipFail, rowsWritten: ipRows,
        durationMs: Date.now() - ipStart,
      })
    }

    // ── Rank Title (竞品追踪) ────────────────────────────────────────────────────
    if (runRankTitle && siteFilter) {
      const rtStart = Date.now()
      const rtAid = await activityStart(supabase, { type: 'cron_manual', source: 'vercel', step: 'rank-title', domain: siteFilter })
      const site = sites[0]
      if (site) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('site_keyword_ranks') as any).delete().eq('site_id', site.id).eq('stat_date', today)
          const [upEntries, downEntries] = await Promise.all([
            fetchRankupWithTitle(site.domain, today),
            fetchRankdownWithTitle(site.domain, today),
          ])
          const rows = [
            ...upEntries.map(e => ({ site_id: site.id, keyword: e.keyword, stat_date: today, type: 'rankup', platform: 'mobile', rank_position: e.rank_position, volume: e.volume, title: e.title || null, url: e.url || null })),
            ...downEntries.map(e => ({ site_id: site.id, keyword: e.keyword, stat_date: today, type: 'rankdown', platform: 'mobile', rank_position: e.rank_position, volume: e.volume, title: e.title || null, url: e.url || null })),
          ]
          for (const chunk of chunkArray(rows, 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('site_keyword_ranks') as any).upsert(chunk, { onConflict: 'site_id,keyword,stat_date,type,platform' })
          }
          const rtKwMap = new Map<string, { volume: number; latest_trend: string }>()
          for (const e of downEntries) rtKwMap.set(e.keyword, { volume: e.volume, latest_trend: 'rankdown' })
          for (const e of upEntries) rtKwMap.set(e.keyword, { volume: e.volume, latest_trend: 'rankup' })
          const rtKwWithVol = Array.from(rtKwMap.entries()).filter(([, v]) => v.volume > 0)
            .map(([keyword, v]) => ({ keyword, volume: v.volume, latest_trend: v.latest_trend, stat_date: today }))
          const rtKwNoVol = Array.from(rtKwMap.entries()).filter(([, v]) => v.volume <= 0)
            .map(([keyword, v]) => ({ keyword, volume: 0, latest_trend: v.latest_trend, stat_date: today }))
          await upsertKeywordVolumeWithChange(supabase, rtKwWithVol)
          for (const chunk of chunkArray(rtKwNoVol, 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('keyword_volume') as any).upsert(chunk, { onConflict: 'keyword', ignoreDuplicates: true })
          }
          for (const chunk of chunkArray(rtKwNoVol.filter(r => r.latest_trend === 'rankup').map(r => r.keyword), 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('keyword_volume') as any).update({ latest_trend: 'rankup' }).in('keyword', chunk)
          }
          for (const chunk of chunkArray(rtKwNoVol.filter(r => r.latest_trend === 'rankdown').map(r => r.keyword), 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('keyword_volume') as any).update({ latest_trend: 'rankdown' }).in('keyword', chunk)
          }
          if (rtAid) await activityEnd(supabase, rtAid, { status: rows.length > 0 ? 'done' : 'warn', ok: rows.length > 0 ? 1 : 0, empty: rows.length === 0 ? 1 : 0, fail: 0, rowsWritten: rows.length, durationMs: Date.now() - rtStart })
          results.push({ site: site.domain, count: rows.length })
        } catch (e) {
          const msg = e instanceof Error ? e.message : '竞品追踪抓取失败'
          if (rtAid) await activityEnd(supabase, rtAid, { status: 'fail', ok: 0, empty: 0, fail: 1, rowsWritten: 0, durationMs: Date.now() - rtStart })
          results.push({ site: site.domain, count: -1, error: msg })
        }
      }

      // 增量维护"连续上涨词/竞品涨排名"汇总表（2026-08-20）——见 scripts/crawl.ts
      // runRank() 同名调用的注释。这条路径是单站点手动重抓（siteFilter），
      // 批量的 site_keyword_ranks 写入主要走 scripts/crawl-rank.ts（已经加过
      // 同样的调用），这里加上是为了手动重抓单站也能让汇总表跟上。
      try {
        await (supabase as any).rpc('refresh_keyword_signal_rollup', { p_date: today })
      } catch (e) {
        console.error(`refresh_keyword_signal_rollup 失败: ${e instanceof Error ? e.message : e}`)
      }
    }

    // ── Tracking (竞品成效追踪) ─────────────────────────────────────────────────
    if (runTracking) {
      const trkStart = Date.now()
      const trkAid = await activityStart(supabase, { type: logType, source: 'vercel', step: 'tracking', domain: siteFilter ?? undefined })

      // Load rules with trigger logic
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rulesData } = await (supabase.from('rules') as any)
        .select('id, trigger_type, trigger_params, tracking_window_days')
        .not('trigger_type', 'is', null)
      type RuleRow = { id: string; trigger_type: string; trigger_params: Record<string, number>; tracking_window_days: number }
      const rules = (rulesData || []) as RuleRow[]
      const rule900 = rules.find((r: RuleRow) => r.trigger_type === 'rankdown_then_update')
      const rule901 = rules.find((r: RuleRow) => r.trigger_type === 'batch_prefix_update')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trackingSites = (sites as any[]).filter((s: any) => s.has_rank_title)
      let trkOk = 0, trkEmpty = 0, trkFail = 0, trkRows = 0

      for (const site of trackingSites) {
        try {
          const window60 = getMalaysiaDate(-60)

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rankRows } = await (supabase.from('site_keyword_ranks') as any)
            .select('keyword, url, volume, rank_position, type')
            .eq('site_id', site.id)
            .eq('stat_date', today)
            .eq('platform', 'mobile')
          type RankRow = { keyword: string; url: string | null; volume: number; rank_position: number | null; type: string }
          const rankSignals = (rankRows || []) as RankRow[]
          const rankMap = new Map<string, { volume: number; rank_position: number | null; type: string }>()
          const urlRankDataMap = new Map<string, { volume: number; rank_position: number | null; type: string }>()
          for (const r of rankSignals) {
            if (!rankMap.has(r.keyword) || rankMap.get(r.keyword)!.type !== 'rankup') {
              rankMap.set(r.keyword, { volume: r.volume, rank_position: r.rank_position, type: r.type })
            }
            if (r.url && (!urlRankDataMap.has(r.url) || urlRankDataMap.get(r.url)!.type !== 'rankup')) {
              urlRankDataMap.set(r.url, { volume: r.volume, rank_position: r.rank_position, type: r.type })
            }
          }

          const newIndexUrls = new Set<string>()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: newIdxRows } = await (supabase.from('site_indexed_pages') as any)
            .select('url').eq('site_id', site.id).eq('first_seen_date', today).limit(500)
          for (const r of (newIdxRows || []) as { url: string }[]) newIndexUrls.add(r.url)
          // A single site can have 1000s of distinct signal keywords/URLs in a
          // day (verified 2026-07-29: one site had 2791) — `.slice(0, 500)`
          // silently dropped everything past the first 500, which is why
          // competitor_tracking_records has been empty since this feature was
          // built despite real keyword overlap existing. Chunked `.in()`
          // batching (even at 150/batch) turned out to still fail
          // unpredictably under many rapid consecutive requests (verified
          // 2026-07-29: every batch in a 19-batch run errored with the same
          // ~16KB header overflow despite each individual request being well
          // under that). Switched to Postgres RPC functions instead —
          // parameters travel in the POST body, not the URL query string, so
          // array size no longer matters at all. See migration
          // add_competitor_tracking_match_rpcs.
          const newIndexKwSet = new Set<string>()
          if (newIndexUrls.size > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: urlKwRows, error: newIdxKwErr } = await (supabase as any).rpc('match_raw_keywords_by_url', {
              p_site_id: site.id, p_urls: Array.from(newIndexUrls), p_since: window60,
            })
            if (newIdxKwErr) console.error(`[竞品追踪] match_raw_keywords_by_url 查询失败: ${JSON.stringify(newIdxKwErr)}`)
            for (const r of (urlKwRows || []) as { keyword: string; source_url: string }[]) newIndexKwSet.add(r.keyword)
          }

          // 1.5. URL-based rank signals: cross-ref site_keyword_ranks.url with raw_keywords.source_url
          if (urlRankDataMap.size > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: urlKwMappings, error: urlRankKwErr } = await (supabase as any).rpc('match_raw_keywords_by_url', {
              p_site_id: site.id, p_urls: Array.from(urlRankDataMap.keys()), p_since: window60,
            })
            if (urlRankKwErr) console.error(`[竞品追踪] match_raw_keywords_by_url 查询失败: ${JSON.stringify(urlRankKwErr)}`)
            for (const r of (urlKwMappings || []) as { keyword: string; source_url: string }[]) {
              const urlRank = urlRankDataMap.get(r.source_url)
              if (urlRank && (!rankMap.has(r.keyword) || rankMap.get(r.keyword)!.type !== 'rankup')) {
                rankMap.set(r.keyword, urlRank)
              }
            }
          }

          const allSignalKws = new Set([...Array.from(rankMap.keys()), ...Array.from(newIndexKwSet)])
          if (allSignalKws.size === 0) {
            trkEmpty++
            if (trkAid) await siteLog(supabase, trkAid, { domain: site.domain, status: 'empty', detail: '无排名/收录信号' })
            continue
          }

          type KwMeta = { content_type: string | null; content_date: string | null; source_url: string | null; count: number }
          const kwMetaMap = new Map<string, KwMeta>()
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: rawKwRows, error: rawKwErr } = await (supabase as any).rpc('match_raw_keywords_by_keyword', {
              p_site_id: site.id, p_keywords: Array.from(allSignalKws), p_since: window60,
            })
            if (rawKwErr) console.error(`[竞品追踪] match_raw_keywords_by_keyword 查询失败: ${JSON.stringify(rawKwErr)}`)
            for (const r of (rawKwRows || []) as { keyword: string; content_type: string | null; content_date: string; source_url: string | null }[]) {
              if (!kwMetaMap.has(r.keyword)) kwMetaMap.set(r.keyword, { content_type: r.content_type, content_date: r.content_date, source_url: r.source_url, count: 1 })
              else kwMetaMap.get(r.keyword)!.count++
            }
          }
          const trackedKws = Array.from(allSignalKws).filter(kw => kwMetaMap.has(kw))
          if (trackedKws.length === 0) {
            trkEmpty++
            if (trkAid) await siteLog(supabase, trkAid, { domain: site.domain, status: 'empty', detail: '信号词无提交记录' })
            continue
          }

          const volMap = new Map<string, number>()
          {
            const { data: volRows, error: volErr } = await (supabase as any).rpc('match_keyword_volume', { p_keywords: trackedKws })
            if (volErr) console.error(`[竞品追踪] match_keyword_volume 查询失败: ${JSON.stringify(volErr)}`)
            for (const r of (volRows || []) as { keyword: string; volume: number }[]) volMap.set(r.keyword, r.volume)
          }

          const sourceUrls = trackedKws.map(kw => kwMetaMap.get(kw)?.source_url).filter((u): u is string => !!u)
          const indexFirstSeenMap = new Map<string, string>()
          if (sourceUrls.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: idxRows, error: idxErr } = await (supabase as any).rpc('match_site_indexed_pages', {
              p_site_id: site.id, p_urls: sourceUrls,
            })
            if (idxErr) console.error(`[竞品追踪] match_site_indexed_pages 查询失败: ${JSON.stringify(idxErr)}`)
            for (const r of (idxRows || []) as { url: string; first_seen_date: string }[]) {
              if (r.first_seen_date) indexFirstSeenMap.set(r.url, r.first_seen_date)
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: profile } = await (supabase.from('competitor_profiles') as any)
            .select('same_name_diff_date_is_update, same_base_diff_sub_is_update')
            .eq('domain', site.domain).maybeSingle()
          const sameNameDiffDate: boolean = (profile as { same_name_diff_date_is_update: boolean } | null)?.same_name_diff_date_is_update ?? false
          const sameBaseDiffSub: boolean = (profile as { same_base_diff_sub_is_update: boolean } | null)?.same_base_diff_sub_is_update ?? false

          const prefixDateCount = new Map<string, number>()
          if (rule901) {
            for (const kw of trackedKws) {
              const meta = kwMetaMap.get(kw)
              if (meta?.content_date) {
                const key = `${meta.content_date}|${kw.slice(0, 4)}`
                prefixDateCount.set(key, (prefixDateCount.get(key) ?? 0) + 1)
              }
            }
          }

          const upsertRows: Record<string, unknown>[] = []
          for (const keyword of trackedKws) {
            const meta = kwMetaMap.get(keyword)!
            const rank = rankMap.get(keyword)
            const srcUrl = meta.source_url || null
            const indexFirstSeen = srcUrl ? (indexFirstSeenMap.get(srcUrl) ?? null) : null
            const isNewlyIndexed = srcUrl ? newIndexUrls.has(srcUrl) : false

            let operation_type = '新增'
            if (sameNameDiffDate && (meta.count ?? 0) > 1) operation_type = '更新'
            else if (sameBaseDiffSub && meta.content_date) {
              const key = `${meta.content_date}|${keyword.slice(0, 4)}`
              if ((prefixDateCount.get(key) ?? 0) >= 3) operation_type = '更新'
            }

            let effectiveness = '追踪中'
            if (rank?.type === 'rankup') effectiveness = '有效'
            else if (isNewlyIndexed) effectiveness = '有效'

            let rule_id: string | null = null
            if (rule900 && rank?.type === 'rankdown' && meta.content_date) {
              const maxDaysBack = rule900.trigger_params.max_days_back ?? 7
              if (meta.content_date >= getMalaysiaDate(-maxDaysBack)) rule_id = rule900.id
            }
            if (!rule_id && rule901 && meta.content_date) {
              const minBatch = rule901.trigger_params.min_batch_size ?? 3
              const key = `${meta.content_date}|${keyword.slice(0, 4)}`
              if ((prefixDateCount.get(key) ?? 0) >= minBatch) rule_id = rule901.id
            }

            upsertRows.push({
              site_id: site.id, keyword, discovery_date: today,
              content_date: meta.content_date || null, content_type: meta.content_type || null,
              operation_type, source_url: srcUrl,
              search_volume: volMap.get(keyword) ?? 0,
              rank_position: rank?.rank_position ?? null, rank_type: rank?.type ?? null, rank_volume: rank?.volume ?? 0,
              index_first_seen: indexFirstSeen, effectiveness, rule_id,
              updated_at: new Date().toISOString(),
            })
          }

          if (upsertRows.length > 0) {
            for (const chunk of chunkArray(upsertRows, 500)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase.from('competitor_tracking_records') as any).upsert(chunk, {
                onConflict: 'site_id,keyword,discovery_date', ignoreDuplicates: false,
              })
            }
          }
          // Mark stale '追踪中' records (>60 days) as '无效'
          const stale60 = getMalaysiaDate(-60)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('competitor_tracking_records') as any)
            .update({ effectiveness: '无效', updated_at: new Date().toISOString() })
            .eq('site_id', site.id).eq('effectiveness', '追踪中').lt('discovery_date', stale60)

          trkRows += upsertRows.length
          trkOk++
          if (trkAid) await siteLog(supabase, trkAid, { domain: site.domain, status: 'ok', rowsWritten: upsertRows.length, detail: `信号${allSignalKws.size}词，匹配${trackedKws.length}词` })
          results.push({ site: site.domain, count: upsertRows.length })
        } catch (e) {
          trkFail++
          const msg = e instanceof Error ? e.message : '追踪失败'
          if (trkAid) await siteLog(supabase, trkAid, { domain: site.domain, status: 'fail', detail: msg })
          results.push({ site: site.domain, count: -1, error: msg })
        }
      }

      // Own-site tracking
      let ownRows = 0
      const window90 = getMalaysiaDate(-90)
      try {
        const { data: claimRows } = await supabase.from('member_claimed_keywords')
          .select('id, group_id, user_id, keyword, final_keyword, page_url, operation_type, search_volume, submitted_at, claimed_date')
          .eq('status', 'submitted').not('page_url', 'is', null).gte('claimed_date', window90)
        type ClaimRow = { id: string; group_id: string; user_id: string; keyword: string; final_keyword: string | null; page_url: string | null; operation_type: string | null; search_volume: number; submitted_at: string | null; claimed_date: string }
        const claims = (claimRows || []) as ClaimRow[]

        if (claims.length > 0) {
          const pageUrlVariants = Array.from(new Set(claims.filter(c => c.page_url).flatMap(c => urlSubdomainVariants(c.page_url!))))

          // Chunk size 150 keeps the .in() query string well under the ~16KB
          // HTTP header limit — 500 caused silent "HeadersOverflowError: fetch
          // failed" (unchecked here before) that made every own-site rank/index
          // match return empty for days without any visible error (verified 2026-07-29).
          const indexMap = new Map<string, { first_seen_date: string; disappeared_date: string | null }>()
          for (const chunk of chunkArray(pageUrlVariants, 150)) {
            const { data: idxRows, error: idxErr } = await supabase.from('site_indexed_pages')
              .select('url, first_seen_date, disappeared_date').in('url', chunk)
            if (idxErr) console.error(`[自己站点追踪] site_indexed_pages 查询失败: ${JSON.stringify(idxErr)}`)
            for (const r of (idxRows || []) as { url: string; first_seen_date: string; disappeared_date: string | null }[]) {
              indexMap.set(bareUrl(r.url), { first_seen_date: r.first_seen_date, disappeared_date: r.disappeared_date })
            }
          }

          const rankByUrlMap = new Map<string, { keyword: string; rank_position: number | null; prev_rank: number | null; volume: number; stat_date: string }>()
          const rankMatchesByUrlMap = new Map<string, Map<string, { rank_position: number | null; prev_rank: number | null; volume: number }>>()
          for (const chunk of chunkArray(pageUrlVariants, 150)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: rRows, error: rankErr } = await (supabase.from('site_keyword_ranks') as any)
              .select('url, keyword, rank_position, prev_rank, volume, stat_date')
              .in('url', chunk).not('url', 'is', null).eq('platform', 'mobile')
              .order('stat_date', { ascending: false }).order('rank_position', { ascending: true, nullsFirst: false })
            if (rankErr) console.error(`[自己站点追踪] site_keyword_ranks 查询失败: ${JSON.stringify(rankErr)}`)
            for (const r of (rRows || []) as { url: string; keyword: string; rank_position: number | null; prev_rank: number | null; volume: number; stat_date: string }[]) {
              const key = bareUrl(r.url)
              if (!rankByUrlMap.has(key)) rankByUrlMap.set(key, { keyword: r.keyword, rank_position: r.rank_position, prev_rank: r.prev_rank, volume: r.volume, stat_date: r.stat_date })
              if (!rankMatchesByUrlMap.has(key)) rankMatchesByUrlMap.set(key, new Map())
              const kwMap = rankMatchesByUrlMap.get(key)!
              if (!kwMap.has(r.keyword)) kwMap.set(r.keyword, { rank_position: r.rank_position, prev_rank: r.prev_rank, volume: r.volume })
            }
          }

          const ownUpsertRows: Record<string, unknown>[] = []
          const rankMatchRows: Record<string, unknown>[] = []
          for (const claim of claims) {
            const url = claim.page_url
            const idx = url ? indexMap.get(bareUrl(url)) : undefined
            const rank = url ? rankByUrlMap.get(bareUrl(url)) : undefined
            const is_indexed = !!idx && !idx.disappeared_date
            const submitDate = claim.submitted_at ? claim.submitted_at.slice(0, 10) : claim.claimed_date
            const daysSince = Math.max(0, Math.floor((new Date(today).getTime() - new Date(submitDate).getTime()) / 86400000))

            let effectiveness: string
            if ((rank?.rank_position ?? null) != null) effectiveness = '获取排名'
            else if (is_indexed) effectiveness = '获取收录'
            else effectiveness = daysSince >= 90 ? '无效' : '追踪中'

            ownUpsertRows.push({
              claim_id: claim.id, group_id: claim.group_id, user_id: claim.user_id,
              keyword: claim.keyword, final_keyword: claim.final_keyword,
              page_url: url, operation_type: claim.operation_type,
              search_volume: Number(claim.search_volume) || 0,
              submit_date: submitDate, record_date: today,
              is_indexed, index_first_seen: idx?.first_seen_date ?? null, index_disappeared: idx?.disappeared_date ?? null,
              rank_keyword: rank?.keyword ?? null, rank_position: rank?.rank_position ?? null,
              prev_rank_position: rank?.prev_rank ?? null, rank_volume: rank?.volume ? Number(rank.volume) : 0,
              rank_date: rank?.stat_date ?? null, effectiveness,
              updated_at: new Date().toISOString(),
            })

            const matches = url ? rankMatchesByUrlMap.get(bareUrl(url)) : undefined
            if (matches) {
              for (const [keyword, m] of Array.from(matches.entries())) {
                rankMatchRows.push({
                  claim_id: claim.id, record_date: today, keyword,
                  rank_position: m.rank_position, prev_rank_position: m.prev_rank,
                  volume: m.volume ? Number(m.volume) : 0,
                })
              }
            }
          }

          for (const chunk of chunkArray(ownUpsertRows, 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('site_tracking_records') as any).upsert(chunk, {
              onConflict: 'claim_id,record_date', ignoreDuplicates: false,
            })
          }
          for (const chunk of chunkArray(rankMatchRows, 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('site_tracking_rank_matches') as any).upsert(chunk, {
              onConflict: 'claim_id,record_date,keyword', ignoreDuplicates: false,
            })
          }
          ownRows = ownUpsertRows.length
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '自己站点追踪失败'
        console.error('own-site tracking error:', msg)
      }

      if (trkAid) await activityEnd(supabase, trkAid, {
        status: trkFail > 0 ? 'warn' : 'done',
        ok: trkOk, empty: trkEmpty, fail: trkFail, rowsWritten: trkRows + ownRows,
        durationMs: Date.now() - trkStart,
        summary: `竞品追踪 ${trkOk} 站成功，竞品 ${trkRows} 条，自己站点 ${ownRows} 条，${trkFail} 站失败`,
      })
    }

    return NextResponse.json({ date: today, yesterday, results })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '定时任务失败' },
      { status: 500 }
    )
  }
}
