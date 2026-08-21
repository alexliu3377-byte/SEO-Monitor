import { createClient } from '@supabase/supabase-js'
import {
  fetchHtmlListPages,
  fetchJsonHtmlPages,
  cleanTitle,
  fetchAizhanData,
  fetchBaiduIndexPages,
  type HtmlSource,
  type BaiduIndexedPage,
  type BaiduIndexFailReason,
} from '../lib/crawler'
import { createAizhanHttpSession, fetchRankChangesViaHttp } from '../lib/crawler-aizhan-http'
import { activityStart, activityEnd, siteLog } from '../lib/activity-log'
import { upsertKeywordVolumeWithChange } from '../lib/keyword-volume'

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  // Relative times (MYT UTC+8)
  if (/^\d+(?:分钟|小时)前$/.test(dateStr)) return getMalaysiaDate(0)
  if (dateStr === '昨天' || dateStr === '一天前') return getMalaysiaDate(-1)
  const daysAgo = dateStr.match(/^(\d+)天前$/)
  if (daysAgo) return getMalaysiaDate(-parseInt(daysAgo[1]))
  // MM-DD anywhere in the string (e.g. "07-20", "更新：06-28")
  const md = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})/)
  if (md) {
    const mm = parseInt(md[1]); const dd = parseInt(md[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const today = getMalaysiaDate(0)
      const year = today.slice(0, 4)
      const candidate = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      return candidate <= today ? candidate : `${parseInt(year) - 1}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  } catch { /* ignore */ }
  return null
}


function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// 当前 MYT 时间字符串 HH:MM:SS
function ts(): string {
  const d = new Date(Date.now() + 8 * 3600000)
  return d.toISOString().slice(11, 19)
}

// 格式化耗时 ms → "Xm Ys"
function elapsed(ms: number): string {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

// 把数组切成指定大小的块
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

// Strip a leading www./m. host label and a trailing slash so tracking can match
// a claimed page_url (often typed without the "m." mobile prefix, no trailing
// slash) against site_indexed_pages/site_keyword_ranks URLs — the latter come
// from Baidu's mobile SERPs (often m. prefixed) and 爱站's own listing pages
// (sometimes with a stray trailing slash, e.g. ".../3908.html/"). Deliberately
// does NOT strip other subdomains (site./mxm./xyjztzh. etc.) — those are real
// distinct game microsites on 爱站-tracked domains, not formatting variants;
// treating them as equivalent would produce false "已收录/已排名" matches.
function bareUrl(url: string): string {
  return url.replace(/^(https?:\/\/)?(www\.|m\.)?/i, '').replace(/\/$/, '')
}
// `.in()` needs the exact stored string, and storage format differs by table:
// site_indexed_pages stores bare (no protocol, e.g. "m.site.com/x"), while
// site_keyword_ranks stores with protocol and sometimes a trailing slash
// (e.g. "http://www.site.com/x/") — verified against real data 2026-07-29.
// Generate every combination so the DB filter actually finds the row,
// regardless of which table/format it came from.
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

// supabase-js 出错时不 throw，只在返回值带 error 字段，需要手动检查
function sbCheck<T extends { error: unknown }>(res: T, label: string): T {
  if (res.error) throw new Error(`[Supabase] ${label}: ${JSON.stringify(res.error)}`)
  return res
}

// Supabase 写入失败时自动重试
async function withRetry<T>(fn: () => Promise<T>, retries = 3, waitMs = 5000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === retries - 1) throw e
      console.warn(`    ${ts()} ↺ 重试 ${i + 1}/${retries}: ${e instanceof Error ? e.message : e}`)
      await delay(waitMs)
    }
  }
  throw new Error('unreachable')
}

async function getPublicIp(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org?format=text', { signal: AbortSignal.timeout(5000) })
    return (await res.text()).trim()
  } catch { return 'unknown' }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SiteRecord {
  id: string
  domain: string
  crawl_frequency: 'daily'
  list_url: string | null
  title_selector: string | null
  date_selector: string | null
  source_types: string | null
  url_selectors: string | null
  enable_version_clean: boolean
  version_suffixes: string[]
  is_enabled: boolean
  has_rank_data: boolean
  has_rank_title: boolean
  has_index_pages: boolean
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function runKeywords(sites: SiteRecord[], today: string, yesterday: string, isMainGroup = true, activityId: string | null = null) {
  const stepStart = Date.now()
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  KEYWORDS   日期=${yesterday}   ${ts()}`)
  console.log(`${'═'.repeat(60)}`)

  let ok = 0, skipped = 0, failed = 0, empty = 0, totalRows = 0

  for (let idx = 0; idx < sites.length; idx++) {
    const site = sites[idx]
    const prefix = `  [${String(idx + 1).padStart(2)}/${sites.length}] ${site.domain.padEnd(30)}`

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
        const urlBlocks = isNew ? listUrl.split(SRC_SEP) : listUrl.split('\n').map((u) => u.trim()).filter(Boolean)
        const titleSels = (site.title_selector || '').split(isNew ? SRC_SEP : '\n').map((s) => s.trim())
        const dateSels = (site.date_selector || '').split(isNew ? SRC_SEP : '\n').map((s) => s.trim())
        const sourceTypesList = (site.source_types || '').split(isNew ? SRC_SEP : '\n').map((s) => s.trim())
        const urlSelsList = (site.url_selectors || '').split(SRC_SEP).map((s) => s.trim())

        for (let i = 0; i < urlBlocks.length; i++) {
          const srcType = sourceTypesList[i] === 'game' ? 'game' : 'app'
          const srcUrlSel = urlSelsList[i] ?? urlSelsList[0] ?? ''
          const srcUrls = isNew
            ? urlBlocks[i].split('\n').map((u) => u.trim()).filter(Boolean)
            : [urlBlocks[i]]
          for (const u of srcUrls) {
            const titleSel = titleSels[i] || titleSels[0] || ''
            const dateSel = dateSels[i] || dateSels[0] || ''
            let entries
            if (u.includes('{page}')) {
              // JSON API mode: URL template with {page} placeholder
              entries = await fetchJsonHtmlPages(u, titleSel, dateSel, srcUrlSel || undefined, htmlCutoff)
            } else {
              const src: HtmlSource = { url: u, titleSelector: titleSel, dateSelector: dateSel, urlSelector: srcUrlSel || undefined }
              entries = await fetchHtmlListPages([src], htmlCutoff, maxPg)
            }
            for (const e of entries) {
              rawEntries.push({ title: e.title, content_date: parseContentDate(e.date), content_type: srcType, source_url: srcUrlSel ? (e.url || null) : null })
            }
          }
        }
      }

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

      // 日期解析失败（date_selector 没匹配到，或匹配到的文本认不出格式）不再静默处理——
      // 写库时仍按 yesterday 填充（避免破坏下游一堆按 content_date 分组/统计的功能），
      // 但这里统计出来，抓取日志里会显示这个站点这次有几条，方便定位选择器坏了的站点。
      const nullDateCount = cleanedEntries.filter((e) => !e.content_date).length

      let newCount = 0

      if (cleanedEntries.length > 0) {
        const batchDates = Array.from(new Set(cleanedEntries.map((e) => e.content_date).filter((d): d is string => !!d)))
        const hasNullDate = cleanedEntries.some((e) => !e.content_date)
        const existingKeys = new Set<string>()

        for (const cd of batchDates) {
          const { data: existing } = await supabase
            .from('raw_keywords').select('keyword').eq('site_id', site.id).eq('content_date', cd).limit(10000)
          for (const row of (existing || []) as { keyword: string }[]) existingKeys.add(`${cd}|${row.keyword}`)
        }

        if (hasNullDate) {
          const todayMYTStart = new Date(new Date(today + 'T16:00:00.000Z').getTime() - 86400000).toISOString()
          const { data: existingNull } = await supabase
            .from('raw_keywords').select('keyword').eq('site_id', site.id).gte('discovered_at', todayMYTStart).is('content_date', null)
          for (const row of (existingNull || []) as { keyword: string }[]) existingKeys.add(`null|${row.keyword}`)
        }

        const newEntries = cleanedEntries.filter((e) => {
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
            await withRetry(async () =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sbCheck(await (supabase.from('raw_keywords') as any).upsert(chunk, { onConflict: 'site_id,content_date,keyword', ignoreDuplicates: true }), 'raw_keywords upsert')
            )
          }
        }
      }

      if (hasCrawlConfig) {
        const [appRes, gameRes] = await Promise.all([
          supabase.from('raw_keywords').select('id', { count: 'exact', head: true })
            .eq('site_id', site.id).eq('content_type', 'app').eq('content_date', yesterday).not('keyword', 'like', '%电脑版%'),
          supabase.from('raw_keywords').select('id', { count: 'exact', head: true })
            .eq('site_id', site.id).eq('content_type', 'game').eq('content_date', yesterday).not('keyword', 'like', '%电脑版%'),
        ])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('competitor_kw_stats') as any).upsert(
          { site_id: site.id, stat_date: yesterday, app_count: appRes.count ?? 0, game_count: gameRes.count ?? 0, updated_at: new Date().toISOString() },
          { onConflict: 'site_id,stat_date' }
        )
      }

      const isEmptyFetch = hasCrawlConfig && rawEntries.length === 0
      const warn = isEmptyFetch ? '  ⚠ 抓取为空，请检查URL/选择器' : ''
      const dateWarn = nullDateCount > 0 ? `  ⚠ ${nullDateCount}条日期解析失败` : ''
      console.log(`${prefix} ✓  抓到=${String(rawEntries.length).padStart(4)}  新增=${String(newCount).padStart(4)}${warn}${dateWarn}`)
      if (hasCrawlConfig) {
        if (isEmptyFetch) {
          empty++
          if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'empty', detail: '页面抓取返回空，请检查URL/选择器' })
        } else {
          ok++
          totalRows += newCount
          const dateDetail = nullDateCount > 0 ? `，⚠${nullDateCount}条日期解析失败（按昨日填充，请检查日期CSS选择器）` : ''
          if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'ok', rowsWritten: newCount, detail: `新增${newCount}条${dateDetail}` })
        }
      } else {
        ok++
      }
    } catch (e) {
      console.error(`${prefix} ✗  ${e instanceof Error ? e.message : e}`)
      failed++
      if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'fail', detail: e instanceof Error ? e.message : String(e) })
    }
    await delay(5000)
  }

  // 清理旧数据（只由 group 0 执行，避免多个 job 同时清理）
  // raw_keywords/rank_changes 2026-08-05 起改为永久保留，不再清理——同一个关键词
  // 隔了很久又出现时，能靠历史记录判断是"之前见过的"而不是重新算一次新增
  // （raw_keywords 的去重就是靠 site_id+content_date+keyword 精确匹配历史记录，
  // 之前删了30天前的记录导致这个匹配会失效，同词同日期隔了30天又抓到就被误判成
  // 新增）。
  if (isMainGroup) {
    await supabase.from('competitor_kw_stats').delete().lt('stat_date', getMalaysiaDate(-30))
    // activity_log 一直文档写着"7天保留"（lib/crawl-rules.ts 的 RETENTION），但
    // 实际清理代码只写在 app/api/cron/route.ts 里——那个路由只有用户点"重抓"
    // 按钮时才会跑到，每天真正在跑的 GH Actions 主流程（这个脚本）从来没有
    // 清理过，导致 activity_log 一直在攒（2026-08-11 真实验证过：查到最老的
    // search 类型记录停在快一个月前，远超7天）。这里补上，保证每天都真的清一次。
    await supabase.from('activity_log').delete().lt('logged_at', new Date(Date.now() - 7 * 86400000).toISOString())
  }

  const durationMs = Date.now() - stepStart
  console.log(`\n  KEYWORDS 完成  ✓${ok}  ⊘${skipped}  ⚠${empty}  ✗${failed}  耗时=${elapsed(durationMs)}`)
  if (activityId) await activityEnd(supabase, activityId, {
    status: failed > 0 ? 'warn' : empty > 0 ? 'warn' : 'done',
    ok, empty, skip: skipped, fail: failed, rowsWritten: totalRows, durationMs,
    summary: `新增关键词 ${totalRows} 条，${empty} 站为空，${failed} 站失败`,
  })
}

