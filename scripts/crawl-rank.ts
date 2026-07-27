import { createClient } from '@supabase/supabase-js'
import { createAizhanBrowserSession, fetchRankupWithTitleViaBrowser, fetchRankdownWithTitleViaBrowser } from '../lib/crawler-browser'
import { activityStart, activityEnd, siteLog } from '../lib/activity-log'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const cliArgs = process.argv.slice(2)
const group = parseInt(cliArgs.find(a => a.startsWith('--group='))?.split('=')[1] ?? '0', 10)
const totalGroups = parseInt(cliArgs.find(a => a.startsWith('--total-groups='))?.split('=')[1] ?? '1', 10)
const retryFailed = cliArgs.includes('--retry-failed')

function getMalaysiaDate(offsetDays = 0): string {
  const ms = Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

function ts(): string {
  const d = new Date(Date.now() + 8 * 3600000)
  return d.toISOString().slice(11, 19)
}

function elapsed(ms: number): string {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

async function main() {
  const today = getMalaysiaDate()
  const totalStart = Date.now()

  console.log(`\n${'▶'.repeat(60)}`)
  console.log(`  RANK CRAWL (All Sites)   日期=${today}   ${ts()} MYT`)
  console.log(`${'▶'.repeat(60)}`)

  // Get runner IP
  let ip: string | null = null
  try {
    const r = await fetch('https://api.ipify.org?format=text', { signal: AbortSignal.timeout(5000) })
    ip = (await r.text()).trim()
  } catch { /* ignore */ }

  const { data: sitesRaw, error: sitesErr } = await supabase
    .from('sites')
    .select('id, domain')
    .eq('has_rank_title', true)
  if (sitesErr) throw sitesErr

  const allSites = (sitesRaw || []) as { id: string; domain: string }[]

  if (allSites.length === 0) {
    console.log('  没有开启排名追踪的站点，退出')
    return
  }

  let candidateSites = allSites

  // Retry mode: only process today's failed/empty sites
  if (retryFailed) {
    const todayStart = new Date(today + 'T00:00:00+08:00').toISOString()
    const todayEnd   = new Date(today + 'T23:59:59.999+08:00').toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: acts } = await (supabase as any)
      .from('activity_log')
      .select('id')
      .eq('step', 'rank-title')
      .eq('type', 'cron_task')
      .gte('logged_at', todayStart)
      .lte('logged_at', todayEnd)
    const actIds = ((acts || []) as { id: string }[]).map(a => a.id)
    if (actIds.length === 0) {
      console.log('  重试模式：今日尚无 rank-title 主抓取记录，退出\n')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: failLogs } = await (supabase as any)
      .from('activity_site_log')
      .select('domain')
      .in('activity_id', actIds)
      .in('status', ['fail', 'empty'])
    const failedDomains = new Set(((failLogs || []) as { domain: string }[]).map(l => l.domain))
    console.log(`  重试模式：今日 rank-title 失败/空 ${failedDomains.size} 站`)
    if (failedDomains.size === 0) { console.log('  无失败站点，退出\n'); return }
    candidateSites = allSites.filter(s => failedDomains.has(s.domain))
  }

  const sites = totalGroups > 1
    ? [...candidateSites].sort((a, b) => a.domain.localeCompare(b.domain)).filter((_, i) => i % totalGroups === group)
    : candidateSites

  console.log(`  共 ${allSites.length} 个站点，${retryFailed ? `重试 ${candidateSites.length} 个，` : ''}本组 ${sites.length} 个（group ${group + 1}/${totalGroups}）: ${sites.map(s => s.domain).join(', ')}`)

  // Start activity log
  const activityId = await activityStart(supabase, {
    type: 'cron_task',
    source: retryFailed ? 'github_retry' : 'github_actions',
    step: 'rank-title',
    groupIndex: group,
    totalGroups,
    ip: ip ?? undefined,
  })

  const platforms: ('mobile' | 'pc')[] = ['mobile', 'pc']
  const types: ('rankup' | 'rankdown')[] = ['rankup', 'rankdown']

  let totalSaved = 0
  let totalFailed = 0
  let okSites = 0
  let emptySites = 0
  let failSites = 0

  // 爱站 2026-07 起给排名页加了浏览器指纹验证（约需等待2分钟自动通过，详见
  // lib/crawl-rules.ts "rank-title" 小节）。这个验证是浏览器会话级、跨站点/
  // 跨页面通用的，所以只需要在本次抓取开始时过一次，下面整个站点循环复用
  // 同一个已通过验证的 context。
  console.log(`  ⏳ 正在通过爱站浏览器验证（约需2分钟）… (${ts()})`)
  const { browser, context } = await createAizhanBrowserSession()
  console.log(`  ✓ 浏览器验证通过 (${ts()})`)

  try {
  for (let i = 0; i < sites.length; i++) {
    const { id: siteId, domain } = sites[i]
    console.log(`\n${'─'.repeat(50)}`)
    console.log(`  [${i + 1}/${sites.length}] ${domain}  (${ts()})`)

    // Clear today's existing data for this site (both platforms)
    await supabase.from('site_keyword_ranks').delete()
      .eq('site_id', siteId).eq('stat_date', today)

    // keyword_volume: collect from mobile rankup + rankdown; rankup takes priority if same keyword
    const kwVolumeMap = new Map<string, { volume: number; latest_trend: string }>()

    let siteSaved = 0
    let siteAnyData = false
    let siteFailed = false
    const siteDetails: string[] = []

    for (const platform of platforms) {
      for (const type of types) {
        const label = `${platform}/${type}`
        try {
          const entries = type === 'rankup'
            ? await fetchRankupWithTitleViaBrowser(context, domain, today, platform)
            : await fetchRankdownWithTitleViaBrowser(context, domain, today, platform)

          if (entries.length === 0) {
            console.log(`    ${label.padEnd(16)} ⚠  无数据（疑似限流或无词）`)
            siteDetails.push(`${label}=0`)
            await delay(3000 + Math.floor(Math.random() * 2000))
            continue
          }

          const rows = entries.map(e => ({
            site_id: siteId,
            keyword: e.keyword,
            stat_date: today,
            type,
            platform,
            rank_position: e.rank_position,
            prev_rank: e.prev_rank,
            volume: e.volume,
            title: e.title || null,
            url: e.url || null,
          }))

          for (const chunk of chunkArray(rows, 500)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('site_keyword_ranks') as any)
              .upsert(chunk, { onConflict: 'site_id,keyword,stat_date,platform,type' })
          }

          siteSaved += rows.length
          totalSaved += rows.length
          siteAnyData = true
          siteDetails.push(`${label}=${rows.length}`)
          console.log(`    ${label.padEnd(16)} ✓  ${rows.length} 条`)

          // Collect keyword_volume from mobile (rankup + rankdown); rankup takes priority
          if (platform === 'mobile') {
            for (const e of entries) {
              const existing = kwVolumeMap.get(e.keyword)
              if (!existing) {
                kwVolumeMap.set(e.keyword, { volume: e.volume, latest_trend: type })
              } else if (type === 'rankup') {
                // rankup always wins; take higher volume
                kwVolumeMap.set(e.keyword, { volume: Math.max(e.volume, existing.volume), latest_trend: 'rankup' })
              }
              // If rankdown and keyword already set from rankup: skip (keep rankup priority)
            }
          }
        } catch (e) {
          console.error(`    ${label.padEnd(16)} ✗  ${e instanceof Error ? e.message : String(e)}`)
          siteDetails.push(`${label}=ERR`)
          siteFailed = true
          totalFailed++
        }

        await delay(3000 + Math.floor(Math.random() * 2000))
      }
    }

    // Upsert keyword_volume (mobile rankup + rankdown)
    if (kwVolumeMap.size > 0) {
      const allEntries = Array.from(kwVolumeMap.entries())
      const withVol = allEntries.filter(([, v]) => v.volume > 0)
        .map(([keyword, v]) => ({ keyword, volume: v.volume, latest_trend: v.latest_trend, stat_date: today }))
      const noVol = allEntries.filter(([, v]) => v.volume <= 0)
        .map(([keyword, v]) => ({ keyword, volume: 0, latest_trend: v.latest_trend, stat_date: today }))
      for (const chunk of chunkArray(withVol, 500)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('keyword_volume') as any).upsert(chunk, { onConflict: 'keyword' })
      }
      for (const chunk of chunkArray(noVol, 500)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('keyword_volume') as any).upsert(chunk, { onConflict: 'keyword', ignoreDuplicates: true })
      }
      const rankupNoVol = noVol.filter(r => r.latest_trend === 'rankup').map(r => r.keyword)
      const rankdownNoVol = noVol.filter(r => r.latest_trend === 'rankdown').map(r => r.keyword)
      for (const chunk of chunkArray(rankupNoVol, 500)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('keyword_volume') as any).update({ latest_trend: 'rankup' }).in('keyword', chunk)
      }
      for (const chunk of chunkArray(rankdownNoVol, 500)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('keyword_volume') as any).update({ latest_trend: 'rankdown' }).in('keyword', chunk)
      }
      const up = allEntries.filter(([, v]) => v.latest_trend === 'rankup').length
      const dn = allEntries.filter(([, v]) => v.latest_trend === 'rankdown').length
      console.log(`    keyword_volume   ✓  更新 ${kwVolumeMap.size} 条（涨=${up} 跌=${dn}）`)
    }

    // Per-site log
    const siteStatus = siteFailed ? 'fail' : siteAnyData ? 'ok' : 'empty'
    if (siteStatus === 'ok') okSites++
    else if (siteStatus === 'empty') emptySites++
    else failSites++

    if (activityId) {
      await siteLog(supabase, activityId, {
        domain,
        status: siteStatus,
        rowsWritten: siteSaved,
        detail: siteDetails.join(' '),
      })
    }

    if (i < sites.length - 1) {
      console.log(`    等待 60s 再抓下一个站点…`)
      await delay(60000)
    }
  }
  } finally {
    await browser.close()
  }

  const dur = Date.now() - totalStart
  console.log(`\n${'✓'.repeat(60)}`)
  console.log(`  完成  总词条=${totalSaved}  失败=${totalFailed}  耗时=${elapsed(dur)}`)
  console.log(`${'✓'.repeat(60)}\n`)

  // End activity log
  if (activityId) {
    await activityEnd(supabase, activityId, {
      status: failSites > 0 ? 'warn' : emptySites === sites.length ? 'warn' : 'done',
      ok: okSites,
      empty: emptySites,
      fail: failSites,
      rowsWritten: totalSaved,
      durationMs: dur,
      summary: `${totalSaved} 条词，${sites.length} 站`,
    })
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
