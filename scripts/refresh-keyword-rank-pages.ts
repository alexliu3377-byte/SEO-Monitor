// 重算「词 → 竞品下载站页面」表 keyword_rank_pages（2026-11-20）。
// 每天排名抓取（rank-title）结束后、补录爱站 Excel 后由 GitHub Actions 运行；也可以手动：npx tsx scripts/refresh-keyword-rank-pages.ts
// 按词名分批调用 refresh_keyword_rank_pages（数据库里算，不把排名表搬出来）；全部批次成功才调用 finish_keyword_rank_pages
// 删掉这一轮没再出现的词。中途失败就退出、不删，表里保留上一轮的结果。
import { createClient } from '@supabase/supabase-js'

export type RefreshBatch = { words: number; with_pages: number; last_keyword: string | null; done: boolean }
export type RefreshRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>

export async function refreshKeywordRankPages(rpc: RefreshRpc, opts: { batch?: number; days?: number; max?: number; run?: string; maxBatches?: number; log?: (line: string) => void } = {}) {
  const run = opts.run ?? new Date().toISOString()
  const batch = opts.batch ?? 2000, maxBatches = opts.maxBatches ?? 500, log = opts.log ?? (() => {})
  let after: string | null = null, words = 0, withPages = 0, batches = 0
  for (;;) {
    if (++batches > maxBatches) throw new Error(`超过 ${maxBatches} 批还没算完，停下（没删旧数据）`)
    const { data, error } = await rpc('refresh_keyword_rank_pages', { p_after: after, p_limit: batch, p_days: opts.days ?? 30, p_max: opts.max ?? 5, p_run: run })
    if (error) throw new Error(`第 ${batches} 批失败（没删旧数据）：${error.message}`)
    const r = data as RefreshBatch
    if (!r || typeof r.words !== 'number') throw new Error(`第 ${batches} 批返回的格式不对（没删旧数据）`)
    words += r.words; withPages += r.with_pages
    log(`第 ${batches} 批：${r.words} 个词，其中有链接的 ${r.with_pages} 个`)
    if (r.done || !r.last_keyword || r.words === 0) break
    // 先后顺序由数据库的排序规则定（中文、英文混排），这里只检查有没有原地踏步。
    if (r.last_keyword === after) throw new Error('分批位置没有往后走，停下（没删旧数据）')
    after = r.last_keyword
  }
  const { data: removed, error } = await rpc('finish_keyword_rank_pages', { p_run: run })
  if (error) throw new Error(`清理这一轮没出现的词失败：${error.message}`)
  return { words, withPages, removed: Number(removed) || 0, batches, run }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Keyword rank pages worker credentials not configured')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const started = Date.now()
  try {
    const result = await refreshKeywordRankPages((fn, args) => db.rpc(fn, args), { log: line => console.log(line) })
    console.log(JSON.stringify({ keywordRankPages: { ...result, seconds: Math.round((Date.now() - started) / 1000) } }))
  } catch (error) {
    // 迁移 20261120_keyword_rank_pages.sql 还没在这个数据库执行：跳过并提醒，不让每天的排名抓取变红。
    if (error instanceof Error && /Could not find the function public\.refresh_keyword_rank_pages/.test(error.message)) {
      console.log('::warning::keyword_rank_pages 还没建（迁移 20261120_keyword_rank_pages.sql 未执行），这次跳过')
      return
    }
    throw error
  }
}

if (process.argv[1] && /refresh-keyword-rank-pages\.ts$/.test(process.argv[1])) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Keyword rank pages refresh failed'); process.exitCode = 1 })
}