async function runRank(sites: SiteRecord[], today: string, activityId: string | null = null) {
  const stepStart = Date.now()
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  RANK   日期=${today}   ${ts()}`)
  console.log(`${'═'.repeat(60)}`)

  let ok = 0, failed = 0, emptyCount = 0, suspectCount = 0, totalRows = 0, consecutiveEmpty = 0
  const retryQueue: SiteRecord[] = [] // 因限流而为空的站，熔断后补抓

  // 爱站的验证机制到 2026-08 已经简化回轻量的 cookie 挑战（不再是 2026-07
  // 那套要等~2分钟的浏览器指纹验证，详见 lib/crawl-rules.ts "rank" 小节的
  // 历史记录），一次 HTTP 请求即可拿到会话 cookie，下面整个站点循环复用
  // 同一个 session。如果爱站之后又把验证加重，lib/crawler-browser.ts 里的
  // Playwright 方案还在，换回来只需改这里和上面的 import。
  console.log(`  ⏳ 正在获取爱站会话 cookie… (${ts()})`)
  const session = await createAizhanHttpSession()
  console.log(`  ✓ 会话就绪 (${ts()})`)

  // 将一个站点的抓取结果写入数据库
  async function saveRankResult(s: SiteRecord, up: { keyword: string; volume: number }[], down: { keyword: string; volume: number }[]) {
    const rows = [
      ...up.map((e) => ({ site_id: s.id, stat_date: today, type: 'rankup', keyword: e.keyword, volume: e.volume })),
      ...down.map((e) => ({ site_id: s.id, stat_date: today, type: 'rankdown', keyword: e.keyword, volume: e.volume })),
    ]
    if (rows.length > 0) {
      await withRetry(async () => {
        await supabase.from('rank_changes').delete().eq('site_id', s.id).eq('stat_date', today)
        for (const chunk of chunkArray(rows, 500)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sbCheck(await (supabase.from('rank_changes') as any).insert(chunk), 'rank_changes insert')
        }
      })
    }
    // Merge up and down into one map (rankup wins if same keyword in both, shouldn't happen per site)
    const kwMap = new Map<string, { volume: number; latest_trend: string }>()
    for (const e of down) kwMap.set(e.keyword, { volume: e.volume, latest_trend: 'rankdown' })
    for (const e of up) kwMap.set(e.keyword, { volume: e.volume, latest_trend: 'rankup' })
    const kwWithVol = Array.from(kwMap.entries()).filter(([, v]) => v.volume > 0)
      .map(([keyword, v]) => ({ keyword, volume: v.volume, latest_trend: v.latest_trend, stat_date: today }))
    const kwNoVol = Array.from(kwMap.entries()).filter(([, v]) => v.volume <= 0)
      .map(([keyword, v]) => ({ keyword, volume: 0, latest_trend: v.latest_trend, stat_date: today }))
    await upsertKeywordVolumeWithChange(supabase, kwWithVol)
    for (const chunk of chunkArray(kwNoVol, 500)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('keyword_volume') as any).upsert(chunk, { onConflict: 'keyword', ignoreDuplicates: true })
    }
    // Update latest_trend for zero-volume keywords (ignoreDuplicates skips existing rows, so trend needs a separate update)
    const rankupNoVol = kwNoVol.filter(r => r.latest_trend === 'rankup').map(r => r.keyword)
    const rankdownNoVol = kwNoVol.filter(r => r.latest_trend === 'rankdown').map(r => r.keyword)
    for (const chunk of chunkArray(rankupNoVol, 500)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('keyword_volume') as any).update({ latest_trend: 'rankup' }).in('keyword', chunk)
    }
    for (const chunk of chunkArray(rankdownNoVol, 500)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('keyword_volume') as any).update({ latest_trend: 'rankdown' }).in('keyword', chunk)
    }
  }

  for (let idx = 0; idx < sites.length; idx++) {
    const site = sites[idx]
    const prefix = `  [${String(idx + 1).padStart(2)}/${sites.length}] ${site.domain.padEnd(30)}`

    // 熔断：连续 3 站均为空，说明 IP 被限流，暂停 5 分钟，然后补抓队列里的站
    if (consecutiveEmpty >= 3) {
      const toRetry = retryQueue.splice(0)
      console.log(`\n  ⏸ 连续 ${consecutiveEmpty} 站为空，疑似 IP 被限流，暂停 5 分钟后补抓 ${toRetry.length} 个站… (${ts()})`)
      await delay(5 * 60 * 1000)
      consecutiveEmpty = 0
      console.log(`  ▶ 恢复，先补抓 ${toRetry.length} 个空站 (${ts()})`)
      for (const rs of toRetry) {
        const rp = `  [补抓] ${rs.domain.padEnd(30)}`
        try {
          const up = await fetchRankChangesViaHttp(session, rs.domain, today, 'rankup')
          await delay(2000)
          const down = await fetchRankChangesViaHttp(session, rs.domain, today, 'rankdown')
          await saveRankResult(rs, up, down)
          const stillEmpty = up.length === 0 && down.length === 0
          console.log(`${rp} ✓  涨入=${String(up.length).padStart(4)}  跌出=${String(down.length).padStart(4)}${stillEmpty ? '  ⚠ 仍为空' : '  ✓ 已补数据'}`)
        } catch (e) {
          console.error(`${rp} ✗  ${e instanceof Error ? e.message : e}`)
        }
        await delay(30000)
      }
      console.log(`  ▶ 继续主流程 (${ts()})`)
    }

    try {
      let rankupEntries = await fetchRankChangesViaHttp(session, site.domain, today, 'rankup')
      await delay(3000 + Math.floor(Math.random() * 2000)) // 随机 3-5 秒，减少爱站限流概率
      let rankdownEntries = await fetchRankChangesViaHttp(session, site.domain, today, 'rankdown')
      await delay(2000)

      if (rankupEntries.length === 0) {
        console.log(`${prefix}   ↺ 涨入为空，重试中…`)
        await delay(5000)
        rankupEntries = await fetchRankChangesViaHttp(session, site.domain, today, 'rankup')
        await delay(2000)
      }
      if (rankdownEntries.length === 0) {
        console.log(`${prefix}   ↺ 跌出为空，重试中…`)
        await delay(5000)
        rankdownEntries = await fetchRankChangesViaHttp(session, site.domain, today, 'rankdown')
        await delay(2000)
      }

      await saveRankResult(site, rankupEntries, rankdownEntries)

      const bothZero = rankupEntries.length === 0 && rankdownEntries.length === 0
      // If one side has > 150 entries but the other is 0, the 0 is almost certainly a crawl failure
      const upSuspect   = rankupEntries.length   === 0 && rankdownEntries.length > 150
      const downSuspect = rankdownEntries.length === 0 && rankupEntries.length   > 150
      const written = rankupEntries.length + rankdownEntries.length
      if (bothZero) {
        consecutiveEmpty++
        emptyCount++
        retryQueue.push(site)
        console.log(`${prefix} ✓  涨入=   0  跌出=   0  ⚠ 涨跌均为空 (连续${consecutiveEmpty}站)`)
        if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'empty', detail: '涨入0 | 跌出0（疑似限流）' })
      } else if (upSuspect || downSuspect) {
        const missing = upSuspect ? '涨入' : '跌出'
        const present = upSuspect ? rankdownEntries.length : rankupEntries.length
        consecutiveEmpty = 0
        retryQueue.length = 0
        totalRows += written
        suspectCount++
        console.log(`${prefix} ⚠  涨入=${String(rankupEntries.length).padStart(4)}  跌出=${String(rankdownEntries.length).padStart(4)}  ← ${missing}=0 但另侧=${present}，已标记重抓`)
        if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'suspect', detail: `${missing}=0 但另侧=${present}，疑似漏抓` })
      } else {
        consecutiveEmpty = 0
        retryQueue.length = 0
        totalRows += written
        console.log(`${prefix} ✓  涨入=${String(rankupEntries.length).padStart(4)}  跌出=${String(rankdownEntries.length).padStart(4)}`)
        if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'ok', rowsWritten: written, detail: `涨入${rankupEntries.length} | 跌出${rankdownEntries.length}` })
      }
      ok++
    } catch (e) {
      console.error(`${prefix} ✗  ${e instanceof Error ? e.message : e}`)
      failed++
      consecutiveEmpty++
      retryQueue.push(site)
      if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'fail', detail: e instanceof Error ? e.message : String(e) })
    }
    await delay(45000) // 站点间 45s，避免触发爱站限流
  }

  // 增量维护"连续上涨词/竞品涨排名"汇总表（2026-08-20）——今天写完 rank_changes
  // 后顺手让 keyword_signal_rollup 跟上，读取端（get_hot_rank_words/
  // get_hot_streak_words）不再需要现场扫30天历史，避免重蹈8月13号起超时的
  // 覆辙。幂等，失败不影响这一步已经写好的抓取数据。
  try {
    await supabase.rpc('refresh_keyword_signal_rollup', { p_date: today })
  } catch (e) {
    console.error(`  ⚠ refresh_keyword_signal_rollup 失败: ${e instanceof Error ? e.message : e}`)
  }

  const durationMs = Date.now() - stepStart
  console.log(`\n  RANK 完成  ✓${ok}  ⚠${emptyCount}  ⚑${suspectCount}  ✗${failed}  耗时=${elapsed(durationMs)}`)
  if (suspectCount > 0) console.log(`  ⚑ 有 ${suspectCount} 站单侧>150但另侧=0，已标记 suspect，将由 retry-crawl 于 05:00 MYT 重抓`)
  if (activityId) await activityEnd(supabase, activityId, {
    status: failed > 0 ? 'warn' : (emptyCount > 0 || suspectCount > 0) ? 'warn' : 'done',
    ok: ok - emptyCount - suspectCount, empty: emptyCount, fail: failed, rowsWritten: totalRows, durationMs,
    summary: `涨跌词 ${totalRows} 条，${emptyCount} 站为空，${suspectCount} 站疑似漏抓，${failed} 站失败`,
  })
}

async function runWeight(sites: SiteRecord[], today: string, activityId: string | null = null) {
  const stepStart = Date.now()
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  WEIGHT   日期=${today}   ${ts()}`)
  console.log(`${'═'.repeat(60)}`)

  let ok = 0, failed = 0

  for (let idx = 0; idx < sites.length; idx++) {
    const site = sites[idx]
    const prefix = `  [${String(idx + 1).padStart(2)}/${sites.length}] ${site.domain.padEnd(30)}`

    let fetched = false
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`${prefix}   ↺ 重试 ${attempt}/2，等待 30s…`)
          await delay(30000)
        }
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
        console.log(`${prefix} ✓  pc=${String(pc).padStart(3)}  mobile=${String(mobile).padStart(3)}  index=${indexCount}`)
        if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'ok', rowsWritten: 2, detail: `pc=${pc} mobile=${mobile} index=${indexCount}` })
        fetched = true
        ok++
        break
      } catch (e) {
        if (attempt === 2) {
          console.error(`${prefix} ✗  权重抓取失败（3次）: ${e instanceof Error ? e.message : e}`)
          if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'fail', detail: e instanceof Error ? e.message : '3次重试失败' })
        }
      }
    }
    if (!fetched) failed++
    await delay(3000)
  }

  const durationMs = Date.now() - stepStart
  console.log(`\n  WEIGHT 完成  ✓${ok}  ✗${failed}  耗时=${elapsed(durationMs)}`)
  if (activityId) await activityEnd(supabase, activityId, {
    status: failed > 0 ? 'warn' : 'done',
    ok, fail: failed, rowsWritten: ok * 2, durationMs,
    summary: `权重+收录 ${ok} 站成功，${failed} 站失败`,
  })
}

