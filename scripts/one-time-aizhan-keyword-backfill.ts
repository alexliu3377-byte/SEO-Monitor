import { createClient } from '@supabase/supabase-js'
import { createAizhanHttpSession, fetchAizhanListingHtml } from '../lib/crawler-aizhan-http'
import { buildAizhanKeywordPageUrl, normalizeAizhanKeywordUrl, parseAizhanKeywordPage } from '../lib/aizhan-keyword-backfill'
import { upsertKeywordVolumeWithChange } from '../lib/keyword-volume'

const MAX_PAGES = 50
const rawUrls = process.env.AIZHAN_KEYWORD_URLS || ''
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!supabaseUrl || !serviceKey) throw new Error('缺少 Supabase GitHub Actions secrets')

const urls = [...new Set(rawUrls.split(/\r?\n/).map(value => normalizeAizhanKeywordUrl(value)).filter((value): value is string => Boolean(value)))]
if (urls.length === 0) throw new Error('没有有效的爱站移动端搜索量降序链接')

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const malaysiaDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)

async function main() {
  const bootstrapDomain = new URL(urls[0]).pathname.split('/').filter(Boolean)[1]
  const session = await createAizhanHttpSession(bootstrapDomain)
  const collected = new Map<string, number>()

  for (const startUrl of urls) {
    console.log(`\n开始补抓：${startUrl}`)
    let referer = 'https://baidurank.aizhan.com/'

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const currentUrl = buildAizhanKeywordPageUrl(startUrl, page)
      if (!currentUrl) throw new Error(`无法生成第 ${page} 页链接：${startUrl}`)
      const html = await fetchAizhanListingHtml(session, currentUrl, referer)
      if (!html) {
        console.log(`  第 ${page} 页为空或请求失败，停止`)
        break
      }
      const parsed = parseAizhanKeywordPage(html, currentUrl)
      if (parsed.rows.length === 0) {
        console.log(`  第 ${page} 页没有正搜索量关键词，停止`)
        break
      }
      for (const row of parsed.rows) {
        collected.set(row.keyword, Math.max(collected.get(row.keyword) ?? 0, row.volume))
      }
      console.log(`  第 ${page} 页：${parsed.rows.length} 个有效词；累计去重 ${collected.size}`)
      if (parsed.sawZeroVolume) {
        console.log(`  第 ${page} 页已出现搜索量 0，后续页面无需抓取`)
        break
      }
      referer = currentUrl
      await delay(800 + Math.floor(Math.random() * 700))
    }
  }

  const rows = [...collected.entries()].map(([keyword, volume]) => ({ keyword, volume, stat_date: malaysiaDate() }))
  if (rows.length === 0) throw new Error('本次没有抓到可写入的正搜索量关键词')
  await upsertKeywordVolumeWithChange(service, rows)
  console.log(`\n补充词库完成：${rows.length} 个去重关键词已写入，新增词会进入待分类队列。`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