async function runIndexPages(sites: SiteRecord[], today: string, activityId: string | null = null, baiduCookie?: string) {
  const stepStart = Date.now()
  // Monthly (31d) window rotates across sites in 3-day batches to reduce Baidu request load.
  // Day 0 mod 3 → batch 0 (sites 0,3,6,…), Day 1 mod 3 → batch 1, Day 2 mod 3 → batch 2.
  const mytDayNumber = Math.floor((Date.now() + 8 * 3600000) / 86400000)
  const monthlyBatch = mytDayNumber % 3
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  INDEX-PAGES   日期=${today}   ${ts()}${baiduCookie ? '   Cookie=✓' : ''}   月度批次=${monthlyBatch + 1}/3`)
  console.log(`${'═'.repeat(60)}`)

  let ok = 0, failed = 0, empty = 0, totalNew = 0

  for (let idx = 0; idx < sites.length; idx++) {
    const site = sites[idx]
    const prefix = `  [${String(idx + 1).padStart(2)}/${sites.length}] ${site.domain.padEnd(30)}`

    try {
      const nowSec = Math.floor(Date.now() / 1000)
      const supplementCustomUrl = process.env.SUPPLEMENT_CUSTOM_URL
      const isSupplementRun = !!(supplementCustomUrl || process.env.SUPPLEMENT_DOMAIN || process.env.SUPPLEMENT_PERIOD)

      let pages: BaiduIndexedPage[]
      let failReason: BaiduIndexFailReason
      let periodSummary = ''

      if (isSupplementRun) {
        // Single-period fetch for manual/supplement runs (original behaviour)
        let crawlUrl: string
        if (supplementCustomUrl) {
          const u = new URL(supplementCustomUrl)
          u.searchParams.delete('pn')
          crawlUrl = u.toString()
        } else {
          const period = process.env.SUPPLEMENT_PERIOD || 'monthly'
          const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 31
          const gpc = encodeURIComponent(`stf=${nowSec - days * 86400},${nowSec}|stftype=1`)
          crawlUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(`site:${site.domain}`)}&ct=2097152&si=${encodeURIComponent(site.domain)}&fenlei=256&ie=utf-8&gpc=${gpc}&tfflag=1`
        }
        const result = await fetchBaiduIndexPages(site.domain, undefined, baiduCookie, crawlUrl)
        pages = result.pages
        failReason = result.failReason
      } else {
        // Main daily crawl: fetch gpc windows and union the results.
        // Monthly (31d) window only runs for sites in today's batch (idx % 3 === monthlyBatch).
        const includeMonthly = idx % 3 === monthlyBatch
        type Period = { label: string; days: number }
        const PERIODS: Period[] = [
          ...(includeMonthly ? [{ label: '月(31天)', days: 31 }] : []),
          { label: '周(7天)',  days: 7  },
          { label: '日(1天)',  days: 1  },
        ]
        const pageMap = new Map<string, BaiduIndexedPage>()
        const periodLogs: string[] = []
        let lastFailReason: BaiduIndexFailReason = null
        for (let pi = 0; pi < PERIODS.length; pi++) {
          const { label, days } = PERIODS[pi]
          const gpc = encodeURIComponent(`stf=${nowSec - days * 86400},${nowSec}|stftype=1`)
          const crawlUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(`site:${site.domain}`)}&ct=2097152&si=${encodeURIComponent(site.domain)}&fenlei=256&ie=utf-8&gpc=${gpc}&tfflag=1`
          const result = await fetchBaiduIndexPages(site.domain, undefined, baiduCookie, crawlUrl)
          periodLogs.push(`${label}=${result.pages.length}${result.failReason ? `(${result.failReason})` : ''}`)
          if (result.failReason) lastFailReason = result.failReason
          for (const p of result.pages) {
            if (!pageMap.has(p.url)) pageMap.set(p.url, p)
          }
          if (result.failReason === 'captcha') break  // IP blocked — stop early
          if (pi < PERIODS.length - 1) await delay(3000)
        }
        pages = Array.from(pageMap.values())
        failReason = pages.length === 0 ? (lastFailReason ?? 'empty_results') : null
        periodSummary = periodLogs.join(' ')
      }

      if (pages.length === 0) {
        const reasonMap: Record<string, string> = {
          captcha: '百度安全验证拦截（IP被封）',
          no_content: '页面无搜索结果区域（可能被拦截）',
          http_error: 'HTTP请求失败',
          empty_results: '百度site:查询无结果（该域名未被收录或已过滤）',
        }
        const detail = reasonMap[failReason ?? ''] ?? '百度site:查询返回空'
        console.log(`${prefix} ⚠  ${detail}`)
        empty++
        if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'empty', detail })
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
            missed_count: 0,             // reset grace-period counter on re-discovery
            verify_needed: false,        // clear any pending verification
            updated_at: new Date().toISOString(),
          }))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await (supabase.from('site_indexed_pages') as any).upsert(rows, {
            onConflict: 'site_id,url',
            ignoreDuplicates: false,
          }).select('id, first_seen_date')
          // first_seen_date is preserved on UPDATE by trigger; equals today only for new inserts
          const inserted = (res.data || []) as { first_seen_date: string }[]
          newCount += inserted.filter(r => r.first_seen_date === today).length
        }

        // Only run missed-page logic during authoritative (all-period) crawls — supplement runs use a
        // single/narrower time window so absence from results does NOT mean the page was de-indexed.
        let flaggedCount = 0
        if (!isSupplementRun) {
          const window30d = getMalaysiaDate(-30)
          // Increment missed_count for pages not seen today; flag verify_needed after 2 consecutive misses.
          // Actual disappeared_date is set by the weekly verify-deindex job after URL-level confirmation.
          const { data: flagged } = await supabase.rpc('mark_missed_index_pages', {
            p_site_id: site.id,
            p_window_start: window30d,
            p_today: today,
          })
          flaggedCount = flagged ?? 0
        }

        totalNew += newCount
        ok++
        const periodStr = periodSummary ? ` [${periodSummary}]` : ''
        console.log(`${prefix} ✓${periodStr}  合计=${String(pages.length).padStart(4)}  新增=${String(newCount).padStart(4)}  待验证=${String(flaggedCount).padStart(3)}`)
        if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'ok', rowsWritten: newCount, detail: `${periodSummary ? `[${periodSummary}] ` : ''}合计${pages.length}条，新增${newCount}条，待验证${flaggedCount}条` })
      }
    } catch (e) {
      console.error(`${prefix} ✗  ${e instanceof Error ? e.message : e}`)
      failed++
      if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'fail', detail: e instanceof Error ? e.message : String(e) })
    }
    await delay(10000)
  }

  const durationMs = Date.now() - stepStart
  console.log(`\n  INDEX-PAGES 完成  ✓${ok}  ⚠${empty}  ✗${failed}  新增总计=${totalNew}  耗时=${elapsed(durationMs)}`)
  if (activityId) await activityEnd(supabase, activityId, {
    status: failed > 0 ? 'warn' : empty > 0 ? 'warn' : 'done',
    ok, empty, fail: failed, rowsWritten: totalNew, durationMs,
    summary: `收录页面 ${ok} 站成功，新增 ${totalNew} 条，${empty} 站为空，${failed} 站失败`,
  })
}

async function runTracking(sites: SiteRecord[], today: string, activityId: string | null = null) {
  const stepStart = Date.now()
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  TRACKING   日期=${today}   ${ts()}`)
  console.log(`${'═'.repeat(60)}`)

  // Load rules with trigger logic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rulesData } = await (supabase.from('rules') as any)
    .select('id, trigger_type, trigger_params, tracking_window_days')
    .not('trigger_type', 'is', null)
  type RuleRow = { id: string; trigger_type: string; trigger_params: Record<string, number>; tracking_window_days: number }
  const rules = (rulesData || []) as RuleRow[]
  const rule900 = rules.find(r => r.trigger_type === 'rankdown_then_update')
  const rule901 = rules.find(r => r.trigger_type === 'batch_prefix_update')

  let ok = 0, empty = 0, failed = 0, totalRows = 0

  for (let idx = 0; idx < sites.length; idx++) {
    const site = sites[idx]
    const prefix = `  [${String(idx + 1).padStart(2)}/${sites.length}] ${site.domain.padEnd(30)}`
    try {
      const window60 = getMalaysiaDate(-60)

      // 1. Today's rank signals from site_keyword_ranks (populated by crawl-rank.ts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rankRows } = await (supabase.from('site_keyword_ranks') as any)
        .select('keyword, url, volume, rank_position, type')
        .eq('site_id', site.id)
        .eq('stat_date', today)
        .eq('platform', 'mobile')
      type RankRow = { keyword: string; url: string | null; volume: number; rank_position: number | null; type: string }
      const rankSignals = (rankRows || []) as RankRow[]

      // Per-keyword best signal (rankup takes precedence over rankdown)
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

      // 2. Today's new index events → map back to keywords via raw_keywords.source_url
      const newIndexUrls = new Set<string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newIdxRows } = await (supabase.from('site_indexed_pages') as any)
        .select('url')
        .eq('site_id', site.id)
        .eq('first_seen_date', today)
        .limit(500)
      for (const r of (newIdxRows || []) as { url: string }[]) newIndexUrls.add(r.url)

      // A single site can easily have 1000s of distinct signal keywords/URLs on
      // a given day (verified 2026-07-29: one site had 2791). `.in()` was
      // previously capped with `.slice(0, 500)`, silently dropping everything
      // past the first 500 — for a site with e.g. 2791 signal keywords, ~82%
      // never even got checked against raw_keywords. This is why
      // competitor_tracking_records has been empty since the feature was
      // built despite real keyword overlap existing (confirmed by direct
      // query). Chunked `.in()` batching (even at 150/batch) turned out to
      // still fail unpredictably under many rapid consecutive requests
      // (verified 2026-07-29: every batch in a 19-batch run errored with the
      // same ~16KB header overflow despite each individual request being
      // well under that). Switched to Postgres RPC functions instead —
      // parameters travel in the POST body, not the URL query string, so
      // array size no longer matters at all (Supabase's own recommended fix
      // for large `.in()` filters). See migration add_competitor_tracking_match_rpcs.
      const newIndexKwSet = new Set<string>()
      if (newIndexUrls.size > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: urlKwRows, error: newIdxKwErr } = await (supabase.rpc('match_raw_keywords_by_url', {
          p_site_id: site.id, p_urls: Array.from(newIndexUrls), p_since: window60,
        }) as any)
        if (newIdxKwErr) console.error(`${prefix} match_raw_keywords_by_url 查询失败: ${JSON.stringify(newIdxKwErr)}`)
        for (const r of (urlKwRows || []) as { keyword: string; source_url: string }[]) {
          newIndexKwSet.add(r.keyword)
        }
      }

      // 1.5. URL-based rank signals: cross-ref site_keyword_ranks.url with raw_keywords.source_url
      if (urlRankDataMap.size > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: urlKwMappings, error: urlRankKwErr } = await (supabase.rpc('match_raw_keywords_by_url', {
          p_site_id: site.id, p_urls: Array.from(urlRankDataMap.keys()), p_since: window60,
        }) as any)
        if (urlRankKwErr) console.error(`${prefix} match_raw_keywords_by_url 查询失败: ${JSON.stringify(urlRankKwErr)}`)
        for (const r of (urlKwMappings || []) as { keyword: string; source_url: string }[]) {
          const urlRank = urlRankDataMap.get(r.source_url)
          if (urlRank && (!rankMap.has(r.keyword) || rankMap.get(r.keyword)!.type !== 'rankup')) {
            rankMap.set(r.keyword, urlRank)
          }
        }
      }

      // 3. Union of all signal keywords
      const allSignalKws = new Set([...Array.from(rankMap.keys()), ...Array.from(newIndexKwSet)])
      if (allSignalKws.size === 0) {
        empty++
        console.log(`${prefix} –  无信号`)
        if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'empty', detail: '无排名/收录信号' })
        continue
      }

      // 4. Cross-ref with raw_keywords (last 60 days) — only include keywords with submission records
      type KwMeta = { content_type: string | null; content_date: string | null; source_url: string | null; count: number }
      const kwMetaMap = new Map<string, KwMeta>()
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rawKwRows, error: rawKwErr } = await (supabase.rpc('match_raw_keywords_by_keyword', {
          p_site_id: site.id, p_keywords: Array.from(allSignalKws), p_since: window60,
        }) as any)
        if (rawKwErr) console.error(`${prefix} match_raw_keywords_by_keyword 查询失败: ${JSON.stringify(rawKwErr)}`)
        for (const r of (rawKwRows || []) as { keyword: string; content_type: string | null; content_date: string; source_url: string | null }[]) {
          if (!kwMetaMap.has(r.keyword)) {
            kwMetaMap.set(r.keyword, { content_type: r.content_type, content_date: r.content_date, source_url: r.source_url, count: 1 })
          } else {
            kwMetaMap.get(r.keyword)!.count++
          }
        }
      }
      const trackedKws = Array.from(allSignalKws).filter(kw => kwMetaMap.has(kw))

      if (trackedKws.length === 0) {
        empty++
        console.log(`${prefix} –  无匹配提交记录`)
        if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'empty', detail: '信号词无提交记录' })
        continue
      }

      // 5. Search volumes
      const volMap = new Map<string, number>()
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: volRows, error: volErr } = await (supabase.rpc('match_keyword_volume', { p_keywords: trackedKws }) as any)
        if (volErr) console.error(`${prefix} match_keyword_volume 查询失败: ${JSON.stringify(volErr)}`)
        for (const r of (volRows || []) as { keyword: string; volume: number }[]) volMap.set(r.keyword, r.volume)
      }

      // 6. Index first_seen_date for source_urls
      const sourceUrls = trackedKws.map(kw => kwMetaMap.get(kw)?.source_url).filter((u): u is string => !!u)
      const indexFirstSeenMap = new Map<string, string>() // url → first_seen_date
      if (sourceUrls.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: idxRows, error: idxErr } = await (supabase.rpc('match_site_indexed_pages', {
          p_site_id: site.id, p_urls: sourceUrls,
        }) as any)
        if (idxErr) console.error(`${prefix} match_site_indexed_pages 查询失败: ${JSON.stringify(idxErr)}`)
        for (const r of (idxRows || []) as { url: string; first_seen_date: string }[]) {
          if (r.first_seen_date) indexFirstSeenMap.set(r.url, r.first_seen_date)
        }
      }

      // 7. Competitor profile for operation_type detection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profile } = await (supabase.from('competitor_profiles') as any)
        .select('same_name_diff_date_is_update, same_base_diff_sub_is_update')
        .eq('domain', site.domain)
        .maybeSingle()
      const sameNameDiffDate: boolean = (profile as { same_name_diff_date_is_update: boolean } | null)?.same_name_diff_date_is_update ?? false
      const sameBaseDiffSub: boolean = (profile as { same_base_diff_sub_is_update: boolean } | null)?.same_base_diff_sub_is_update ?? false

      // 8. Rule 901 batch-prefix count
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

      // 9. Build upsert rows
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
          site_id: site.id,
          keyword,
          discovery_date: today,
          content_date: meta.content_date || null,
          content_type: meta.content_type || null,
          operation_type,
          source_url: srcUrl,
          search_volume: volMap.get(keyword) ?? 0,
          rank_position: rank?.rank_position ?? null,
          rank_type: rank?.type ?? null,
          rank_volume: rank?.volume ?? 0,
          index_first_seen: indexFirstSeen,
          effectiveness,
          rule_id,
          updated_at: new Date().toISOString(),
        })
      }

      if (upsertRows.length > 0) {
        for (const chunk of chunkArray(upsertRows, 500)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('competitor_tracking_records') as any).upsert(chunk, {
            onConflict: 'site_id,keyword,discovery_date',
            ignoreDuplicates: false,
          })
        }
      }

      // 10. Mark stale '追踪中' records (>60 days without signal) as '无效'
      const stale60 = getMalaysiaDate(-60)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('competitor_tracking_records') as any)
        .update({ effectiveness: '无效', updated_at: new Date().toISOString() })
        .eq('site_id', site.id)
        .eq('effectiveness', '追踪中')
        .lt('discovery_date', stale60)

      totalRows += upsertRows.length
      ok++
      console.log(`${prefix} ✓  信号=${String(allSignalKws.size).padStart(4)}  匹配=${String(trackedKws.length).padStart(4)}  写入=${String(upsertRows.length).padStart(4)}`)
      if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'ok', rowsWritten: upsertRows.length, detail: `信号${allSignalKws.size}词，匹配${trackedKws.length}词` })
    } catch (e) {
      console.error(`${prefix} ✗  ${e instanceof Error ? e.message : e}`)
      failed++
      if (activityId) await siteLog(supabase, activityId, { domain: site.domain, status: 'fail', detail: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── Own-site tracking ─────────────────────────────────────────────────────
  let ownRows = 0
  const window90 = getMalaysiaDate(-90)
  try {
    const { data: claimRows } = await supabase
      .from('member_claimed_keywords')
      .select('id, group_id, user_id, keyword, final_keyword, page_url, operation_type, search_volume, submitted_at, claimed_date')
      .eq('status', 'submitted')
      .not('page_url', 'is', null)
      .gte('claimed_date', window90)
    type ClaimRow = { id: string; group_id: string; user_id: string; keyword: string; final_keyword: string | null; page_url: string | null; operation_type: string | null; search_volume: number; submitted_at: string | null; claimed_date: string }
    const claims = (claimRows || []) as ClaimRow[]

    if (claims.length > 0) {
      // Query with www./m. variants of each page_url (widens the .in() filter),
      // but key the lookup maps by the bare (subdomain-stripped) URL so a claim
      // submitted as "site.com/x" still matches a row discovered as "m.site.com/x".
      const pageUrlVariants = Array.from(new Set(claims.filter(c => c.page_url).flatMap(c => urlSubdomainVariants(c.page_url!))))

      // Chunk size 150 keeps the .in() query string well under the ~16KB HTTP
      // header limit — 500 caused silent "HeadersOverflowError: fetch failed"
      // (unchecked here before) that made every own-site rank/index match
      // return empty for days without any visible error (verified 2026-07-29).
      const indexMap = new Map<string, { first_seen_date: string; disappeared_date: string | null }>()
      for (const chunk of chunkArray(pageUrlVariants, 150)) {
        const { data: idxRows, error: idxErr } = await supabase.from('site_indexed_pages')
          .select('url, first_seen_date, disappeared_date').in('url', chunk)
        if (idxErr) console.error(`  [自己站点追踪] site_indexed_pages 查询失败: ${JSON.stringify(idxErr)}`)
        for (const r of (idxRows || []) as { url: string; first_seen_date: string; disappeared_date: string | null }[]) {
          indexMap.set(bareUrl(r.url), { first_seen_date: r.first_seen_date, disappeared_date: r.disappeared_date })
        }
      }

      // rankByUrlMap: single best match per URL (latest date, best rank_position) —
      // feeds site_tracking_records' scalar rank_* columns, which effectiveness/
      // rule-discovery/rule-stats depend on. Left exactly as before.
      // rankMatchesByUrlMap: every DISTINCT keyword matched per URL (deduped by
      // keyword, keeping the first/best occurrence per the same sort order —
      // a keyword can otherwise appear many times across positions/dates) —
      // feeds the separate site_tracking_rank_matches table so 分组报告 can show
      // all of them, without touching the scalar columns' existing semantics.
      const rankByUrlMap = new Map<string, { keyword: string; rank_position: number | null; prev_rank: number | null; volume: number; stat_date: string }>()
      const rankMatchesByUrlMap = new Map<string, Map<string, { rank_position: number | null; prev_rank: number | null; volume: number }>>()
      for (const chunk of chunkArray(pageUrlVariants, 150)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rRows, error: rankErr } = await (supabase.from('site_keyword_ranks') as any)
          .select('url, keyword, rank_position, prev_rank, volume, stat_date')
          .in('url', chunk).not('url', 'is', null).eq('platform', 'mobile')
          .order('stat_date', { ascending: false }).order('rank_position', { ascending: true, nullsFirst: false })
        if (rankErr) console.error(`  [自己站点追踪] site_keyword_ranks 查询失败: ${JSON.stringify(rankErr)}`)
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

        // 分组报告用：这个 URL 匹配到的全部排名词（不只是上面那一个"最佳"的），
        // 写进独立的 site_tracking_rank_matches 表，不影响 site_tracking_records 的语义
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
      console.log(`  [自己站点追踪] ${claims.length} 条记录写入完成，${rankMatchRows.length} 条排名词匹配`)
    } else {
      console.log('  [自己站点追踪] 无活跃提交记录，跳过')
    }
  } catch (e) {
    console.error(`  [自己站点追踪] ✗  ${e instanceof Error ? e.message : e}`)
  }

  const durationMs = Date.now() - stepStart
  console.log(`\n  TRACKING 完成  ✓${ok}  ⚠${empty}  ✗${failed}  竞品=${totalRows}  自己站点=${ownRows}  耗时=${elapsed(durationMs)}`)
  if (activityId) await activityEnd(supabase, activityId, {
    status: failed > 0 ? 'warn' : 'done',
    ok, empty, fail: failed, rowsWritten: totalRows + ownRows, durationMs,
    summary: `竞品追踪 ${ok} 站成功，竞品 ${totalRows} 条，自己站点 ${ownRows} 条，${failed} 站失败`,
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const step = args.find((a) => a.startsWith('--step='))?.split('=')[1] ?? 'all'
  const siteFilter = args.find((a) => a.startsWith('--site='))?.split('=')[1] ?? null
  const group = parseInt(args.find((a) => a.startsWith('--group='))?.split('=')[1] ?? '0', 10)
  const totalGroups = parseInt(args.find((a) => a.startsWith('--total-groups='))?.split('=')[1] ?? '1', 10)
  const retryFailed = args.includes('--retry-failed')
  // 补抓用：只对 rank 步骤生效，覆盖"今天"为指定的历史 MYT 日期（爱站的排名页
  // 本身支持按日期查历史数据，见 buildRankUrl 的 isToday 分支）。不传就是正常
  // 当天抓取，其它步骤不读这个参数。
  const dateOverride = args.find((a) => a.startsWith('--date='))?.split('=')[1] ?? null

  const totalStart = Date.now()
  const ip = await getPublicIp()
  console.log(`\n${'▶'.repeat(60)}`)
  console.log(`  SEO Monitor Crawl${retryFailed ? ' [重试模式]' : ''}${dateOverride ? ` [补抓 ${dateOverride}]` : ''}`)
  console.log(`  step=${step}  site=${siteFilter ?? 'all'}  group=${group}/${totalGroups}  ip=${ip}  启动时间=${ts()} MYT`)
  console.log(`${'▶'.repeat(60)}`)

  const today = dateOverride ?? getMalaysiaDate()
  const yesterday = getMalaysiaDate(-1)

  let query = supabase.from('sites').select('*')
  if (siteFilter) query = query.eq('domain', siteFilter)
  const { data: sitesRaw, error } = await query
  if (error) throw error

  const allSites = (sitesRaw || []) as SiteRecord[]
  // 权重+收录对所有站点都抓取，不依赖 is_enabled；各步骤内部有自己的过滤：
  //   keywords → filter(s.is_enabled)  rank → filter(s.has_rank_data)  index-pages → filter(s.has_index_pages)
  // siteFilter 单站模式始终不过滤
  const partitionBase = allSites
  // 多组时按域名排序确保分组稳定；单组时随机打乱
  let sites = totalGroups > 1
    ? [...partitionBase].sort((a, b) => a.domain.localeCompare(b.domain)).filter((_, i) => i % totalGroups === group)
    : shuffle(partitionBase)

  // 重试模式：只跑今日主抓取中 fail/empty 的站
  if (retryFailed && step !== 'all') {
    const todayStart = new Date(today + 'T00:00:00+08:00').toISOString()
    const todayEnd = new Date(today + 'T23:59:59.999+08:00').toISOString()

    // 查今日该步骤的 cron_task 活动 ID
    const { data: activities } = await supabase
      .from('activity_log')
      .select('id')
      .eq('step', step)
      .eq('type', 'cron_task')
      .gte('logged_at', todayStart)
      .lte('logged_at', todayEnd)

    const activityIds = ((activities || []) as { id: string }[]).map(a => a.id)
    if (activityIds.length === 0) {
      console.log(`\n  重试模式：今日尚无 ${step} 主抓取记录，跳过\n`)
      return
    }

    // 查这些活动里失败/空/疑似漏抓的站点域名
    const { data: failedLogs } = await supabase
      .from('activity_site_log')
      .select('domain')
      .in('activity_id', activityIds)
      .in('status', ['fail', 'empty', 'suspect'])

    const failedDomains = new Set(((failedLogs || []) as { domain: string }[]).map(l => l.domain))
    console.log(`  重试模式：今日 ${step} 失败/空/疑似漏抓共 ${failedDomains.size} 站`)

    if (failedDomains.size === 0) {
      console.log('  无失败站点，退出\n')
      return
    }

    // 只保留失败站，按域名重新分组
    const failedSites = allSites.filter(s => failedDomains.has(s.domain))
    sites = totalGroups > 1
      ? [...failedSites].sort((a, b) => a.domain.localeCompare(b.domain)).filter((_, i) => i % totalGroups === group)
      : failedSites
  }

  console.log(`  共 ${allSites.length} 个站点，本组 ${sites.length} 个  today=${today}  yesterday=${yesterday}`)

  const logBase = {
    type: 'cron_task' as const,
    source: retryFailed ? 'github_retry' : 'github_actions',
    groupIndex: group, totalGroups, ip,
  }

  if (step === 'keywords' || step === 'all') {
    const aid = await activityStart(supabase, { ...logBase, step: 'keywords' })
    // 重试模式下不执行旧数据清理（主抓取 group0 已完成）
    await runKeywords(sites.filter(s => s.is_enabled), today, yesterday, !retryFailed && group === 0, aid)
  }
  if (step === 'weight' || step === 'all') {
    const aid = await activityStart(supabase, { ...logBase, step: 'weight' })
    await runWeight(sites, today, aid)
  }
  if (step === 'rank' || step === 'all') {
    const aid = await activityStart(supabase, { ...logBase, step: 'rank' })
    await runRank(sites.filter(s => s.has_rank_data), today, aid)
  }
  if (step === 'index-pages') {
    const aid = await activityStart(supabase, { ...logBase, step: 'index-pages' })
    console.log(`  ⏱ index-pages job 启动 ${new Date().toISOString()}`)
    // 2026-07-27 A/B test: a Playwright-minted anonymous cookie was tried here and
    // measured against the manual pool on real GitHub Actions runs — the manual
    // pool won clearly (aged cookies with real browsing history behind them get
    // through Baidu's anti-bot far more often than a cookie that's seconds old),
    // so minting was removed. See project_baidu_index_cookie memory for the data.
    let baiduCookie: string | undefined
    const { data: cookieSetting } = await supabase.from('app_settings').select('value').eq('key', 'baidu_index_cookie').maybeSingle()
    const rawCookie = (cookieSetting as { value: string } | null)?.value ?? ''
    if (rawCookie) {
      try {
        const pool = JSON.parse(rawCookie)
        if (Array.isArray(pool) && pool.length > 0) {
          const item = pool[Math.floor(Math.random() * pool.length)]
          baiduCookie = typeof item === 'string' ? item : (item as { value: string }).value
        } else {
          baiduCookie = rawCookie
        }
      } catch {
        baiduCookie = rawCookie
      }
    }
    const supplementDomain = process.env.SUPPLEMENT_DOMAIN
    const indexSites = sites.filter(s => s.has_index_pages && (!supplementDomain || s.domain === supplementDomain))
    await runIndexPages(indexSites, today, aid, baiduCookie)
  }
  if (step === 'tracking') {
    const aid = await activityStart(supabase, { ...logBase, step: 'tracking' })
    await runTracking(sites.filter(s => s.has_rank_title), today, aid)
  }

  console.log(`\n${'✓'.repeat(60)}`)
  console.log(`  全部完成   总耗时=${elapsed(Date.now() - totalStart)}`)
  console.log(`${'✓'.repeat(60)}\n`)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
